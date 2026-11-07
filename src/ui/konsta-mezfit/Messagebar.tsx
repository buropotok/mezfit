// Konsta 5.4.0 Messagebar adapter: retain its renderer and slots, extend only
// textarea sizing/overflow. No feature code reads or styles Konsta's private DOM.
import { useCallback, useEffect, useLayoutEffect, useRef, type ComponentProps } from 'react';
import { Messagebar as KonstaMessagebar } from 'konsta/react';
import './messagebar.css';

export type MezfitMessagebarProps = Omit<ComponentProps<typeof KonstaMessagebar>, 'value'> & {
  value: string;
  maxRows?: number;
};

export function MezfitMessagebar({ value, maxRows = 5, ref, className = '', ...props }: MezfitMessagebarProps) {
  const root = useRef<HTMLElement | null>(null);
  const fit = useCallback(() => {
    const area = root.current?.querySelector('textarea');
    if (!area) return;
    const computed = getComputedStyle(area);
    const lineHeight = Number.parseFloat(computed.lineHeight) || 16;
    const padding = (Number.parseFloat(computed.paddingTop) || 0) + (Number.parseFloat(computed.paddingBottom) || 0);
    const minHeight = Math.max(40, lineHeight + padding);
    const maxHeight = lineHeight * Math.max(1, Math.min(5, maxRows)) + padding;
    // Reset before reading scrollHeight; shrinking text must shrink the bar.
    area.style.height = 'auto';
    const required = area.scrollHeight;
    area.style.height = `${Math.max(minHeight, Math.min(required, maxHeight))}px`;
    area.style.overflowY = required > maxHeight ? 'auto' : 'hidden';
  }, [maxRows]);

  useLayoutEffect(() => { fit(); }, [fit, value]);
  useEffect(() => {
    const viewport = window.visualViewport;
    window.addEventListener('resize', fit);
    viewport?.addEventListener('resize', fit);
    let previousWidth = root.current?.getBoundingClientRect().width ?? 0;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      const width = root.current?.getBoundingClientRect().width ?? 0;
      if (Math.abs(width - previousWidth) > 0.5) { previousWidth = width; fit(); }
    });
    if (root.current) observer?.observe(root.current);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', fit);
      viewport?.removeEventListener('resize', fit);
    };
  }, [fit]);

  return <KonstaMessagebar {...props} value={value} className={`ui-mezfit-messagebar ${className}`.trim()}
    ref={node => {
      root.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    }} />;
}
