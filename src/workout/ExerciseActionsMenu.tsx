import { useRef, useState } from 'react';
import { IconButton, LiquidPopover } from '../ui';
import { loadBrowserGlassSettings } from '../glassSettings';

export function ExerciseActionsMenu({ onDelete, onInformation, busy = false }: {
  onDelete?: () => void;
  onInformation?: () => void;
  busy?: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const glass = loadBrowserGlassSettings();
  const defer = (action: (() => void) | undefined) => {
    if (!action || busy) return;
    setPending(() => action);
    setOpen(false);
  };
  return <LiquidPopover isOpen={open} onOpenChange={setOpen} triggerRef={trigger}
    preset={glass.preset} optics={glass.optics} label="Меню упражнения"
    trigger={<IconButton ref={trigger} icon="dots-vertical" label="Меню упражнения"
      className="session-exercise__menu" data-no-dnd disabled={busy} />}
    items={[
      { id: 'delete', label: 'Удалить', icon: 'trash-outline', disabled: busy || !onDelete, onSelect: () => defer(onDelete) },
      { id: 'information', label: 'Информация', icon: 'info-circle', disabled: busy || !onInformation, onSelect: () => defer(onInformation) },
    ]}
    onPresentationChange={presented => {
      if (presented || !pending) return;
      const action = pending;
      setPending(null);
      action();
    }} />;
}
