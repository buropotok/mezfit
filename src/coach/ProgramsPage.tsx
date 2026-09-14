import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { getCoachPrograms, type CoachClientListItem, type ProgramListItem, type ProgramOwnerGroup, type ProgramStatus } from '../api';
import { Avatar, Badge, FloatingActionButton, IconButton, List, ListItem, Menu, MenuItem, Modal, SearchInput, Tabs, TabsList, TabsTrigger, Text, TextInput } from '../ui';
import programIconUrl from '../ui/icons/Untitled_20260914_023702.svg';
import chevronRightUrl from '../ui/icons/chevron-right.svg';
import copyUrl from '../ui/icons/copy.svg';
import dotsUrl from '../ui/icons/dots-vertical.svg';
import pencilUrl from '../ui/icons/pencil.svg';
import trashUrl from '../ui/icons/trash.svg';
import './programs.css';

type Filter = ProgramStatus;
export type ProgramCreationOwner = { type: 'self' } | { type: 'client'; client: CoachClientListItem } | null;
export interface ProgramCreationDraft { name: string; owner: ProgramCreationOwner }

function MaskIcon({ src, className = '' }: { src: string; className?: string }) {
  const style = { '--programs-icon-url': `url("${src}")` } as CSSProperties;
  return <span className={`programs-mask-icon ${className}`.trim()} style={style} aria-hidden="true" />;
}

function AddIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" fill="currentColor" /></svg>;
}

function ProgramMenu({ program }: { program: ProgramListItem }) {
  const [open, setOpen] = useState(false);
  return (
    <Menu isOpen={open} onOpenChange={setOpen} align="end" label={`Действия с программой ${program.name}`} trigger={(
      <IconButton className="programs-more" label={`Открыть меню программы ${program.name}`} data-no-dnd><MaskIcon src={dotsUrl} /></IconButton>
    )}>
      <MenuItem leading={<MaskIcon src={pencilUrl} />} disabled>Редактировать</MenuItem>
      <MenuItem leading={<MaskIcon src={copyUrl} />} disabled>Дублировать</MenuItem>
      <MenuItem leading={<MaskIcon src={trashUrl} />} disabled>Удалить</MenuItem>
      <MenuItem disabled>Статистика</MenuItem>
    </Menu>
  );
}

