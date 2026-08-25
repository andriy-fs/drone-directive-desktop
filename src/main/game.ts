import { existsSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

/**
 * Where the game's `dist/` tree lives, in the two places it can live.
 *
 * Packaged, it is `extraResources` — a plain directory beside `app.asar` (see
 * README § "Why the game is not inside the asar"). In development it is
 * `resources/game/`, which `scripts/copy-game.ts` writes on every build.
 *
 * The npm package is never read directly at runtime: `node_modules` does not
 * ship, and reading from it in dev but from `resources/` in production would
 * leave the packaged path as the one nobody exercises.
 */
export const gameRoot = app.isPackaged
  ? path.join(process.resourcesPath, 'game')
  : path.join(app.getAppPath(), 'resources', 'game');

/** A missing tree is a build mistake, and is far cheaper to catch here than as a blank window. */
export function assertGamePresent(root: string = gameRoot): void {
  if (!existsSync(path.join(root, 'index.html'))) {
    throw new Error(
      `No game build at ${root} (index.html missing). Run \`npm run build\`; if that fails to install ` +
        '@andriy-fs/drone-directive-client, see README § "The game dependency".',
    );
  }
}
