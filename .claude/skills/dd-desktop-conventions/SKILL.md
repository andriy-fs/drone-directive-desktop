---
name: dd-desktop-conventions
description: >-
  Writing conventions for andriy-fs/drone-directive-desktop: the language every
  artefact is written in, and the shape of a commit message. Use before writing
  or amending any commit message, and before writing or editing README.md,
  CLAUDE.md, code comments, workflow comments or any other prose in this
  repository — including when the conversation itself is in another language.
---

# Writing conventions

Two rules. Both are absolute, and both are about artefacts that outlive the
conversation that produced them.

## 1. Everything written is in English

Commit messages, code comments, documentation, README, `CLAUDE.md`, workflow
comments, issue and PR bodies, error strings, log output — English, always.

This holds **regardless of the language being spoken to you.** A conversation in
Russian, Ukrainian or Polish still produces English commits and English
comments. Reply to the user in their language; write the repository in English.

The reason is reach, not preference: the game is GPL-3.0-or-later and its source
is public, so the people who read this repository are not the people who wrote
it. A comment explaining why PixiJS forces `'unsafe-eval'` is worthless to a
contributor who cannot read it.

## 2. A commit message is one line

```
feat: wrap the published game build as an offline Electron app
```

That is the whole message. Specifically:

- **One line.** No body, no blank line, no bullets, no paragraphs.
- **No trailers.** No `Co-Authored-By:`. No `Generated with`. No `Signed-off-by`
  unless the project ever adopts a DCO. Nothing after the subject line at all.
- **Conventional-commit prefix**, matching the game repository: `feat:`,
  `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `build:`, `ci:`. A scope is
  allowed where it sharpens the subject — `fix(protocol):`, `feat(menu):`.
- **Imperative mood, lower case after the prefix, no trailing full stop.**
- Aim for ≤ 72 characters. If the subject will not fit, the commit is probably
  doing two things.

### Where the explanation goes instead

Nowhere in the commit. A decision worth explaining is explained where the next
reader will actually meet it:

- Why a line of code is the way it is → a comment on that code.
- Why the architecture is the way it is → `README.md` or `CLAUDE.md`.
- Why a dependency moved → the PR description.

`git log` is an index, not an archive. This repository already carries its
reasoning in `src/main/protocol.ts`, `electron-builder.yml` and the README; a
commit body would only duplicate it, and would rot separately.

### Amending

When asked to fix an existing message, rewrite it to this shape rather than
trimming it. If the commit has already been pushed, say that the branch will
need a force-push and let the user decide.
