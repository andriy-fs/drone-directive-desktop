import { app, dialog, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { checkForUpdate } from './update-check.js';

const REPOSITORY = 'https://github.com/andriy-fs/drone-directive';
const DESKTOP_REPOSITORY = 'https://github.com/andriy-fs/drone-directive-desktop';

/**
 * A deliberately small menu. Electron's default template is written for a text
 * editor — Edit with Cut/Copy/Paste, macOS Speech and Emoji submenus, a Window
 * menu of tabs — none of which a full-screen RTS canvas has any use for. What is
 * left is the three things a desktop app genuinely owes the user: quit, a way
 * back out of fullscreen when the keyboard shortcut is forgotten, and where to
 * find the source.
 *
 * The About box is a native `dialog`, not an HTML page: it is the only reason
 * this app might have needed a preload and a `contextBridge`, and skipping it
 * means the renderer keeps a completely empty bridge to the main process.
 */
export function buildMenu(isDevelopment: boolean): void {
  const isMac = process.platform === 'darwin';

  const about = () => {
    void dialog.showMessageBox({
      type: 'info',
      title: 'About Drone Directive',
      message: 'Drone Directive',
      detail: [
        `Desktop shell ${app.getVersion()}`,
        `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}`,
        '',
        'Free software under the GNU GPL v3 or later.',
        `Game source: ${REPOSITORY}`,
        `Desktop shell source: ${DESKTOP_REPOSITORY}`,
      ].join('\n'),
      buttons: ['OK'],
    });
  };

  const appMenu: MenuItemConstructorOptions = {
    label: isMac ? app.name : '&Game',
    submenu: [
      { label: 'About Drone Directive', click: about },
      // Always here, even when the automatic check is switched off: asking is a
      // different thing from being told, and the flag only silences the latter.
      {
        // The id is what lets the smoke/e2e driver fire this item without a mouse.
        id: 'check-for-updates',
        label: 'Check for Updates…',
        click: () => void checkForUpdate({ interactive: true }),
      },
      { type: 'separator' },
      ...(isMac
        ? ([{ role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }] as const)
        : []),
      { role: 'quit' },
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: '&View',
    submenu: [
      // The role already binds F11 on Windows/Linux and Ctrl+Cmd+F on macOS, and
      // as a menu accelerator it fires before the page — so the game's own key
      // handling cannot swallow it. Listing it here is only for discoverability.
      { role: 'togglefullscreen' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { role: 'minimize' },
      ...(isDevelopment ? ([{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }] as const) : []),
    ],
  };

  const helpMenu: MenuItemConstructorOptions = {
    label: '&Help',
    role: 'help',
    submenu: [
      { label: 'Game source (GitHub)', click: () => void shell.openExternal(REPOSITORY) },
      { label: 'Desktop shell source (GitHub)', click: () => void shell.openExternal(DESKTOP_REPOSITORY) },
      { label: 'Report an issue', click: () => void shell.openExternal(`${DESKTOP_REPOSITORY}/issues`) },
    ],
  };

  Menu.setApplicationMenu(Menu.buildFromTemplate([appMenu, viewMenu, helpMenu]));
}
