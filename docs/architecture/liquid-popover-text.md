# LiquidPopover plain text

`LiquidPopover` accepts an optional `text: string`. When provided, it takes
precedence over menu items and selects the text layout. Callers do not need to
provide `items`, and the default role becomes `dialog` (menu/grid keep their
existing default). `label` supplies the accessible window name.

```tsx
<LiquidPopover
  isOpen={open}
  onOpenChange={setOpen}
  triggerRef={buttonRef}
  trigger={<IconButton ref={buttonRef} icon="info-circle" label="Информация" />}
  text="Текст подсказки"
  label="Информация"
/>
```

Text uses the complete Body typography preset, preserves explicit newlines,
wraps long words, and is rendered as plain React text, never HTML. Width is
bounded by the mobile viewport. Long content scrolls through the existing
native content container. Material, source-button morph, reverse close,
content freezing, reduced-motion fallback, and iOS render selection remain
owned by the existing primitive.

The raster phase uses DOM Range positions of the same text content as the
native HTML handoff. Grapheme segmentation preserves combining marks/emoji
where supported. If geometry/canvas is unavailable, the primitive uses its
existing safe native-content fallback. Menu/grid callers are unchanged.