function statusBadge(status: ProgramStatus) {
  if (status === 'active') return <Badge color="green">Активный</Badge>;
  if (status === 'finished') return <Badge color="blue">Завершен</Badge>;
  return <Badge color="yellow">Черновик</Badge>;
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

function programDates(program: ProgramListItem): string | undefined {
  if (program.status === 'draft') return undefined;
  const start = formatDate(program.startedAt);
  if (!start) return undefined;
  if (program.status === 'active') return `${start} — ...`;
  const finish = formatDate(program.finishedAt);
  return finish ? `${start} — ${finish}` : start;
}

function ProgramRows({ programs }: { programs: ProgramListItem[] }) {
  if (programs.length === 0) return null;
  return <div className="programs-card">{programs.map((program) => {
    const dates = programDates(program);
    return <div className="programs-row" key={program.id}>
      <div className="programs-icon" aria-hidden="true"><img src={programIconUrl} alt="" /></div>
      <div className="programs-copy"><Text className="programs-name">{program.name}</Text>{dates ? <Text variant="caption" tone="muted">{dates}</Text> : null}</div>
      <div className="programs-status">{statusBadge(program.status)}</div><ProgramMenu program={program} />
    </div>;
  })}</div>;
}

function ownerName(group: ProgramOwnerGroup): string { return [group.owner.firstName, group.owner.lastName].filter(Boolean).join(' '); }
function clientName(client: CoachClientListItem): string { return [client.user.firstName, client.user.lastName].filter(Boolean).join(' '); }

interface ProgramsPageProps {
  initData: string;
  onSelectClient?: (userId: number) => Promise<void>;
  creationDraft: ProgramCreationDraft | null;
  creationBusy: boolean;
  creationError: string;
  refreshKey: number;
  onOpenCreation: () => void;
  onCancelCreation: () => void;
  onDraftChange: (draft: ProgramCreationDraft) => void;
  onRequestClientSelection: () => void;
  onSaveCreation: () => void;
}

export function ProgramsPage({ initData, onSelectClient, creationDraft, creationBusy, creationError, refreshKey, onOpenCreation, onCancelCreation, onDraftChange, onRequestClientSelection, onSaveCreation }: ProgramsPageProps) {
  const [programs, setPrograms] = useState<ProgramListItem[] | null>(null);
  const [clientGroups, setClientGroups] = useState<ProgramOwnerGroup[]>([]);
  const [filter, setFilter] = useState<Filter>('active');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    setMessage('');
    getCoachPrograms(initData).then((result) => { if (!cancelled) { setPrograms(result.programs); setClientGroups(result.clients); } }).catch((error: unknown) => {
      if (!cancelled) { setPrograms([]); setClientGroups([]); setMessage(error instanceof Error ? error.message : 'Не удалось загрузить программы'); }
    });
    return () => { cancelled = true; };
  }, [initData, refreshKey]);

  const ownPrograms = useMemo(() => (programs ?? []).filter((program) => program.status === filter), [programs, filter]);
  const visibleClients = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('ru-RU');
    return clientGroups.filter((group) => !needle || ownerName(group).toLocaleLowerCase('ru-RU').includes(needle)).map((group) => ({ ...group, programs: group.programs.filter((program) => program.status === filter) })).filter((group) => group.programs.length > 0);
  }, [clientGroups, filter, search]);

  const selectClient = async (userId: number) => {
    if (!onSelectClient) return;
    setMessage('');
    try { await onSelectClient(userId); } catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось открыть карточку клиента'); }
  };

  const canSave = Boolean(creationDraft?.name.trim() && creationDraft.owner && !creationBusy);
  const selectedClient = creationDraft?.owner?.type === 'client' ? creationDraft.owner.client : null;

  return <section className="programs-page" aria-label="Программы">
    <SearchInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск клиента" aria-label="Поиск клиента" />
    <Tabs className="programs-tabs" value={filter} onValueChange={(value) => setFilter(value as Filter)}><TabsList aria-label="Статус программы"><TabsTrigger value="active">Активные</TabsTrigger><TabsTrigger value="finished">Завершённые</TabsTrigger><TabsTrigger value="draft">Черновики</TabsTrigger></TabsList></Tabs>
    {programs === null ? <Text tone="muted">Загружаем программы…</Text> : <>
      <section className="programs-section" aria-labelledby="own-programs-title"><Text id="own-programs-title" variant="caption" tone="muted" className="programs-section-label">Мои программы</Text><ProgramRows programs={ownPrograms} />{ownPrograms.length === 0 ? <Text variant="footnote" tone="muted">Нет программ с выбранным статусом</Text> : null}</section>
      <section className="programs-section" aria-labelledby="client-programs-title"><Text id="client-programs-title" variant="caption" tone="muted" className="programs-section-label">Программы клиентов</Text>{visibleClients.map((group) => <div className="programs-client" key={group.owner.id}><List className="programs-client-list"><ListItem onClick={() => { void selectClient(group.owner.id); }} leading={<Avatar name={ownerName(group)} src={group.owner.photoUrl ?? undefined} />} title={ownerName(group)} trailing={<MaskIcon src={chevronRightUrl} className="programs-chevron" />} /></List><ProgramRows programs={group.programs} /></div>)}{visibleClients.length === 0 ? <Text variant="footnote" tone="muted">Нет программ клиентов с выбранным статусом</Text> : null}</section>
    </>}
    {message ? <Text className="programs-error" role="alert">{message}</Text> : null}
    <FloatingActionButton label="Создать программу" onClick={onOpenCreation}><AddIcon /></FloatingActionButton>
    <Modal
      isOpen={creationDraft !== null}
      title={<span className="program-create-title"><img src={programIconUrl} alt="" aria-hidden="true" />Создать программу</span>}
      hasCloseButton={false}
      onClose={onCancelCreation}
      actions={[
        { id: 'cancel', label: 'Отмена', onClick: onCancelCreation, disabled: creationBusy },
        { id: 'save', label: creationBusy ? 'Сохранение…' : 'Сохранить', onClick: onSaveCreation, disabled: !canSave },
      ]}
    >
      {creationDraft ? <div className="program-create-content">
        <TextInput label="Название" value={creationDraft.name} maxLength={120} autoFocus onChange={(event) => onDraftChange({ ...creationDraft, name: event.target.value })} />
        <List>
          <ListItem onClick={onRequestClientSelection} leading={selectedClient ? <Avatar name={clientName(selectedClient)} src={selectedClient.user.photoUrl ?? undefined} /> : undefined} title="Выбрать клиента" subtitle={selectedClient ? clientName(selectedClient) : undefined} />
          <ListItem onClick={() => onDraftChange({ ...creationDraft, owner: { type: 'self' } })} title="Моя программа" subtitle={creationDraft.owner?.type === 'self' ? 'Выбрано' : undefined} />
        </List>
        {creationError ? <Text variant="footnote" className="programs-error" role="alert">{creationError}</Text> : null}
      </div> : null}
    </Modal>
  </section>;
}
