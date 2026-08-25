# Drone Directive — desktop

An [Electron](https://www.electronjs.org/) shell that ships
[**Drone Directive**](https://github.com/andriy-fs/drone-directive) — a browser
RTS built with React 19 and PixiJS 8 — as an offline desktop application for
Windows, macOS and Linux.

This repository contains **only the wrapper**. No game code lives here, and none
is written, forked, patched or vendored: the game arrives as a prebuilt static
site inside a version-pinned npm dependency, and is copied into the app bundle
untouched.

```
src/main/       index.ts  protocol.ts  window-state.ts  menu.ts  game.ts
scripts/        copy-game.ts  smoke.ts
electron-builder.yml
.github/workflows/release.yml
```

---

## The game dependency

```json
"dependencies": {
  "@andriy-fs/drone-directive-client": "1.0.0"
}
```

The version is **pinned exactly** — no range, no `latest`. A build of this shell
must be reproducible, and a desktop release has to sit on a version of the game
it was actually tested against. Upgrading is a deliberate one-line PR.

The package is a bundle of static assets: no entry point, nothing to `import`,
one directory (`dist/`) holding `index.html`, hashed JS/CSS, `.webp` sprites,
`sounds/*.ogg` and favicons. `scripts/copy-game.ts` resolves it through
`require.resolve('@andriy-fs/drone-directive-client/package.json')` — never a
hardcoded `node_modules` path — and copies `dist/` to `resources/game/`.

The multiplayer relay hostname is baked into the bundle at publish time. This
shell neither configures nor overrides it.

> **The package must exist first.** `@andriy-fs/drone-directive-client@1.0.0` is
> published by the game repository's `publish-client.yml`, which runs on a `v*`
> tag — and only on a tag. If `npm install` reports a 404 with a valid token,
> check that the tag was actually pushed:
>
> ```bash
> cd ../drone-directive && git push origin v1.0.0
> ```

### `NODE_AUTH_TOKEN` — read this before your first `npm install`

The package lives in **GitHub Packages**, not on npmjs.com, and GitHub Packages
has **no anonymous npm read even for a public package**. Installing therefore
needs a token:

1. Create a **classic** personal access token with the `read:packages` scope
   (fine-grained tokens cannot read GitHub Packages).
2. Export it before installing:

   ```bash
   export NODE_AUTH_TOKEN=ghp_your_token_here
   npm ci
   ```

The committed [`.npmrc`](.npmrc) points the `@andriy-fs` scope at
`https://npm.pkg.github.com` and reads that variable. **Never commit a token.**

Without it, `npm install` fails on exactly one dependency with a 404 — which
looks like a missing package rather than a missing credential, and is the first
thing every new contributor hits.

In CI the token is the repository secret **`PACKAGES_READ_TOKEN`**. The
workflow's built-in `GITHUB_TOKEN` will not do: it is scoped to _this_
repository and cannot read another repository's packages.

### Bumping the game version

```bash
npm run game:update         # move to the newest published game, then smoke-test it
git commit -am 'chore: game 1.1.0'
```

That is the whole upgrade. Nothing else in this repository knows the version.

The pin stays **exact** — `npm run game:update` passes `--save-exact`, because
npm's default would quietly rewrite it to `^1.1.0`. A range would buy nothing
(`npm ci` installs what the lockfile says, ignoring it) and would assert that any
future 1.x works with this shell, which nothing has checked: the shell is coupled
to the game through PixiJS internals it does not control — see "The game is
served from an origin" below.

**Bumping the desktop version does not pick up a newer game.** They are separate
numbers, and a desktop release cut without touching the pin ships the old game
with nothing about the build looking wrong. `npm run release` refuses to proceed
when the registry has a newer game than the pinned one; pass `--keep-game` to
ship the older one deliberately.

---

## Running it

```bash
export NODE_AUTH_TOKEN=…
npm ci
npm start        # tsc → copy the game → electron .
npm run smoke    # boot headless-ish and assert the game actually renders
npm run dist     # installers for the current platform, into release/
```

`npm run lint` and `npm run type-check` must pass; CI runs both before building.

Building a single target, cross-building for another OS, and what can and cannot
be built where: [`.docs/building.md`](.docs/building.md).

---

## How it works

### The game is served from an origin, not from `file://`

The game is built with Vite `base: '/'`, so `index.html` asks for
`/assets/index-*.js` and `/favicon.ico`. Under `file://` those absolute paths
resolve to the filesystem root, and `file://` has no origin at all — which ES
modules, `fetch`, WebAudio and a CSP all require. So the shell serves the game
directory over a scheme it controls, via `protocol.handle`, with `..` traversal
rejected after `path.resolve` and a 404 for anything missing.

**The origin is `https://game.drone-directive.invalid`, not `app://`, and that
is not a free choice.** PixiJS resolves every asset path through its own `path`
module, whose URL test is literally `/^https?:/`. Under any custom scheme,
Pixi's `rootname('app://game/index.html')` returns the _protocol_ `'app://'`
rather than the origin, and the game's absolute asset paths get joined onto it:
`/fpv-munition.webp` becomes `app://fpv-munition.webp/`, where the filename has
been parsed as the hostname. Every sprite and sound then fails. Fixing that in
the game is out of scope — and would be the wrong fix, since a shell should not
need a game-side change in order to load the game.

`.invalid` is reserved by RFC 2606 and can never resolve, so if the handler ever
failed to match, the request would fail closed instead of reaching a real
server. Requests to any other https host are passed straight through
(`bypassCustomProtocolHandlers`), where the CSP blocks them. The full reasoning
is in [`src/main/protocol.ts`](src/main/protocol.ts).

### Security posture

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
`webSecurity: true`, and **no preload at all** — the game needs nothing from
Node, so no bridge is built for it. The About box that might have justified one
is a native `dialog` in the main process instead.

Every response carries a CSP with `default-src 'none'` and no remote origin
except the relay WebSocket. Two exemptions are forced by PixiJS and cannot be
removed from this side:

| Exemption                              | Why                                                                                                                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `blob:` in `worker-src` / `script-src` | Pixi builds texture-decode workers with `new Worker(URL.createObjectURL(new Blob([…])))`.                                                                                                                    |
| `'unsafe-eval'` in `script-src`        | Pixi v8 generates its batch shaders with `new Function` and refuses to initialise without it. The supported fix is the `pixi.js/unsafe-eval` package — a change to the _game_, tracked as a follow-up issue. |

`window.open` and any navigation away from the game's origin are denied and
handed to `shell.openExternal`, which is given `http(s)` URLs only.

### Why the game is not inside the asar

`asar: true` applies to the shell's own code; the game goes in as
`extraResources`, landing at `resources/game/` beside `app.asar`. Three reasons:

1. **Licence.** This app redistributes GPL-3.0-or-later software. Its assets stay
   plain files the user can read, replace or extract with a file manager. An asar
   is not DRM, but burying someone else's free software in an archive is the
   wrong instinct for a licence built on the user's ability to get at it.
2. **Nothing is gained.** asar does not compress, and 29 MB of `.webp` and `.ogg`
   are already compressed — packing them saves zero bytes while routing every one
   of ~340 asset reads per session through the archive layer.
3. **The shell's own code still gets asar**, which is what that flag is for.

Note the `'!node_modules/**'` line in `electron-builder.yml`: electron-builder
bundles production `dependencies` regardless of `files`, and this app's only
production dependency _is_ the game package. Without it, every installer carries
the game **twice** (29 MB in `app.asar`, 29 MB in `resources/game`) and only the
second copy is ever read.

### The window

1280×720 by default, 960×600 minimum, position and size remembered in
`app.getPath('userData')/window-state.json` — dropped if the display they
referred to no longer exists, so unplugging a monitor cannot strand the window
off-screen. Background `#0d1117` and `show: false` until `ready-to-show`, so
there is no white flash. Fullscreen on F11 and on the standard macOS gesture. A
single instance only: launching a second copy focuses the first.

---

## Releases

```bash
npm run release -- patch        # or minor, major, or an explicit 1.4.0
```

That is the whole thing: it checks the repository, runs lint, type-check and the
smoke test, then bumps `package.json`, commits, tags and pushes — and pushing the
tag is what starts
[`.github/workflows/release.yml`](.github/workflows/release.yml), which builds
Windows, macOS and Linux in a matrix and attaches the artifacts to a GitHub
Release.

Add `--dry-run` to run every check and stop before anything is written, or
`--skip-smoke` if you have verified the build another way (the smoke test needs a
display; under `xvfb-run` it does not).

The script refuses to release from a branch other than `main`, from a dirty
working tree, when `main` is behind origin, or when the tag already exists. Those
are not ceremony: a tag builds three operating systems and publishes to a public
release page, and undoing one means deleting a remote tag by hand.

**Do not tag by hand.** `git tag v0.1.1` on its own leaves `package.json` at the
old version, and every installer in the release then carries the _previous_
version in its filename and in the `.deb` control file — so package managers see
no upgrade. This has already happened once, in `v0.1.1`.

Targets: Windows NSIS (x64) + portable · macOS DMG (arm64 + x64) ·
Linux AppImage + deb.

### ⚠ The binaries are unsigned

There is no code-signing certificate and no Apple Developer ID yet, so:

- **macOS** will refuse the first launch. Right-click → Open, or
  System Settings → Privacy & Security → _Open Anyway_.
- **Windows** SmartScreen will warn. More info → _Run anyway_.

Signing is a documented TODO, not an oversight. When it happens it needs:

| Platform | Secrets                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| macOS    | `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` (for notarisation) |
| Windows  | `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`                                                                        |

The `TODO(signing)` comments in `electron-builder.yml` mark the exact keys.

### Auto-update

Deliberately not wired up in this pass. The `publish:` block in
`electron-builder.yml` already emits the `latest*.yml` manifests that
`electron-updater` reads; the app side would be a
`autoUpdater.checkForUpdatesAndNotify()` call in `src/main/index.ts` after
`whenReady`. It should not land before code signing — an unsigned auto-updater is
an unsigned code path that runs without the user looking at it.

---

## Known gaps

- **`deb` cannot be built on every machine.** electron-builder shells out to
  `fpm`, whose bundled Ruby needs `libcrypt.so.1`. Where that is missing the
  AppImage still builds; CI's `ubuntu-latest` builds both.

---

## Licence

GPL-3.0-or-later — see [`LICENSE`](LICENSE).

This application bundles a build of **Drone Directive**, which is also
GPL-3.0-or-later. Its complete corresponding source is at
<https://github.com/andriy-fs/drone-directive>; the source for this shell is the
repository you are reading.
