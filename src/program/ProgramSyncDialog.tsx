import type { NavigationContext } from '../NavigationShell';
import { useEffect, useRef, useState } from 'react';
import { Preloader } from 'konsta/react';
import { MezfitDialog, MezfitDialogButton, Text } from '../ui';

/** Cancel dismisses presentation; the Addon continues its owned synchronization. */
export function ProgramSyncDialog({ opened, onClose, onSync, onNavigationContextChange }: {
  opened: boolean;
  onNavigationContextChange?: (context: NavigationContext | null) => void;
  onClose: () => void;
  onSync: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false), active = useRef(true), visible = useRef(opened);
  const close = useRef(onClose);
  close.current = onClose;
  visible.current = opened;
  useEffect(() => {
    if (!opened || !onNavigationContextChange) return;
    onNavigationContextChange({ title: 'Синхронизация', scrollKey: 'program-sync', onBack: () => close.current() });
    return () => onNavigationContextChange(null);
  }, [opened, onNavigationContextChange]);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const synchronize = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      await onSync();
      if (active.current && visible.current) onClose();
    } catch {
      if (active.current) setError('Не удалось синхронизироваться с Mezfit облаком. Изменения сохранены на устройстве.');
    } finally {
      running.current = false;
      if (active.current) setBusy(false);
    }
  };
  if (!opened) return null;
  return <MezfitDialog opened={opened} aria-label="Синхронизация с облаком"
    onBackdropClick={onClose} buttons={<>
      <MezfitDialogButton onClick={onClose}>Отмена</MezfitDialogButton>
      {!busy ? <MezfitDialogButton strong onClick={() => { void synchronize(); }}>
        Да
      </MezfitDialogButton> : null}
    </>}>
    {busy ? <div className="program-sync-preloader"><Preloader colors={{ iconIos: 'text-white', iconMaterial: 'text-white' }} aria-label="Синхронизация…" /></div>
      : <><Text variant="body">Синхронизироваться с облаком?</Text>
        {error ? <Text variant="footnote" role="alert">{error}</Text> : null}</>}
  </MezfitDialog>;
}
