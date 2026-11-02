import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { UserProfileRepository, type UserProfile } from '../data/cloud/user-profile';
import { ClientWorkoutNavigationShell } from '../workout/ClientWorkoutContext';
import { Button, Text } from '../ui';
import { ProfileWorkspace, type ProfileTab } from './ProfileWorkspace';
import { UserProfileForm } from './UserProfileForm';

/** Registration uses the same profile surface and navigation owner as later edits. */
export function UserProfileNavigationShell(props: ComponentProps<typeof ClientWorkoutNavigationShell>) {
  const cloud = useCloudConnections();
  const enabled = props.activeRole === 'client' || props.destination === 'profile';
  const repository = useMemo(() => enabled && cloud?.db && cloud.actorUserId === `tg:${props.me.user.telegramUserId}`
    ? new UserProfileRepository(cloud.db, cloud.actorUserId) : null,
  [enabled, cloud?.db, cloud?.actorUserId, props.me.user.telegramUserId]);
  const [snapshot, setSnapshot] = useState<{
    repository: UserProfileRepository; profile: UserProfile | null; error: boolean; loaded: boolean;
  } | null>(null);
  const activeRepository = useRef(repository);
  useLayoutEffect(() => {
    activeRepository.current = repository;
    return () => { activeRepository.current = null; };
  }, [repository]);
  const [retry, setRetry] = useState(0);
  const [tab, setTab] = useState<ProfileTab>('basics');
  useEffect(() => {
    if (!repository) return;
    let active = true;
    let subscription: { unsubscribe: () => void } | undefined;

    void repository.migrateOwn().then(() => {
      if (!active) return;
      subscription = repository.observeOwn(profile => {
        if (active) setSnapshot({ repository, profile, error: false, loaded: true });
      }, () => {
        if (active) setSnapshot(previous => previous?.repository === repository
          ? { ...previous, error: true } : { repository, profile: null, error: true, loaded: false });
      });
    }).catch(() => {
      if (active) setSnapshot(previous => previous?.repository === repository
          ? { ...previous, error: true } : { repository, profile: null, error: true, loaded: false });
    });
    return () => { active = false; subscription?.unsubscribe(); };
  }, [repository, retry]);
  useEffect(() => { setTab('basics'); }, [props.activeRole, cloud?.actorUserId]);
  const current = snapshot?.repository === repository ? snapshot : null;
  const required = props.activeRole === 'client' && (!current || !current.profile);
  const showingProfile = required || props.destination === 'profile';
  const profile = current?.profile ?? null;
  const name = [props.me.user.firstName, props.me.user.lastName].filter(Boolean).join(' ');
  const basics = !current || !repository ? <section className="user-profile__status">
    <Text variant="body">Загрузка анкеты…</Text>
  </section> : current.error && !current.loaded ? <section className="user-profile__status">
    <Text variant="body" role="alert">Не удалось загрузить анкету. Попробуйте ещё раз.</Text>
    <Button onClick={() => setRetry(value => value + 1)}>Повторить</Button>
  </section> : <>
    {current.error ? <section className="user-profile__status">
      <Text variant="footnote" role="alert">Не удалось обновить анкету. Введённые данные сохранены в форме.</Text>
      <Button onClick={() => setRetry(value => value + 1)}>Повторить</Button>
    </section> : null}
    {required ? <Text variant="body">Заполните анкету, чтобы продолжить.</Text> : null}
    <UserProfileForm key={repository.actorUserId}
      defaults={{ firstName: props.me.user.firstName, lastName: props.me.user.lastName ?? '' }}
      initialProfile={profile} telegramUserId={props.me.user.telegramUserId}
      telegramUsername={props.me.user.username}
      onSave={async draft => {
        const saved = await repository.saveOwn(draft);
        if (activeRepository.current !== repository) return;
        // A stale account's completion cannot navigate or publish into the next account.
        setSnapshot(previous => previous?.repository === repository
          ? { repository, profile: saved, error: false, loaded: true } : previous);
        if (required) props.onDestinationChange('profile');
      }} />
  </>;
  return <ClientWorkoutNavigationShell {...props}
    destination={required ? 'profile' : props.destination}
    context={required ? { level: 1, title: 'Мой профиль', scrollKey: 'profile:registration' } : props.context}
    registrationRequired={required}
    onDestinationChange={next => { if (!required) props.onDestinationChange(next); }}>
    {showingProfile ? <ProfileWorkspace view={{ kind: 'self', name }} tab={required ? 'basics' : tab}
      onTabChange={next => { if (!required) setTab(next); }} basicsContent={basics} /> : props.children}
  </ClientWorkoutNavigationShell>;
}
