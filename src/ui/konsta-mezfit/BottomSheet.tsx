import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Sheet as KonstaSheet } from 'konsta/react';
import './bottom-sheet.css';

export type MezfitBottomSheetProps = Omit<
  ComponentProps<typeof KonstaSheet>,
  'opened' | 'backdrop' | 'onBackdropClick' | 'children' | 'className'
> & {
  opened: boolean;
  label: string;
  className?: string;
  contentClassName?: string;
  children?: ReactNode;
  /** Mount content on demand and release it after the closing transition. */
  lazyMount?: boolean;
  /** Called once after an opened sheet finishes closing. */
  onClosed?: () => void;
};

function closingDuration(element: Element | null): number {
  if (!element) return 0;
  const style = getComputedStyle(element);
  if (style.transitionProperty === 'none') return 0;
  const milliseconds = (value: string) => {
    const amount = Number.parseFloat(value) || 0;
    return value.trim().endsWith('ms') ? amount : amount * 1000;
  };
  const durations = style.transitionDuration.split(',').map(milliseconds);
  const delays = style.transitionDelay.split(',').map(milliseconds);
  return Math.max(0, ...durations.map((duration, index) => duration + delays[index % delays.length]));
}

/**
 * Mezfit bottom sheet built on the public Konsta Sheet primitive.
 * Konsta owns the slide mechanics; Mezfit owns navigation-relative height,
 * the black surface, internal scrolling and the lifted schedule halo.
 */
export function MezfitBottomSheet({
  opened,
  label,
  className = '',
  contentClassName = '',
  children,
  lazyMount = false,
  onClosed,
  onTransitionEnd,
  ...props
}: MezfitBottomSheetProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentMounted, setContentMounted] = useState(opened);
  const wasOpened = useRef(false);
  const onClosedRef = useRef(onClosed);

  useEffect(() => { onClosedRef.current = onClosed; }, [onClosed]);

  const finishClose = useCallback(() => {
    if (opened || !wasOpened.current) return;
    wasOpened.current = false;
    setContentMounted(false);
    onClosedRef.current?.();
  }, [opened]);

  useEffect(() => {
    if (opened) {
      wasOpened.current = true;
      setContentMounted(true);
      return;
    }
    if (!wasOpened.current) return;
    // In pinned Konsta 5.4 the adapter content is a direct child of the animated Sheet root.
    // Computed timing also handles disabled transitions and missing transitionend events.
    const timer = window.setTimeout(finishClose, closingDuration(contentRef.current?.parentElement ?? null));
    return () => window.clearTimeout(timer);
  }, [opened, finishClose]);

  return (
    <KonstaSheet
      {...props}
      opened={opened}
      onTransitionEnd={(event) => {
        onTransitionEnd?.(event);
        if (event.target === event.currentTarget) finishClose();
      }}
      backdrop={false}
      className={`ui-mezfit-bottom-sheet ${className}`.trim()}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      aria-hidden={opened ? undefined : true}
      inert={opened ? undefined : true}
    >
      <div ref={contentRef} className={`ui-mezfit-bottom-sheet__content ${contentClassName}`.trim()}>
        {!lazyMount || opened || contentMounted ? children : null}
      </div>
    </KonstaSheet>
  );
}

MezfitBottomSheet.displayName = 'MezfitBottomSheet';
