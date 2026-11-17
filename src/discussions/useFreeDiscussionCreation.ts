import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DISCUSSION_TITLE_MAX_LENGTH, matchesDiscussionThreadAnchor } from '../../shared/discussion-anchor';
import type { NavigationContext, NavigationFloatingAction } from '../NavigationShell';
import type { CloudContact, useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import type { DiscussionThread } from '../data/cloud/discussion-contracts';
import type { AssignableDiscussionCategory, DiscussionOrganizationRepository } from '../data/cloud/discussion-organization';
import { DiscussionRepository, prepareFreeDiscussion, type CreateFreeDiscussion } from '../data/cloud/discussions';

type Peer = Pick<CloudContact, 'relationshipId' | 'userId'>;
type Session = { scope: object; category: AssignableDiscussionCategory; parent: NavigationContext | null };
type Creation =
  | { step: 'contact'; session: Session }
  | { step: 'title'; session: Session; peer: Peer; input?: CreateFreeDiscussion; saved?: DiscussionThread; pending: boolean; error: string };

export function findDiscussionPeer(contacts: readonly CloudContact[], peer: Peer): CloudContact | undefined {
  return contacts.find(contact => contact.relationshipId === peer.relationshipId && contact.userId === peer.userId);
}

export const chooseDiscussionContactTitle = (role: 'coach' | 'client') => role === 'coach' ? 'Выбрать клиента' : 'Выбрать тренера';
export const createFreeDiscussionTitle = 'Создать чат';

const noContacts: readonly CloudContact[] = [];
const contactUnavailable = 'Этот собеседник больше недоступен.';
const invalidTitle = `Введите название до ${DISCUSSION_TITLE_MAX_LENGTH} символов без управляющих знаков.`;

function creationError(reason: unknown, saved: boolean): string {
  const prefix = saved ? 'Чат создан. Не удалось назначить категорию. ' : '';
  switch (reason instanceof Error ? reason.message : '') {
    case 'DISCUSSION_ACCESS_DENIED': return prefix + contactUnavailable;
    case 'DISCUSSION_CATEGORY_NOT_FOUND': return prefix + 'Выбранная категория больше недоступна.';
    default: return saved ? prefix + 'Повторите назначение.' : 'Не удалось создать чат. Повторите попытку.';
  }
}

export function useFreeDiscussionCreation({ cloud, organization, category, scope, role, relationshipId, blocked, parent,
  onNavigationContextChange, onStart, onCreated }: {
  cloud: ReturnType<typeof useCloudConnections>;
  organization: DiscussionOrganizationRepository | null;
  category: AssignableDiscussionCategory | null;
  scope: object;
  role: 'coach' | 'client';
  relationshipId?: string;
  blocked: boolean;
  parent: NavigationContext | null;
  onNavigationContextChange: (value: NavigationContext | null) => void;
  onStart: () => void;
  onCreated: (thread: DiscussionThread, contact: CloudContact | undefined, parent: NavigationContext | null) => void;
}) {
  const peers = (role === 'coach' ? cloud?.clients : cloud?.coaches) ?? noContacts;
  const contacts = relationshipId ? peers.filter(contact => contact.relationshipId === relationshipId) : peers;
  const [creation, setCreation] = useState<Creation | null>(null);
  const current = creation?.session.scope === scope && !blocked ? creation : null;
  const running = useRef<Session | null>(null);
  const latest = useRef<{ scope: object; category: typeof category; parent: typeof parent; current: typeof current;
    blocked: boolean; contacts: typeof contacts; onStart: typeof onStart; onCreated: typeof onCreated } | null>(null);
  useLayoutEffect(() => {
    latest.current = { scope, category, parent, current, blocked, contacts, onStart, onCreated };
    return () => { latest.current = null; };
  });
  useLayoutEffect(() => {
    if (creation && !current) setCreation(previous => previous === creation ? null : previous);
  }, [creation, current]);

  const start = useCallback(() => {
    const surface = latest.current;
    if (surface?.scope !== scope || surface.blocked || surface.current || !surface.category) return;
    surface.onStart();
    setCreation({ step: 'contact', session: { scope, category: surface.category, parent: surface.parent } });
  }, [scope]);
  const action = useMemo<NavigationFloatingAction>(() => ({
    label: createFreeDiscussionTitle, icon: 'message-circle-plus', onClick: start,
  }), [start]);

  const select = (peer: CloudContact) => {
    const surface = latest.current;
    const selection = surface?.current;
    if (!surface || selection?.step !== 'contact' || !findDiscussionPeer(surface.contacts, peer)) return;
    setCreation(previous => previous === selection ? {
      step: 'title', session: selection.session, peer: { userId: peer.userId, relationshipId: peer.relationshipId },
      pending: false, error: '',
    } : previous);
  };
  const close = useCallback(() => {
    const session = latest.current?.current?.session;
    if (session && running.current !== session) setCreation(null);
  }, []);
  const session = current?.session;
  const step = current?.step;
  useLayoutEffect(() => {
    if (!session || !step) return;
    const context: NavigationContext = {
      ...session.parent, level: 2, title: step === 'contact' ? chooseDiscussionContactTitle(role) : createFreeDiscussionTitle,
      onBack: () => {
        const active = latest.current?.current;
        if (active?.session !== session || active.step !== step) return;
        if (running.current === session) {
          // Shell Back may consume the history entry before a local write finishes.
          onNavigationContextChange({ ...context });
        } else if (active.step === 'title' && !active.saved) {
          setCreation({ step: 'contact', session });
        } else close();
      },
    };
    onNavigationContextChange(context);
    return () => onNavigationContextChange(!relationshipId && session.parent?.level === 1 ? session.parent : null);
  }, [session, step, role, relationshipId, close, onNavigationContextChange]);

  const submit = async (draft: string) => {
    if (current?.step !== 'title' || latest.current?.current !== current || running.current === current.session) return;
    const { session, peer } = current;
    const update = (patch: Partial<Pick<typeof current, 'input' | 'saved' | 'error' | 'pending'>>) => {
      if (latest.current?.current?.session !== session) return;
      setCreation(previous => previous?.session === session && previous.step === 'title' ? { ...previous, ...patch } : previous);
    };
    const title = draft.trim();
    if (!current.saved && !title) { update({ error: 'Введите название чата.' }); return; }
    if (!current.saved && title.length > DISCUSSION_TITLE_MAX_LENGTH) { update({ error: invalidTitle }); return; }

    running.current = session;
    let saved = current.saved;
    let input = current.input;
    update({ pending: true, error: '' });
    try {
      if (!cloud || !organization) throw new Error('DISCUSSIONS_NOT_ENABLED');
      if (typeof session.category === 'object') {
        const { id } = session.category;
        if (!(await organization.listCategories()).some(category => category.id === id))
          throw new Error('DISCUSSION_CATEGORY_NOT_FOUND');
      }
      const surface = latest.current;
      if (surface?.current?.session !== session) return;
      const contact = findDiscussionPeer(surface.contacts, peer);
      if (!contact) throw new Error('DISCUSSION_ACCESS_DENIED');
      if (!saved) {
        if (!input || input.title !== title) input = prepareFreeDiscussion(title);
        if (!matchesDiscussionThreadAnchor({ kind: 'free', threadId: input.id }, input.id, input.title, [])) {
          update({ error: invalidTitle });
          return;
        }
        const realmId = contact.relationshipId;
        const repository = new DiscussionRepository(cloud.db, cloud.actorUserId, { realmId, coachClientId: realmId });
        saved = await repository.createFreeDiscussion(input);
      }
      // Complete an accepted write even if its UI was dismissed by a surface change.
      await organization.assignThread(saved, session.category);
      const active = latest.current;
      if (active?.current?.session !== session) return;
      setCreation(null);
      active.onCreated(saved, findDiscussionPeer(active.contacts, peer), session.parent);
    } catch (reason) {
      update({ input, saved, error: creationError(reason, Boolean(saved)) });
    } finally {
      if (running.current === session) running.current = null;
      update({ pending: false });
    }
  };

  return {
    current, contacts, close, select, submit,
    clearError: () => setCreation(previous => previous?.step === 'title' && previous.error && !previous.saved
      ? { ...previous, error: '' } : previous),
    action: category && !blocked && !current ? action : null,
  };
}
