# Build resources

`icon.png` is the game's own drone mark — `client/assets-src/favicon.png` from
[andriy-fs/drone-directive](https://github.com/andriy-fs/drone-directive),
resampled from 500×500 to the 1024×1024 electron-builder needs to derive the
Windows `.ico` and macOS `.icns`. It is flat vector-like shapes, so the upscale
is clean.

Alpha is kept. The game also ships an _opaque_ variant (`apple-touch-icon.png`,
on `#0d1117`) but that exists for iOS, which composites a transparent icon onto
black and would eat this mark's dark outline. Windows, macOS and Linux all
render alpha, and a transparent icon reads better against an arbitrary dock or
taskbar.

Replacing this one file is the whole job if the art ever changes.
