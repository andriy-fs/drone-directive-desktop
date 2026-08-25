/**
 * Stages the published game build at `resources/game/`.
 *
 * `@andriy-fs/drone-directive-client` is a package of static assets: no entry
 * point, nothing to import, one `dist/` directory. This script finds it and
 * copies it, and that copy is what both `npm start` and `electron-builder` serve
 * — so the path exercised in development is the path that ships.
 *
 * The tree is treated as opaque and read-only. Nothing here rewrites a URL,
 * injects a tag or patches a file; the game is somebody else's build output and
 * the moment this script starts editing it, "pinned version" stops meaning
 * anything. Run by `npm run build`.
 */
import { cp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE = '@andriy-fs/drone-directive-client';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const destination = path.join(root, 'resources/game');

function fail(message: string): never {
  console.error(`copy-game: ${message}`);
  process.exit(1);
}

/**
 * Resolved through the package's own manifest rather than a hardcoded
 * `node_modules/@andriy-fs/...` path, so hoisting, a workspace layout or
 * whatever npm does next cannot quietly break it.
 */
let manifestPath: string;
try {
  manifestPath = createRequire(import.meta.url).resolve(`${PACKAGE}/package.json`);
} catch {
  fail(
    `cannot resolve ${PACKAGE}. It lives in GitHub Packages, which has no anonymous read:\n` +
      '  export NODE_AUTH_TOKEN=<classic PAT with read:packages> && npm install\n' +
      '  See README § "The game dependency".',
  );
}

const source = path.join(path.dirname(manifestPath), 'dist');
if (!existsSync(path.join(source, 'index.html'))) {
  fail(`${PACKAGE} has no dist/index.html at ${source} — the package is not the static-asset bundle it should be.`);
}

const { version } = JSON.parse(await readFile(manifestPath, 'utf8')) as { version: string };

// A full replace, not a merge: leftovers from a previous version's hashed assets
// would be dead weight in the installer and, worse, would make a stale build look
// like it still worked.
await rm(destination, { recursive: true, force: true });
await mkdir(path.dirname(destination), { recursive: true });
await cp(source, destination, { recursive: true });

const files = await readdir(destination, { recursive: true });
console.log(`copy-game: staged ${PACKAGE}@${version} → resources/game (${files.length} entries)`);
