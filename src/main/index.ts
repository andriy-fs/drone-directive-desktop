import { app, BrowserWindow, shell } from 'electron';
import { hideFullScreenHint, showFullScreenHint } from './fullscreen-hint.js';
import { assertGamePresent, gameRoot } from './game.js';
import { buildMenu } from './menu.js';
import { handleProtocol, ORIGIN } from './protocol.js';
import { scheduleUpdateCheck } from './update-check.js';
import { loadWindowState, MIN_SIZE, trackWindowState } from './window-state.js';

/** The game's own page colour, so the window never flashes white before the first paint. */
const BACKGROUND = '#0d1117';

const isDevelopment = !app.isPackaged;

/**
 * Held rather than looked up: the fullscreen hint is a second `BrowserWindow`,
 * so `getAllWindows()[0]` is no longer reliably the game.
 */
let gameWindow: BrowserWindow | null = null;

/**
 * Two copies of an RTS is never what the user wants — the second one would fight
 * the first over the window-state file and the audio device. The lock has to be
 * taken before anything else, and the loser exits immediately.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  main();
}

function main(): void {
  app.on('second-instance', () => {
    if (!gameWindow) return;
    if (gameWindow.isMinimized()) gameWindow.restore();
    gameWindow.focus();
  });

  app.whenReady().then(() => {
    assertGamePresent();
    handleProtocol(gameRoot);
    buildMenu(isDevelopment);
    createWindow();

    // macOS keeps the app alive with no windows; clicking the dock icon reopens one.
    app.on('activate', () => {
      if (!gameWindow) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

function createWindow(): void {
  const state = loadWindowState();

  const window = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    backgroundColor: BACKGROUND,
    // Painting an empty window and then swapping in the game is the white-flash
    // everyone recognises; `ready-to-show` is the fix.
    show: false,
    title: 'Drone Directive',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // The game asks for nothing from Node, so nothing is offered: no preload,
      // no `contextBridge`, and a sandboxed renderer. The About box that would
      // have justified a bridge is a native dialog instead (see menu.ts).
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      // WebGL needs a canvas that keeps its buffer between frames; Pixi manages
      // its own presentation and does not want Chromium throttling it in the
      // background mid-match.
      backgroundThrottling: false,
    },
  });

  gameWindow = window;
  window.on('closed', () => {
    gameWindow = null;
  });

  trackWindowState(window);
  guardNavigation(window);

  // Fullscreen the *page* asked for, through `requestFullscreen()` — the game's
  // own titlebar button. Chromium paints its own "Press Esc to exit full screen"
  // for that one, so the shell's bubble has to stay out of its way: two banners
  // naming two different keys is worse than either alone. The View menu's
  // fullscreen is still the case the bubble exists for (see fullscreen-hint.ts).
  let htmlFullScreen = false;
  window.webContents.on('enter-html-full-screen', () => {
    htmlFullScreen = true;
    // In case the window event won the race and the bubble is already up.
    hideFullScreenHint();
  });
  window.webContents.on('leave-html-full-screen', () => {
    htmlFullScreen = false;
  });

  // Restoring a remembered fullscreen state below fires this too, which is
  // exactly right: launching straight into fullscreen is the case where the user
  // has had no chance to see the View menu at all.
  //
  // Deferred by a tick because `enter-full-screen` (the window) and
  // `enter-html-full-screen` (its contents) are not ordered against each other,
  // so a same-turn read of the flag would sometimes come too early. The window is
  // re-checked instead of the timer being cancelled: leaving fullscreen again
  // within one tick is the only thing that could invalidate it.
  window.on('enter-full-screen', () => {
    setTimeout(() => {
      if (!htmlFullScreen && !window.isDestroyed() && window.isFullScreen()) showFullScreenHint(window);
    }, 0);
  });
  window.on('leave-full-screen', hideFullScreenHint);
  window.on('close', hideFullScreenHint);

  window.once('ready-to-show', () => {
    if (state.fullScreen) window.setFullScreen(true);
    else if (state.maximized) window.maximize();
    window.show();
    // Well after the window is up, and only in a packaged build — see update-check.ts.
    scheduleUpdateCheck();
  });

  void window.loadURL(`${ORIGIN}/index.html`);
}

/**
 * Nothing may navigate this window away from the game, and nothing may open a
 * second one. Links to the source repository, a Discord, anything the page might
 * carry, belong in the user's browser — inside an Electron window they would be
 * a chromeless, address-bar-less view of a remote site, which is both a bad
 * experience and the shape of a phishing surface.
 *
 * `shell.openExternal` is given only http(s): handing it an arbitrary scheme is
 * a known way to launch a local program via a URL.
 */
function guardNavigation(window: BrowserWindow): void {
  const openExternally = (url: string) => {
    const { protocol } = new URL(url);
    if (protocol === 'https:' || protocol === 'http:') void shell.openExternal(url);
  };

  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin === ORIGIN) return;
    event.preventDefault();
    openExternally(url);
  });

  // Belt and braces: the renderer has no preload, so this should never fire.
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
}
