import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app, screen, type BrowserWindow, type Rectangle } from 'electron';

export const DEFAULT_SIZE = { width: 1280, height: 720 } as const;
export const MIN_SIZE = { width: 960, height: 600 } as const;

export type WindowState = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
  fullScreen: boolean;
};

const FILE = () => path.join(app.getPath('userData'), 'window-state.json');

const DEFAULT_STATE: WindowState = { ...DEFAULT_SIZE, maximized: false, fullScreen: false };

/**
 * A remembered position is only usable if the display it referred to still
 * exists — unplugging the second monitor otherwise puts the window somewhere the
 * user cannot reach. Size is kept in that case; only the coordinates are dropped,
 * which lets Electron centre the window.
 */
function onSomeDisplay(bounds: Rectangle): boolean {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return (
      bounds.x < area.x + area.width &&
      bounds.x + bounds.width > area.x &&
      bounds.y < area.y + area.height &&
      bounds.y + bounds.height > area.y
    );
  });
}

/** Anything unreadable, malformed or off-screen falls back to the default — never to a crash on launch. */
export function loadWindowState(): WindowState {
  let saved: Partial<WindowState>;
  try {
    saved = JSON.parse(readFileSync(FILE(), 'utf8')) as Partial<WindowState>;
  } catch {
    return { ...DEFAULT_STATE };
  }

  const width = Math.max(MIN_SIZE.width, Number(saved.width) || DEFAULT_SIZE.width);
  const height = Math.max(MIN_SIZE.height, Number(saved.height) || DEFAULT_SIZE.height);
  const state: WindowState = {
    width,
    height,
    maximized: saved.maximized === true,
    fullScreen: saved.fullScreen === true,
  };

  if (typeof saved.x === 'number' && typeof saved.y === 'number') {
    const bounds = { x: saved.x, y: saved.y, width, height };
    if (onSomeDisplay(bounds)) {
      state.x = saved.x;
      state.y = saved.y;
    }
  }
  return state;
}

/**
 * Persists on `close` rather than on every `resize`/`move`: those fire dozens of
 * times a second while the user drags, and a game does not need a synchronous
 * write in that path.
 *
 * `getNormalBounds()` is deliberate — while maximized or fullscreen, `getBounds()`
 * returns the screen, and restoring that as the *restored* size would leave no way
 * back to a windowed layout.
 */
export function trackWindowState(window: BrowserWindow): void {
  window.on('close', () => {
    const bounds = window.getNormalBounds();
    const state: WindowState = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      maximized: window.isMaximized(),
      fullScreen: window.isFullScreen(),
    };
    try {
      writeFileSync(FILE(), `${JSON.stringify(state, null, 2)}\n`);
    } catch (error) {
      // Losing the layout is a nuisance; refusing to close over it is not acceptable.
      console.warn('could not save window state:', error);
    }
  });
}
