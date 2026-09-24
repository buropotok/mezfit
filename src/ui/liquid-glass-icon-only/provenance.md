# Direct prototype extraction

Source: `tabbar-startup-motion-editor-v60-icons-at-open-start.html`, SHA-256 `60658ae22c2bece244ca5e67165653f5c229840fcbcd9489800d61934c003e46` (saved without the rejected rolling zoom).

`prototypeRuntime.js` keeps the original three interaction/optics/spring IIFEs and startup sampling functions as JavaScript. The TypeScript declaration describes the adapter boundary; it does not pretend to typecheck the borrowed implementation. No eval, script injection, global monkey-patching, or iframe is used.

Intentional boundary changes:
- local ShadowRoot IDs, local event hub instead of window events;
- tracked listeners, observers, RAFs, timeouts and Web Animations with deterministic disposal;
- controlled selection entry point / callback, reconciled after each request;
- null canvas-context fallback for environments without Canvas2D;
- no editor controls, debug maps, theme/mode switch, or extra rolling zoom;
- pointercancel restores selection without synthesizing a click;
- slots use the supplied item count; widths follow available screen width / 1.1;
- hidden unmounts the entire scene; each visible scene owns one runtime.

The CSS remains isolated as in the approved HTML. Outer reveal geometry and donor mechanics share one shadow tree; the donor startup selector is scoped to `#iconLayer[startup]`. React owns markup/icons, while the per-scene controller owns their private animation styles, filters and gesture lifecycle. Tests exercise this boundary and source-level geometry; device visual verification remains necessary.
