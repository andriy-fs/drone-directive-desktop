# Drone Directive — desktop

An **Electron** shell that ships [Drone Directive](https://github.com/andriy-fs/drone-directive)
— a React 19 + PixiJS 8 browser RTS — as an offline desktop app for Windows,
macOS and Linux.

This repository is the **wrapper only**. No game code is written, forked, patched
or vendored here: the game arrives prebuilt inside a version-pinned npm
dependency and is copied into the bundle verbatim. Anything that would require
editing the game belongs in `andriy-fs/drone-directive`, not here.

## Layout

```
src/main/     index.ts (app lifecycle, window, navigation guard)
              protocol.ts (the origin the game is served from + CSP)
              window-state.ts (remembered geometry)
              menu.ts (native App/View/Help menu)
              game.ts (where the game tree lives, packaged and not)
scripts/      copy-game.ts (stage the dependency into resources/game)
              smoke.ts (boot it and assert it renders)
```

There is **no preload and no `contextBridge`** — the game needs nothing from
Node, so no bridge exists for it. The About box that might have justified one is
a native `dialog` in the main process. Do not add a preload without a concrete
API the renderer actually calls.

## Commands

- `npm start` — `tsc` → copy the game → `electron .`
- `npm run smoke` — boot the real protocol handler and assert the game renders
- `npm run build` / `npm run type-check` / `npm run lint` / `npm run format`
- `npm run dist` — installers for the current platform, into `release/`
  (single targets and cross-building: `.docs/building.md`)
- `npm run release -- patch|minor|major|x.y.z` — check, bump, tag, push. The only
  supported way to cut a release; `--dry-run` stops before writing anything.
  Never tag by hand — it desynchronises `package.json` from the tag and the
  installers ship with the previous version in their names.

**Before considering any change done, run `npm run lint`, `npm run type-check`
and `npm run smoke` (all clean).** The smoke test is the one that matters: every
interesting failure in a shell like this is an integration failure that produces
a window which looks fine and renders nothing.

`npm ci` needs `NODE_AUTH_TOKEN` — a classic PAT with `read:packages`. The game
package lives in GitHub Packages, which has no anonymous read. See README
§ "The game dependency".

## Three facts that are not obvious and will be rediscovered painfully

1. **The origin is `https://game.drone-directive.invalid`, not `app://`.**
   PixiJS resolves asset paths with `isUrl(url) { return /^https?:/.test(url) }`.
   Under any custom scheme it joins the game's absolute paths onto the bare
   protocol, so `/fpv-munition.webp` becomes `app://fpv-munition.webp/` — the
   filename parsed as the hostname — and every sprite and sound is lost. Full
   reasoning at the top of `src/main/protocol.ts`.
2. **The CSP's `'unsafe-eval'` and `blob:` are forced by PixiJS**, which
   generates batch shaders with `new Function` and builds texture-decode workers
   from blobs. Removing either needs a change to the _game_ (the
   `pixi.js/unsafe-eval` package), not to this shell.
3. **`'!node_modules/**'` in `electron-builder.yml` is load-bearing.**
   electron-builder bundles production `dependencies` regardless of `files`, and
   the only production dependency here _is_ the game — without the exclusion
   every installer carries it twice and reads only the second copy.

## Conventions

- **English only.** Commit messages, code comments, documentation, README and
  every file in this repository are written in English, whatever language the
  conversation is in.
- **Commit messages are a single line.** No body, no bullet list, no trailers —
  in particular **no `Co-Authored-By`** and no `Generated with` lines. Explain a
  decision in a code comment or in the README, where the reader will actually
  meet it; a commit message says what changed, once.
  See `.claude/skills/dd-desktop-conventions/SKILL.md`.
- The game dependency is **pinned exactly** — no ranges, no `latest`. Upgrade it
  with `npm run game:update` (which passes `--save-exact`; plain
  `npm i pkg@latest` would rewrite the pin to `^`). Bumping the _desktop_ version
  does not pick up a newer game — they are separate numbers, and `npm run release`
  fails if the pin is behind the registry.
- `resources/`, `out/` and `release/` are generated. Never edit anything in
  `resources/game/`: it is somebody else's build output, and patching it makes
  "pinned version" meaningless.
- TypeScript is strict, ESM throughout, `verbatimModuleSyntax` (use
  `import type`), `noUnusedLocals`/`noUnusedParameters`.
- Prettier settings match the game repo: single quotes, semicolons, 120 columns.

## Skills

- **project-context** — `.claude/skills/project-context/SKILL.md` — the decisions
  that look like mistakes until you know why, the local-toolchain traps that
  report the wrong cause, and the half of the publish chain that lives in the
  game repository. Load it before touching the protocol handler, the CSP, icons,
  packaging or the release workflow — and before diagnosing anything that builds
  cleanly but does not run.
- **dd-desktop-conventions** — `.claude/skills/dd-desktop-conventions/SKILL.md` —
  English-only prose and single-line commit messages.

## Out of scope

Auto-update, code signing and notarisation, store packaging, gamepad support,
and any change whatsoever to the game's own source. Each is a follow-up issue.

Auto-update means _installing_: the update **check** in `src/main/update-check.ts`
is in scope and shipped — it asks the relay for the newest version and, at most,
opens the releases page. See README § "What this app sends" for what it discloses,
and why that section exists.
