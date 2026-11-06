import { useEffect, useState } from 'react';
import {
  acceptCurrentInvite,
  getCurrentInvite,
  type ClientInvitePreview,
  type Role,
} from '../api';
import { Button, Text } from '../ui';

/** A Telegram invite must be handled before a stored Coach role can hide it. */
export function isClientInviteStartParam(value: string | null): value is string {
  return typeof value === 'string' && /^invite_[a-f0-9]{36}$/i.test(value);
}

interface ClientInviteEntryProps {
  initData: string;
  startParam: string;
  onAccepted: (roles: Role[]) => void;
  onDismiss: () => void;
}

export function ClientInviteEntry({
  initData, startParam, onAccepted, onDismiss,
}: ClientInviteEntryProps) {
  const [invite, setInvite] = useState<ClientInvitePreview | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setInvite(undefined);
    setError('');
    void getCurrentInvite(initData, startParam).then(({ invite: next }) => {
      if (active) setInvite(next);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Не удалось проверить приглашение');
    });
    return () => { active = false; };
  }, [initData, startParam, retryKey]);

  const accept = async () => {
    if (!invite || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await acceptCurrentInvite(initData, startParam);
      if (!Array.isArray(result.roles) || !result.roles.includes('client')) {
        throw new Error('Не удалось подтвердить режим клиента');
      }
      onAccepted(result.roles);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось принять приглашение');
    } finally {
      setBusy(false);
    }
  };

  const coachName = invite
    ? [invite.coach.firstName, invite.coach.lastName].filter(Boolean).join(' ')
    : '';

  return (
    <main className="center">
      <section className="card stack">
        <Text variant="footnote">Приглашение</Text>
        <Text variant="title" role="heading" aria-level={1}>
          {invite ? `${coachName} приглашает вас в Mezfit`
            : invite === null ? 'Приглашение недоступно' : 'Проверяем приглашение…'}
        </Text>
        {invite ? (
          <>
            <Text variant="body">
              {invite.label || 'После подтверждения тренер сможет назначать вам программу и видеть результаты тренировок.'}
            </Text>
            <Button disabled={busy} onClick={() => void accept()}>
              {busy ? 'Подключаем…' : 'Подключиться к тренеру'}
            </Button>
          </>
        ) : invite === null ? (
          <Text variant="body">Возможно, вы уже подключены, ссылка отозвана или срок её действия истёк.</Text>
        ) : null}
        {error ? <Text variant="body" role="alert">{error}</Text> : null}
        {invite === undefined && error
          ? <Button onClick={() => setRetryKey(value => value + 1)}>Повторить</Button> : null}
        {invite === null || (invite === undefined && error)
          ? <Button variant="secondary" onClick={onDismiss}>Открыть Mezfit</Button> : null}
      </section>
    </main>
  );
}
