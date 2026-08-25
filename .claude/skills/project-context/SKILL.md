---
name: project-context
description: >-
  Hard-won context for andriy-fs/drone-directive-desktop that is not visible in
  the code: decisions that look like mistakes until you know why, traps in the
  local toolchain that produce misleading errors, and the parts of the publish
  chain that live in another repository. Load at the start of any session that
  touches this repo — before changing the protocol handler, the CSP, the icons,
  electron-builder config, the release workflow, or the game dependency, and
  before diagnosing any "it builds but does not run" symptom.
---

# What a new context needs to know

`CLAUDE.md` describes what this repository _is_. This file is the part that cost
something to learn: things that look wrong and are not, and things that fail in a
way that points at the wrong cause.

Everything here was verified by running it, not inferred.

## Decisions that look like mistakes

Do not "fix" any of these without reading the reasoning first. Each was arrived
at by hitting the failure.

### The origin is `https://…invalid`, not `app://`

A custom scheme is the standard Electron answer and it **cannot work here**.
PixiJS resolves every asset path through its own `path` module, whose URL test is
literally `isUrl(url) { return /^https?:/.test(url) }`. Under any other scheme,
`rootname('app://game/index.html')` returns the protocol `'app://'` rather than
the origin, and the game's absolute asset paths get joined onto it — so
`/fpv-munition.webp` becomes `app://fpv-munition.webp/`, with the **filename
parsed as the hostname**.

Symptom: the page loads, the bundle parses, and every sprite and sound fails —
either as a 404 with a path of `/`, or, with a CSP in place, as a cross-origin
refusal that mentions a hostname that is obviously a filename.

The fix is `protocol.handle('https', …)` on a reserved `.invalid` host. Full
reasoning at the top of `src/main/protocol.ts`.

### `'unsafe-eval'` in the CSP

Pixi v8 generates its batch shaders with `new Function` and **refuses to
initialise** without it: `Current environment does not allow unsafe-eval, please
use pixi.js/unsafe-eval module`. `blob:` in `worker-src`/`script-src` is forced
the same way, by Pixi's texture-decode workers.

Neither can be removed from this side. The supported fix is the
`pixi.js/unsafe-eval` package — a change to the **game**, which is out of scope
for this repository.

### `'!node_modules/**'` in `electron-builder.yml`

electron-builder bundles production `dependencies` **regardless of `files`**, and
the only production dependency here _is_ the 29 MB game package. Without the
exclusion every installer carries the game twice — once in `app.asar`, once in
`resources/game` — and only the second copy is ever read. Deleting this line
looks harmless and silently doubles the download.

### `build/icons/` as well as `build/icon.png`

Linux does not scale an icon for you. Given a single PNG, electron-builder
installs it into the one `hicolor` directory matching its actual pixel size — and
the freedesktop hicolor theme **declares no `1024x1024`** (it stops at 512).
The file lands on disk where no icon theme looks, the build exits 0, and the app
appears in the launcher with no icon. `v0.1.0` shipped exactly that way.

Verifying an icon change needs the check in `.docs/building.md` § "Verifying an
icon change" — a green build proves nothing here.

### There is no preload

Deliberate, not an omission. The game asks for nothing from Node, so no bridge
exists: no preload, no `contextBridge`, no injected global. The About box that
might have justified one is a native `dialog` in `src/main/menu.ts`.

Anything that wants to add a page-visible API — including a "detect the desktop
app" flag for the website — should use `navigator.userAgent.includes('Electron')`
instead. A runtime config API was explicitly ruled out of scope.

## Local-environment traps

These produce errors that point at the wrong thing. Recognise them before
debugging the project.

### `ELECTRON_RUN_AS_NODE=1` is set in this environment

The VS Code integrated terminal exports it. Electron then runs as **plain Node**,
so `electron .` fails with:

```
SyntaxError: The requested module 'electron' does not provide an export named 'protocol'
```

