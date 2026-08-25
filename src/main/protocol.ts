import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { net, protocol } from 'electron';

/**
 * The game is served from a real origin, not from `file://`.
 *
 * `file://` is not an option and never was: the game is built with Vite
 * `base: '/'`, so `index.html` asks for `/assets/index-*.js` and `/favicon.ico`
 * — absolute paths, which under `file://` resolve to the filesystem root. It is
 * also not a *standard* scheme, so it has no origin, and an origin is exactly
 * what ES modules, `fetch`, WebAudio and a CSP all need.
 *
 * ---
 *
 * A custom `app://` scheme is the usual answer, and it does not work here. The
 * reason is worth writing down, because it is invisible until the title screen
 * fails to draw. PixiJS resolves every asset path through its own `path` module,
 * whose URL test is literally:
 *
 *     isUrl(url) { return /^https?:/.test(url) }
 *
 * Under any other scheme, `rootname('app://game/index.html')` falls through to
 * `getProtocol()` and yields `'app://'` — the *protocol*, not the origin. Pixi
 * then joins the game's absolute asset paths onto that, so `/fpv-munition.webp`
 * becomes `app://fpv-munition.webp/`: the filename is parsed as the host, the
 * request arrives with a path of `/`, and every sprite and sound fails (or, with
 * a CSP in place, is refused as cross-origin before that). Fixing it in the game
 * is out of scope, and would be the wrong fix anyway — a shell should not need a
 * game-side change to load the game.
 *
 * So the origin is an ordinary `https://` one, on a host that cannot exist:
 * `.invalid` is reserved by RFC 2606 and never resolves, so if this handler ever
 * failed to match, the request would fail closed rather than reach a real
 * server. `protocol.handle('https')` intercepts it before any network is
 * touched; every other https URL is passed through unchanged.
 */
const HOST = 'game.drone-directive.invalid';
export const ORIGIN = `https://${HOST}`;

/**
 * A locked-down policy for a page that talks to exactly one remote host.
 *
 * Two exemptions are forced by PixiJS, and neither is negotiable from here:
 *
 * - `blob:` in `worker-src`/`script-src` — Pixi builds its texture-decode
 *   workers with `new Worker(URL.createObjectURL(new Blob([…])))`.
 * - `'unsafe-eval'` — Pixi v8 generates its batch shaders with `new Function`
 *   and refuses to initialise without it ("Current environment does not allow
 *   unsafe-eval"). The supported alternative is the `pixi.js/unsafe-eval`
 *   package, which is a change to the *game*, not to the shell; it is tracked as
 *   a follow-up issue, and this line is what would then be deleted. The exposure
 *   is narrower than it looks: every byte of script the renderer can reach is
 *   local and version-pinned, `default-src 'none'` admits no remote origin, and
 *   the renderer is sandboxed with no Node and no preload.
 *
 * `style-src 'unsafe-inline'` is likewise forced — `index.html` carries an inline
 * boot spinner, and the game hands the menu backdrop to CSS as an inline custom
 * property.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob: wss://relay.drone-directive.space",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const notFound = () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });

/**
 * Maps a request URL onto a file under `root`, or `null` if it escapes.
 *
 * The containment check compares against `root + sep` after `path.resolve`, so a
 * sibling directory whose name merely starts with the root's (`…/game-evil`)
 * fails it too — which is why it is not a bare `startsWith`.
 */
export function resolveWithinRoot(root: string, requestUrl: string): string | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(requestUrl).pathname);
  } catch {
    return null;
  }
  // The game is served from one directory; `/` means its index.
  const relative = pathname === '/' || pathname === '' ? 'index.html' : pathname.replace(/^\/+/, '');
  const resolved = path.resolve(root, relative);
  const base = path.resolve(root);
  return resolved === base || resolved.startsWith(base + path.sep) ? resolved : null;
}

/**
 * Serves `root` at {@link ORIGIN}. Every response carries the CSP, so the policy
 * holds for the document and for everything it pulls in, with no `<meta>` tag in
 * — and therefore no patch to — the game's own `index.html`.
 */
export function handleProtocol(root: string): void {
  protocol.handle('https', async (request) => {
    // Anything that is not the game keeps its normal behaviour. In practice the
    // CSP blocks all of it; the pass-through is here so that intercepting a
    // built-in scheme does not quietly change what https means app-wide.
    if (new URL(request.url).host !== HOST) {
      return net.fetch(request, { bypassCustomProtocolHandlers: true });
    }

    const file = resolveWithinRoot(root, request.url);
    if (file === null) return notFound();

    try {
      const info = await stat(file);
      if (!info.isFile()) return notFound();

      // Streamed, rather than reading a 6 MB .ogg into a Buffer to hand it
      // straight back out again.
      const body = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
          'content-length': String(info.size),
          'content-security-policy': CSP,
          // Local files, zero-cost to re-read, and staleness across an app update
          // would be silent and confusing.
          'cache-control': 'no-cache',
        },
      });
    } catch {
      return notFound();
    }
  });
}
