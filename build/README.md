# Build resources

Two things, for two different consumers.

## `icon.png` — Windows and macOS

The game's own drone mark: `client/assets-src/favicon.png` from
[andriy-fs/drone-directive](https://github.com/andriy-fs/drone-directive),
resampled from 500x500 to the 1024x1024 electron-builder needs to derive the
Windows `.ico` and macOS `.icns`. Flat vector-like shapes, so the upscale is
clean.

Alpha is kept. The game also ships an _opaque_ variant (`apple-touch-icon.png`,
on `#0d1117`), but that exists for iOS, which composites a transparent icon onto
black and would eat this mark's dark outline. Windows, macOS and Linux all render
alpha, and a transparent icon reads better against an arbitrary dock or taskbar.

## `icons/` — Linux

The same mark at eight sizes, named `NxN.png`, referenced by `linux.icon` in
`electron-builder.yml`.

A directory rather than the single `icon.png`, because Linux does not scale it
for you. Given one PNG, electron-builder installs it into the one
`/usr/share/icons/hicolor/<size>/apps/` directory matching its actual pixel size
— and the freedesktop hicolor theme **declares no `1024x1024`**; its largest is
`512x512`. A 1024x1024 icon therefore lands on disk in a directory no icon theme
ever looks in, and the app appears in the launcher with no icon at all. This is
not hypothetical: `v0.1.0` shipped that way.

Anything outside the theme's declared set has the same problem, so keep the sizes
to conventional ones.

## Regenerating both

After replacing the source mark, from a checkout of the game repository next to
this one:

```bash
node -e "
const sharp = require('../drone-directive/node_modules/sharp');
sharp('../drone-directive/client/assets-src/favicon.png')
  .resize(1024, 1024, { kernel: 'lanczos3' }).png({ compressionLevel: 9 })
  .toFile('build/icon.png');
"
node -e "
const sharp = require('../drone-directive/node_modules/sharp');
for (const s of [16, 24, 32, 48, 64, 128, 256, 512])
  sharp('build/icon.png').resize(s, s, { kernel: 'lanczos3' })
    .png({ compressionLevel: 9 }).toFile(\`build/icons/\${s}x\${s}.png\`);
"
```

Verify the result before releasing — `electron-builder --linux deb` prints the
`fpm` command line it is about to run, and every icon mapping in it must point at
a size the hicolor theme declares:

```
grep -o 'build/icons/[^ ]*=/usr/share/icons/[^ ]*'
```
