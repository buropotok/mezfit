import { useCallback, useEffect, useLayoutEffect, useRef, type ComponentProps } from 'react';
import { ListInput as KonstaListInput } from 'konsta/react';

/**
 * Konsta 5.4.0 ListInput has a fixed 40px iOS textarea height and no auto-grow
 * option. Keep Konsta's outlined/floating labels and native input events; only
 * extend the textarea height through its public inputStyle/onInput API.
 * All DOM measurement stays inside the version-pinned Mezfit adapter boundary.
 */
export type MezfitAutosizeTextareaProps = Omit<ComponentProps<typeof KonstaListInput>, 'type' | 'input'> & {
  value: string;
  minHeight?: number;
};

export function MezfitAutosizeTextarea({
  value, minHeight = 80, inputStyle, onInput, ...props
}: MezfitAutosizeTextareaProps) {
  const host = useRef<HTMLLIElement | null>(null);

  const fitContent = useCallback(() => {
    const textarea = host.current?.querySelector('textarea');
    if (!textarea) return;
    // Reset before measuring so the control shrinks when text is deleted.
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(minHeight, textarea.scrollHeight)}px`;
  }, [minHeight]);

  // Existing event descriptions and programmatically changed values must also fit.
  useLayoutEffect(() => { fitContent(); }, [fitContent, value]);

  // Width/font layout may change when the device rotates or the keyboard opens.
  useEffect(() => {
    window.addEventListener('resize', fitContent);
    return () => window.removeEventListener('resize', fitContent);
  }, [fitContent]);

  return <KonstaListInput {...props} ref={host} type="textarea" value={value}
    inputStyle={{ ...inputStyle, minHeight, height: minHeight, overflowY: 'hidden', resize: 'none' }}
    onInput={event => {
      fitContent();
      onInput?.(event);
    }} />;
}