which reads like an ESM/CJS problem and is not. Also `electron --version` prints
a _Node_ version. Always launch through:

```bash
env -u ELECTRON_RUN_AS_NODE -u ELECTRON_NO_ATTACH_CONSOLE ./node_modules/electron/dist/electron …
```

### `chrome-sandbox` is not SUID on a dev checkout

Electron aborts with a message about mode 4755. Add `--no-sandbox` for local
runs. That is _Chromium's_ process sandbox and is unrelated to
`webPreferences.sandbox: true`, which stays on. Installed packages set the bit
correctly, so this never affects users.

### Electron's binary is sometimes missing after `npm ci`

The postinstall does not always fetch it in this sandbox, and the symptom is exit
code 127. Fix:

```bash
node node_modules/electron/install.js
```

### `deb` fails on `libcrypt.so.1`

Not a misconfiguration — the `fpm` command line electron-builder generates is
correct. It fails inside sandboxed shells (a Flatpak-packaged editor's terminal)
and succeeds in the host terminal and on CI. See `.docs/building.md`.

### `git push` does not work from the agent environment

No credential helper, no stored credentials, and the SSH key present on the
machine is rejected by GitHub. A token in the remote URL is blocked by the
permission classifier — correctly, so do not attempt to work around it. **Every
push, tag and release is the user's step.** Prepare the commits, then hand over
the exact commands.

## The publish chain lives in another repository

`@andriy-fs/drone-directive-client` is built and published by
`andriy-fs/drone-directive`, on a `v*` tag only. Consequences:

- **A valid token and a 404 means the package was never published**, not that
  auth failed. GitHub Packages answers 404 rather than 401, so the two look
  identical. Check `git ls-remote --tags` on the game repo before suspecting
  credentials: the tag has to be _pushed_, not just created locally.
- The token must be a **classic** PAT with `read:packages`. Fine-grained tokens
  are not accepted by `npm.pkg.github.com`, and a workflow's built-in
  `GITHUB_TOKEN` cannot read another repository's packages — hence the
  `PACKAGES_READ_TOKEN` repository secret.
- The published tarball can hold **fewer files** than a locally staged copy of
  the game's `dist/`. `npm publish` excludes things like a stray `.tmp/` of
  intermediate build artifacts. Fewer files is not evidence of a broken package;
  diff the trees before worrying.

## Testing

`scripts/smoke.ts` is the only test, and that is on purpose: every failure above
that reached the renderer produced a window that looked fine and rendered
nothing. It boots the real handler and asserts a canvas, a decoded image, a
fetched sound, and that every resource loaded over the app's own origin.

It must filter Electron's own `Electron Security Warning` about `unsafe-eval`,
which is printed in any unpackaged app and would otherwise make the test
unpassable.

Run it before claiming anything works. CI does not.

## Repository shape oddities

- The GitHub repository was **empty** at first push — no initial commit — so the
  first branch pushed became the default, and there was never a `main` to open a
  PR against. It is `main` now; ordinary branch-and-PR flow applies from here.
- `.docs/internal/` is gitignored (agent prompts, private notes); `.docs/*.md` is
  tracked. This mirrors the game repository.
- Release asset filenames carry the version, so
  `…/releases/latest/download/<name>` does **not** give a permanent link. Making
  one needs `artifactName` without `${version}` in `electron-builder.yml`.

## Where the reasoning actually lives

Prefer these over re-deriving anything:

|                                          |                                                            |
| ---------------------------------------- | ---------------------------------------------------------- |
| `src/main/protocol.ts`                   | the origin, the CSP, and why both are shaped that way      |
| `electron-builder.yml`                   | packaging, why the game is `extraResources`, signing TODOs |
| `build/README.md`                        | the icon set and the hicolor trap                          |
| `.docs/building.md`                      | manual builds, cross-compilation limits, verification      |
| `README.md`                              | the dependency, tokens, releases, unsigned-binary warning  |
| `.claude/skills/dd-desktop-conventions/` | English-only, single-line commits                          |
