/**
 * Boots the game against the real handler and asserts it actually runs.
 *
 * This is the one test worth having here. The interesting failures in a shell
 * like this are all integration failures — an origin PixiJS cannot resolve
 * against, an absolute `/assets/…` URL that 404s, a CSP that blocks Pixi's blob
 * worker or its `new Function` shader compiler — and every one of them produces
 * a window that looks fine and renders nothing. Unit tests around a thirty-line
 * path resolver would have caught none of them; this caught all three.
 *
 * Run with `npm run smoke` (needs a display; on a headless machine, `xvfb-run`).
 * Exits non-zero with the reason on failure.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { handleProtocol, ORIGIN } from '../src/main/protocol.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const gameRoot = path.join(root, 'resources/game');
const TIMEOUT_MS = 60_000;

/**
 * Electron prints its own advisory about `unsafe-eval` in the console of any
 * unpackaged app. It is aimed at the developer, not the page, it does not appear
 * in a packaged build, and the exemption it names is forced by PixiJS and
 * explained in protocol.ts. Failing on it would mean this test can never pass.
 */
const isElectronOwnWarning = (message: string) => message.includes('Electron Security Warning');

const problems: string[] = [];

app.whenReady().then(async () => {
  handleProtocol(gameRoot);

  const window = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  });

  window.webContents.on('console-message', (event) => {
    if (event.level !== 'error' && event.level !== 'warning') return;
    if (isElectronOwnWarning(event.message)) return;
    problems.push(`console ${event.level}: ${event.message}`);
  });
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    problems.push(`did-fail-load ${code} ${description} ${url}`);
  });

  try {
    await window.loadURL(`${ORIGIN}/index.html`);

    // The title screen is React + Pixi: the canvas exists only once the bundle
    // has parsed, the locale chunk has loaded and WebGL has come up.
    const canvas = await waitFor(
      window,
      `(() => { const c = document.querySelector('canvas'); return c && c.width > 0 ? c.width + 'x' + c.height : null; })()`,
    );

    // Assets, not just markup: a decoded image and a fetched sound prove the
    // handler is serving real bytes with a type the renderer accepts, which a
    // 404 answered as HTML would not.
    const backdrop = await evaluate(
      window,
      `new Promise((resolve) => {
         const img = new Image();
         img.onload = () => resolve(img.naturalWidth + 'x' + img.naturalHeight);
         img.onerror = () => resolve('FAILED');
         img.src = '/menu-backdrop.webp';
       })`,
    );
    if (backdrop === 'FAILED') problems.push('menu-backdrop.webp did not load');

    const sound = await evaluate(
      window,
      `fetch('/sounds/interface/click_001.ogg')
         .then((r) => r.ok ? r.arrayBuffer().then((b) => r.headers.get('content-type') + ' ' + b.byteLength + 'B') : 'HTTP ' + r.status)
         .catch((e) => 'FAILED ' + e.message)`,
    );
    if (!sound.startsWith('audio/ogg')) problems.push(`sound fetch returned ${sound}`);

    // Nothing may be served over file:// — the whole point of the origin.
    const schemes = await evaluate(
      window,
      `[...new Set(performance.getEntriesByType('resource').map((e) => new URL(e.name).protocol))].sort().join(',')`,
    );
    if (schemes !== 'https:') problems.push(`resources loaded over unexpected schemes: ${schemes}`);

    report(`canvas ${canvas}`, `backdrop ${backdrop}`, `sound ${sound}`, `schemes ${schemes}`);
  } catch (error) {
    problems.push(String(error));
    report();
  }
});

function evaluate(window: BrowserWindow, expression: string): Promise<string> {
  return window.webContents.executeJavaScript(expression) as Promise<string>;
}

async function waitFor(window: BrowserWindow, expression: string): Promise<string> {
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const value = await evaluate(window, expression);
    if (value) return value;
    if (Date.now() > deadline)
      throw new Error(`timed out after ${TIMEOUT_MS}ms waiting for: ${expression.slice(0, 70)}…`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function report(...facts: string[]): void {
  for (const fact of facts) console.log(`smoke: ${fact}`);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`smoke: ${problem}`);
    console.error(`smoke: FAILED (${problems.length} problem${problems.length === 1 ? '' : 's'})`);
    app.exit(1);
    return;
  }
  console.log('smoke: OK');
  app.exit(0);
}
