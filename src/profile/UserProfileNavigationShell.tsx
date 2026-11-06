import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { UserProfileRepository, type UserProfile } from '../data/cloud/user-profile';
import { ClientWorkoutNavigationShell } from '../workout/ClientWorkoutContext';
import { Button, Text } from '../ui';
import { ProfileWorkspace, type ProfileTab } from './ProfileWorkspace';
import { UserProfileSyncStatus } from './UserProfilePublicationProvider';
import { UserAvatarEditor } from './UserAvatarEditor';
import { UserProfileForm } from './UserProfileForm';

/** First entry and later edits use the same optional profile surface. */
type UserProfileNavigationShellProps = ComponentProps<typeof ClientWorkoutNavigationShell> & {
  /** A Telegram invitation takes precedence over optional first-visit profile onboarding. */
  suppressInitialProfileOpen?: boolean;
};

export function UserProfileNavigationShell({
  suppressInitialProfileOpen = false, ...props
}: UserProfileNavigationShellProps) {
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
  const initialProfileVisit = useRef<string | null>(null);
  const destinationChange = useRef(props.onDestinationChange);
  useLayoutEffect(() => { destinationChange.current = props.onDestinationChange; });
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
  useEffect(() => {
    if (suppressInitialProfileOpen || props.activeRole !== 'client' || !repository || !current
      || initialProfileVisit.current === repository.actorUserId) return;
    initialProfileVisit.current = repository.actorUserId;
    // Offer the empty profile once; subsequent reads and retries never trap navigation.
    if (!current.profile && props.destination === 'today') {
      setTab('basics');
      destinationChange.current('profile');
    }
  }, [props.activeRole, props.destination, repository, current, suppressInitialProfileOpen]);
  const showingProfile = props.destination === 'profile';
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
    <UserAvatarEditor fallbackSrc={props.me.user.photoUrl} />
    <UserProfileForm key={repository.actorUserId} syncStatus={<UserProfileSyncStatus />}
      defaults={{ firstName: props.me.user.firstName, lastName: props.me.user.lastName ?? '' }}
      initialProfile={profile} telegramUserId={props.me.user.telegramUserId}
      telegramUsername={props.me.user.username}
      onSave={async draft => {
        const saved = await repository.saveOwn(draft);
        if (activeRepository.current !== repository) return;
        // A stale account's completion cannot navigate or publish into the next account.
        setSnapshot(previous => previous?.repository === repository
          ? { repository, profile: saved, error: false, loaded: true } : previous);
      }} />
  </>;
  return <ClientWorkoutNavigationShell {...props}>
    {showingProfile ? <ProfileWorkspace view={{ kind: 'self', name }} tab={tab}
      onTabChange={setTab} basicsContent={basics} /> : props.children}
  </ClientWorkoutNavigationShell>;
}
