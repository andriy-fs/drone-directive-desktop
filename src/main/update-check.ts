import { app, dialog, net, shell } from 'electron';

/**
 * Asks the relay whether a newer release of this shell exists, and tells the
 * player if one does.
 *
 * It is a *check*, not an updater: nothing is downloaded and nothing is installed
 * (auto-update stays out of scope — see README). The most it does is open the
 * releases page in the user's browser.
 *
 * Why this exists at all: the game's own `useUpdateCheck` is silent in here. It
 * fetches `/version.json`, which under this shell is served by `protocol.ts` out of
 * the bundle itself, so the packaged game always compares equal to itself. A player
 * who never goes online therefore never learns that anything newer was released —
 * the relay's `VersionMismatch` is the only other signal, and it needs a match.
 *
 * Why the relay and not GitHub's API: it answers the same question, and it is rate
 * limited per IP. Ours also lets the project see that the desktop build has users
 * at all, which nothing else does — the request carries the version, the OS and the
 * architecture, no identifier of any kind, and the server stores exactly that plus
 * the country Cloudflare derives. README § "What this app sends" says so in the
 * user's own words, and `--no-update-check` turns it off.
 */

/** The relay route. Overridable so it can be pointed at `wrangler dev`. */
const ENDPOINT = process.env.DD_UPDATE_ENDPOINT ?? 'https://relay.drone-directive.space/desktop/version';

/** A check nobody asked for must never hold anything up. */
const TIMEOUT_MS = 5000;

/**
 * How long after the window appears the automatic check runs. Long enough that it
 * cannot compete with the first paint, which is the one moment this app is busy.
 */
const STARTUP_DELAY_MS = 10_000;

const RELEASES_FALLBACK = 'https://github.com/andriy-fs/drone-directive-desktop/releases/latest';

interface LatestRelease {
  latest: string;
  url: string;
}

/**
 * Opt-out, in the two forms a desktop app can offer without a settings screen: a
 * launch flag and an environment variable. Checked at call time rather than cached,
 * because the menu item asks too.
 */
export function updateCheckDisabled(): boolean {
  return process.argv.includes('--no-update-check') || Boolean(process.env.DD_NO_UPDATE_CHECK);
}

/** Numeric, not lexicographic — "0.10.0" is newer than "0.9.0" and sorts before it. */
function isNewer(candidate: string, than: string): boolean {
  const a = candidate.split('.').map(Number);
  const b = than.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const [x = 0, y = 0] = [a[i], b[i]];
    if (x !== y) return x > y;
  }
  return false;
}

function isRelease(value: unknown): value is LatestRelease {
  if (typeof value !== 'object' || value === null) return false;
  const { latest, url } = value as Partial<LatestRelease>;
  return /^\d+\.\d+\.\d+$/.test(String(latest)) && typeof url === 'string';
}

/**
 * `net.fetch` rather than the global one: it goes through Chromium's network stack,
 * which is what respects the system proxy the user has configured.
 */
async function fetchLatest(): Promise<LatestRelease | null> {
  const query = new URLSearchParams({ shell: app.getVersion(), os: process.platform, arch: process.arch });
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    // No `cache` option — Electron's `net.fetch` does not take one. It does not
    // need it either: the route answers `cache-control: no-store`.
    const response = await net.fetch(`${ENDPOINT}?${query}`, { signal: abort.signal });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return isRelease(body) ? body : null;
  } catch {
    // Offline, DNS, a proxy login page, a 500, unparseable JSON. None of them are
    // news about this app, and the automatic path says nothing about any of them.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `interactive` is the difference between the menu item and the launch check: the
 * menu item was asked for, so it answers even when the answer is "nothing to do" or
 * "could not reach the server". The launch check speaks only when there is news.
 */
export async function checkForUpdate({ interactive }: { interactive: boolean }): Promise<void> {
  const release = await fetchLatest();
  const current = app.getVersion();

  if (release === null) {
    if (interactive) {
      await dialog.showMessageBox({
        type: 'warning',
        title: 'Check for updates',
        message: 'Could not check for updates',
        detail: 'The update server could not be reached. Your copy still works exactly as it did.',
        buttons: ['OK'],
      });
    }
    return;
  }

  if (!isNewer(release.latest, current)) {
    if (interactive) {
      await dialog.showMessageBox({
        type: 'info',
        title: 'Check for updates',
        message: 'Drone Directive is up to date',
        detail: `You are running ${current}, the newest release.`,
        buttons: ['OK'],
      });
    }
    return;
  }

  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: 'Update available',
    message: `Drone Directive ${release.latest} is available`,
    detail: `You are running ${current}. The installers are on the releases page; this app does not update itself.`,
    buttons: ['Download', 'Later'],
    defaultId: 0,
    cancelId: 1,
  });

  // Only ever an https URL, and only through the browser — the same rule
  // `guardNavigation` applies to every other link that leaves this app.
  if (response === 0) {
    const url = release.url.startsWith('https://') ? release.url : RELEASES_FALLBACK;
    void shell.openExternal(url);
  }
}

/**
 * The automatic check, from `createWindow` once the window is up.
 *
 * Packaged builds only: `npm start`, `npm run smoke` and CI have no business
 * talking to the production relay, and a development run that pinged it would put
 * the project's own machines in its own user count.
 */
export function scheduleUpdateCheck(): void {
  if (!app.isPackaged || updateCheckDisabled()) return;
  setTimeout(() => void checkForUpdate({ interactive: false }), STARTUP_DELAY_MS);
}
