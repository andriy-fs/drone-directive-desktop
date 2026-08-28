import { BrowserWindow, screen } from 'electron';

/**
 * A transient "press F11" bubble, shown whenever the window enters fullscreen.
 *
 * Chromium paints its own "Press Esc to exit full screen" for fullscreen that a
 * *page* asked for through `requestFullscreen()`. The View menu's fullscreen is
 * a window-manager state that Chromium knows nothing about, so it paints
 * nothing and Esc does nothing — and on Linux the menu bar is hidden while
 * fullscreen, which leaves a user who has not memorised F11 with no way back
 * that they can see.
 *
 * Rebinding Esc is not the fix. The game already uses it to pause and to close
 * the chat, and a menu accelerator fires before the page (see menu.ts), so the
 * shell would be taking the key away from the game in the very mode the game is
 * played in. A hint the shell paints itself takes nothing away from anyone.
 *
 * It is a separate frameless window rather than an element injected into the
 * page, because the renderer belongs to the game and this repository does not
 * write game code — not even at runtime, into its DOM.
 */

const VISIBLE_MS = 3000;
const SIZE = { width: 460, height: 96 } as const;
const MARGIN_TOP = 48;

/**
 * Inline, as a `data:` URL: the alternative is a file that `copy-game.ts` would
 * have to stage and `electron-builder.yml` would have to ship, for one <div>.
 * The CSP is spelled out because this document is the only one in the app that
 * does not come through the protocol handler, which sets its own.
 */
const PAGE = `<!doctype html>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; }
  body {
    display: flex; align-items: center; justify-content: center;
    font: 500 15px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    -webkit-user-select: none; user-select: none; cursor: default;
  }
  .pill {
    padding: 14px 22px; border-radius: 10px; color: #e6edf3;
    background: rgba(13, 17, 23, 0.92); border: 1px solid rgba(230, 237, 243, 0.14);
  }
  kbd {
    font: inherit; font-weight: 700; padding: 2px 7px; margin: 0 2px;
    border-radius: 5px; background: rgba(230, 237, 243, 0.12);
  }
</style>
<div class="pill">Press <kbd>F11</kbd> to leave full screen</div>`;

let hint: BrowserWindow | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export function showFullScreenHint(parent: BrowserWindow): void {
  // Entering fullscreen twice without leaving it should not stack two bubbles,
  // and the second one must get the full three seconds.
  hideFullScreenHint();

  const area = screen.getDisplayMatching(parent.getBounds()).bounds;

  hint = new BrowserWindow({
    x: Math.round(area.x + (area.width - SIZE.width) / 2),
    y: area.y + MARGIN_TOP,
    width: SIZE.width,
    height: SIZE.height,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // Taking focus would pull the keyboard out of a match in order to talk about
    // a key the user is trying to press.
    focusable: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  // Sitting above a fullscreen window needs the screen-saver level; plain
  // `alwaysOnTop: true` loses to a fullscreen window on several Linux WMs.
  hint.setAlwaysOnTop(true, 'screen-saver');
  hint.setIgnoreMouseEvents(true);

  // `showInactive`, not `show`: the same reason as `focusable: false`.
  hint.once('ready-to-show', () => hint?.showInactive());
  void hint.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`);

  timer = setTimeout(hideFullScreenHint, VISIBLE_MS);
}

/**
 * `destroy()` rather than `close()`: there is nothing to unload, and this window
 * must never be the one still standing when `window-all-closed` decides whether
 * the app should quit.
 */
export function hideFullScreenHint(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (hint !== null && !hint.isDestroyed()) hint.destroy();
  hint = null;
}
