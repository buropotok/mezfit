import type { ComponentProps, ReactNode } from 'react';
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
};

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
  ...props
}: MezfitBottomSheetProps) {
  return (
    <KonstaSheet
      {...props}
      opened={opened}
      backdrop={false}
      className={`ui-mezfit-bottom-sheet ${className}`.trim()}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      aria-hidden={opened ? undefined : true}
      inert={opened ? undefined : true}
    >
      <div className={`ui-mezfit-bottom-sheet__content ${contentClassName}`.trim()}>
        {children}
      </div>
    </KonstaSheet>
  );
}

MezfitBottomSheet.displayName = 'MezfitBottomSheet';
