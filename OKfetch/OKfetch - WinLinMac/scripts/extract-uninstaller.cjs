// Preloaded into electron-builder by `npm run dist:win` (node -r).
// To get the uninstaller, electron-builder normally runs a freshly built, unsigned helper .exe. Windows Smart App
// Control blocks that ("spawn UNKNOWN", Code Integrity event 3033), so the build fails. electron-builder can instead
// read the uninstaller out of that helper without running it (its macOS Catalina path, UninstallerReader); this
// switches that path on. Nothing else in electron-builder uses this check.
const macosVersion = require('app-builder-lib/out/util/macosVersion')

macosVersion.isMacOsCatalina = () => true
