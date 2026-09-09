# Issue #52 implementation

Implementation branch: `feat/52-apk-navigation-icons`.

The navigation shell now uses Gym Keeper APK-derived artwork instead of temporary Unicode glyphs and keeps the drawer mounted through its animated exit. The implementation preserves existing destination, role-switch, focus-trap, Escape, backdrop and scroll-lock behavior.