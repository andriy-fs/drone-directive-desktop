# Building installers by hand

Releases are built by CI on a `v*` tag — that is the path that produces what
users download, and nothing here replaces it. Build by hand to _verify_ something
before tagging: that a config change survives packaging, that an icon appears in
the launcher, that the app runs outside a dev tree.

## The short version

```bash
npm run dist          # every target for the current OS, into release/
npm run dist:dir      # unpacked directory only — much faster, no installer
```

`npm run dist` is `npm run build` (tsc, then stage the game into `resources/`)
followed by electron-builder with no target filter, so it builds everything
`electron-builder.yml` lists for the platform you are on.

Reach past it when you want **one** target, or a target for another OS:

```bash
npx electron-builder --config electron-builder.yml --linux deb --publish never
npx electron-builder --config electron-builder.yml --win nsis --publish never
npx electron-builder --config electron-builder.yml --mac dmg --arm64 --publish never
```

Note the missing `npm run build`: invoking `electron-builder` directly does
**not** compile the shell or stage the game. Run `npm run build` first, or you
will package whatever `out/` and `resources/` happened to contain — which, on a
clean checkout, is nothing.

`--publish never` is not optional in local use. `electron-builder.yml` declares a
`github` publish provider for CI's benefit, and without the flag a local build
can try to upload to a release.

## What can be built where

Verified on this project, not assumed:

| Target                    | On Linux                             | On macOS   | On Windows |
| ------------------------- | ------------------------------------ | ---------- | ---------- |
| `--linux AppImage`        | yes                                  | no         | no         |
| `--linux deb`             | yes, needs working `fpm` (see below) | no         | no         |
| `--win dir` (unpacked)    | **yes**                              | yes        | yes        |
| `--win nsis` / `portable` | needs **wine**                       | needs wine | yes        |
| `--mac dmg`               | no — needs macOS `sips`/`hdiutil`    | yes        | no         |

The two failures are unmistakable, so you do not have to guess which you hit:

```
⨯ wine process failed ENOENT ... spawn wine ENOENT      # NSIS without wine
⨯ sips process failed ENOENT ... spawn sips ENOENT      # macOS target off macOS
```

`--win dir` is the useful exception: producing `release/win-unpacked/` needs no
wine at all, only the installer step does. It is enough to confirm that the
Windows bundle has the right contents.

**macOS cannot be cross-built.** DMG creation uses Apple's own tools. There is no
workaround, and CI's `macos-latest` runner is the only place it happens.

**Windows can be cross-built** with the maintained Docker image, if you need an
`.exe` without a Windows machine:

```bash
docker run --rm -ti -v "$PWD":/project -w /project \
  electronuserland/builder:wine \
  sh -c "npm ci && npm run build && npx electron-builder --win --publish never"
```

That still needs `NODE_AUTH_TOKEN` in the container for `npm ci` — see README
§ "The game dependency".

## Architectures

Targets carry their own arch list in `electron-builder.yml`; a CLI flag narrows
it, which is what you want when iterating:

```bash
npx electron-builder --config electron-builder.yml --mac dmg --x64 --publish never
```

`--x64`, `--arm64`, `--armv7l`, `--ia32`. Cross-arch within macOS works (an
arm64 runner builds both DMGs — electron-builder downloads the other Electron
binary), which is how CI produces Intel and Apple Silicon from one job.

## `fpm`, and why `deb` may fail locally

The `deb` target shells out to `fpm`, which electron-builder downloads as a
self-contained Ruby bundle. That Ruby links against `libcrypt.so.1`, and where it
is missing the build dies with:

```
ruby: error while loading shared libraries: libcrypt.so.1: cannot open shared object file
```

This is not a project misconfiguration — the `fpm` command line electron-builder
generates is correct, and the same build succeeds on CI's `ubuntu-latest`.

It bites in **sandboxed shells** whose runtime does not carry that library — a
Flatpak-packaged editor's integrated terminal, for instance — while the same
command in the host terminal works. If `deb` fails this way, try a plain
terminal before debugging anything else. On a host genuinely missing it,
`libxcrypt-compat` (or the distribution's equivalent) provides it. Every other
target is unaffected, so `AppImage` still builds.

## Verifying an icon change

Linux icons are the one thing a successful build does not prove: a file can be
installed into a directory no icon theme reads, and everything still exits 0.
`v0.1.0` shipped exactly that way (`build/README.md` has the reason).

electron-builder prints the `fpm` command line it is about to run, which is where
the mapping is visible — this works even when the build then fails on `fpm`
itself:

```bash
npx electron-builder --config electron-builder.yml --linux deb --publish never 2>&1 |
  grep -o 'build/icons/[^ ]*=/usr/share/icons/[^ ]*'
```

Every destination must be a size the hicolor theme declares (16 through 512;
there is **no** `1024x1024`). For AppImage, look inside the built artifact:

```bash
./release/*.AppImage --appimage-extract 'usr/share/icons/*' >/dev/null
find squashfs-root -name '*.png'
```

## Where things land

| Path                                             | What                               | Tracked |
| ------------------------------------------------ | ---------------------------------- | ------- |
| `out/`                                           | compiled shell (`tsc`)             | no      |
| `resources/game/`                                | the staged game build              | no      |
| `release/`                                       | installers and `*-unpacked/`       | no      |
| `~/.cache/electron`, `~/.cache/electron-builder` | Electron binaries, wine, nsis, fpm | —       |

All three are in `.gitignore`. `npm run clean` removes them; the caches are worth
keeping, since a cold build re-downloads ~200 MB.

## Running an unpacked build

```bash
./release/linux-unpacked/drone-directive-desktop
```

On a machine whose `chrome-sandbox` is not `root:root` mode 4755, Electron aborts
with a message saying so. `--no-sandbox` gets past it for a local check — it
disables _Chromium's_ process sandbox, which is unrelated to the renderer's
`sandbox: true` in `webPreferences`, and is fine for verification but never for
distribution. Installed packages set the bit correctly.

## Before tagging a release

```bash
npm run lint && npm run type-check && npm run smoke
```

CI runs the first two and then builds all three OSes; `smoke` is the one that
actually boots the game, and it is worth running locally because CI does not.
