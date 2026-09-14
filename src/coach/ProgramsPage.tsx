import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { getCoachPrograms, type ProgramListItem, type ProgramOwnerGroup, type ProgramStatus } from '../api';
import { Avatar, Badge, IconButton, List, ListItem, Menu, MenuItem, SearchInput, Tabs, TabsList, TabsTrigger, Text } from '../ui';
import programIconUrl from '../ui/icons/Untitled_20260914_023702.svg';
import chevronRightUrl from '../ui/icons/chevron-right.svg';
import copyUrl from '../ui/icons/copy.svg';
import dotsUrl from '../ui/icons/dots-vertical.svg';
import pencilUrl from '../ui/icons/pencil.svg';
import trashUrl from '../ui/icons/trash.svg';
import './programs.css';

type Filter = ProgramStatus;

function MaskIcon({ src, className = '' }: { src: string; className?: string }) {
  const style = { '--programs-icon-url': `url("${src}")` } as CSSProperties;
  return <span className={`programs-mask-icon ${className}`.trim()} style={style} aria-hidden="true" />;
}

function ProgramMenu({ program }: { program: ProgramListItem }) {
  const [open, setOpen] = useState(false);
  return (
    <Menu
      isOpen={open}
      onOpenChange={setOpen}
      align="end"
      label={`Действия с программой ${program.name}`}
      trigger={(
        <IconButton className="programs-more" label={`Открыть меню программы ${program.name}`} data-no-dnd>
          <MaskIcon src={dotsUrl} />
        </IconButton>
      )}
    >
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

  return (
    <div className="programs-card">
      {programs.map((program) => {
        const dates = programDates(program);
        return (
          <div className="programs-row" key={program.id}>
            <div className="programs-icon" aria-hidden="true"><img src={programIconUrl} alt="" /></div>
            <div className="programs-copy">
              <Text className="programs-name">{program.name}</Text>
              {dates ? <Text variant="caption" tone="muted">{dates}</Text> : null}
            </div>
            <div className="programs-status">{statusBadge(program.status)}</div>
            <ProgramMenu program={program} />
          </div>
        );
      })}
    </div>
  );
}

function ownerName(group: ProgramOwnerGroup): string {
  return [group.owner.firstName, group.owner.lastName].filter(Boolean).join(' ');
}

interface ProgramsPageProps {
  initData: string;
  onSelectClient?: (userId: number) => Promise<void>;
}

export function ProgramsPage({ initData, onSelectClient }: ProgramsPageProps) {
  const [programs, setPrograms] = useState<ProgramListItem[] | null>(null);
  const [clientGroups, setClientGroups] = useState<ProgramOwnerGroup[]>([]);
  const [filter, setFilter] = useState<Filter>('active');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    setMessage('');
    getCoachPrograms(initData)
      .then((result) => {
        if (!cancelled) {
          setPrograms(result.programs);
          setClientGroups(result.clients);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setPrograms([]);
          setClientGroups([]);
          setMessage(error instanceof Error ? error.message : 'Не удалось загрузить программы');
        }
      });
    return () => { cancelled = true; };
  }, [initData]);

  const ownPrograms = useMemo(
    () => (programs ?? []).filter((program) => program.status === filter),
    [programs, filter],
  );

  const visibleClients = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('ru-RU');
    return clientGroups
      .filter((group) => !needle || ownerName(group).toLocaleLowerCase('ru-RU').includes(needle))
      .map((group) => ({ ...group, programs: group.programs.filter((program) => program.status === filter) }))
      .filter((group) => group.programs.length > 0);
  }, [clientGroups, filter, search]);

  const selectClient = async (userId: number) => {
    if (!onSelectClient) return;
    setMessage('');
    try {
      await onSelectClient(userId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось открыть карточку клиента');
    }
  };

  return (
    <section className="programs-page" aria-label="Программы">
      <SearchInput
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Поиск клиента"
        aria-label="Поиск клиента"
      />

      <Tabs className="programs-tabs" value={filter} onValueChange={(value) => setFilter(value as Filter)}>
        <TabsList aria-label="Статус программы">
          <TabsTrigger value="active">Активные</TabsTrigger>
          <TabsTrigger value="finished">Завершённые</TabsTrigger>
          <TabsTrigger value="draft">Черновики</TabsTrigger>
        </TabsList>
      </Tabs>

      {programs === null ? <Text tone="muted">Загружаем программы…</Text> : (
        <>
          <section className="programs-section" aria-labelledby="own-programs-title">
            <Text id="own-programs-title" variant="caption" tone="muted" className="programs-section-label">Мои программы</Text>
            <ProgramRows programs={ownPrograms} />
            {ownPrograms.length === 0 ? <Text variant="footnote" tone="muted">Нет программ с выбранным статусом</Text> : null}
          </section>

          <section className="programs-section" aria-labelledby="client-programs-title">
            <Text id="client-programs-title" variant="caption" tone="muted" className="programs-section-label">Программы клиентов</Text>
            {visibleClients.map((group) => (
              <div className="programs-client" key={group.owner.id}>
                <List className="programs-client-list">
                  <ListItem
                    onClick={() => { void selectClient(group.owner.id); }}
                    leading={<Avatar name={ownerName(group)} src={group.owner.photoUrl ?? undefined} />}
                    title={ownerName(group)}
                    trailing={<MaskIcon src={chevronRightUrl} className="programs-chevron" />}
                  />
                </List>
                <ProgramRows programs={group.programs} />
              </div>
            ))}
            {visibleClients.length === 0 ? <Text variant="footnote" tone="muted">Нет программ клиентов с выбранным статусом</Text> : null}
          </section>
        </>
      )}

      {message ? <Text className="programs-error" role="alert">{message}</Text> : null}
    </section>
  );
}
