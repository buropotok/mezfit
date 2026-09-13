import { useState } from 'react';
import { Avatar, Button, Divider, Dropdown, FloatingActionButton, IconButton, List, ListItem, Menu, MenuDivider, MenuItem, Modal, SearchInput, SortableList, Surface, Tabs, TabsContent, TabsList, TabsTrigger, Text, type DropdownOption, type SortableListItem } from './index';
import './catalog.css';

const initialExercises: SortableListItem[] = [
  { id: 'bench', content: <ListItem leadingShape="square" leading={<span style={{ display: 'grid', placeItems: 'center', background: 'var(--ui-color-surface-raised)' }} aria-hidden="true">🏋</span>} title="Жим лёжа · гантели" subtitle="4 подхода · Грудь" trailing="⋮" /> },
  { id: 'row', content: <ListItem leadingShape="square" leading={<span style={{ display: 'grid', placeItems: 'center', background: 'var(--ui-color-surface-raised)' }} aria-hidden="true">💪</span>} title="Тяга гантели" subtitle="4 подхода · Спина" trailing="⋮" /> },
  { id: 'squat', content: <ListItem leadingShape="square" leading={<span style={{ display: 'grid', placeItems: 'center', background: 'var(--ui-color-surface-raised)' }} aria-hidden="true">🦵</span>} title="Приседания" subtitle="4 подхода · Ноги" trailing="⋮" /> },
];

const dropdownOptions: DropdownOption[] = [
  { value: 'strength', label: 'Силовая' },
  { value: 'hypertrophy', label: 'Гипертрофия' },
  { value: 'endurance', label: 'Выносливость' },
  { value: 'mobility', label: 'Мобильность' },
  { value: 'recovery', label: 'Восстановление' },
  { value: 'technique', label: 'Техника' },
  { value: 'cardio', label: 'Кардио' },
  { value: 'general', label: 'Общая подготовка' },
];

export function UiKitPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [exercises, setExercises] = useState(initialExercises);
  const [singleValue, setSingleValue] = useState<string | null>('strength');
  const [multiValue, setMultiValue] = useState<string[]>(['strength', 'mobility']);
  return (
    <main className="ui-kit-page">
      <header className="ui-kit-header"><Text variant="caption" tone="muted">Mezfit internal</Text><h1>UI Kit</h1><Text tone="muted">Foundation primitives and Telegram-derived interaction components.</Text></header>
      <Surface as="section" className="ui-kit-section"><Text variant="title">Typography</Text><Text variant="caption" tone="muted">SF Pro on Apple devices · Golos Text on other platforms</Text><Divider /><div className="ui-kit-stack"><Text variant="large-title">Программа тренировок · 24/28</Text><Text variant="title">Сегодня · 20/24</Text><Text variant="headline">Жим лёжа · 17/22</Text><Text>4 подхода · 8–10 повторений · 15/20</Text><Text variant="footnote" tone="muted">Последняя тренировка вчера · 13/18</Text><Text variant="caption" tone="muted">ОБНОВЛЕНО 12:45 · MEZFIT · 12/16</Text></div></Surface>
      <Surface as="section" className="ui-kit-section"><Text variant="title">Buttons</Text><Divider /><div className="ui-kit-row"><Button>Primary</Button><Button variant="secondary">Secondary</Button><Button variant="danger">Danger</Button><Button disabled>Disabled</Button></div></Surface>
      <Surface as="section" className="ui-kit-section"><Text variant="title">Search</Text><Divider /><SearchInput aria-label="Поиск" placeholder="Поиск" value={search} onChange={(event) => setSearch(event.currentTarget.value)} onClear={() => setSearch('')} /></Surface>
      <Surface as="section" className="ui-kit-section"><Text variant="title">Icon button & avatar</Text><Divider /><div className="ui-kit-row"><IconButton label="Add item"><span aria-hidden="true">＋</span></IconButton><IconButton label="Disabled action" disabled><span aria-hidden="true">⋯</span></IconButton><Avatar name="Mezfit User" /></div></Surface>
      <Surface as="section" className="ui-kit-section"><Text variant="title">Menu</Text><Divider /><Menu isOpen={menuOpen} onOpenChange={setMenuOpen} label="Example menu" trigger={<button type="button" className="ui-icon-button" aria-label="Open menu"><span aria-hidden="true">⋮</span></button>}><MenuItem leading={<span>ⓘ</span>}>Информация</MenuItem><MenuItem active leading={<span>★</span>}>Избранное</MenuItem><MenuDivider /><MenuItem leading={<span>✎</span>}>Редактировать</MenuItem></Menu></Surface>
      <Surface as="section" className="ui-kit-section"><Text variant="title">Tabs</Text><Divider /><Tabs defaultValue="overview"><TabsList aria-label="Client sections"><TabsTrigger value="overview">Обзор</TabsTrigger><TabsTrigger value="program">Программа</TabsTrigger><TabsTrigger value="exercises">Упражнения</TabsTrigger><TabsTrigger value="calendar">Календарь</TabsTrigger></TabsList><TabsContent value="overview"><Text>Обзор клиента</Text></TabsContent><TabsContent value="program"><Text>Программа клиента</Text></TabsContent><TabsContent value="exercises"><Text>Упражнения клиента</Text></TabsContent><TabsContent value="calendar"><Text>Календарь клиента</Text></TabsContent></Tabs></Surface>
      <Surface as="section" className="ui-kit-section"><Text variant="title">Dropdown</Text><Text variant="caption" tone="muted">Telegram-style выбор: синее значение открывает модалку со списком.</Text><Divider /><div className="ui-kit-stack"><div><Text tone="muted">Single: </Text><Dropdown mode="single" title="Цель тренировки" options={dropdownOptions} value={singleValue} onChange={setSingleValue} /></div><div><Text tone="muted">Multi: </Text><Dropdown mode="multi" title="Направления" options={dropdownOptions} value={multiValue} onChange={setMultiValue} /></div></div></Surface>
      <Surface as="section" className="ui-kit-section" style={{ position: 'relative', minHeight: '19rem' }}><Text variant="title">Telegram lists</Text><Divider /><List><ListItem leading={<Avatar name="Andrei Sokolov" />} title="Andrei Sokolov" subtitle="@sokolag" /><ListItem leadingShape="square" leading={<span style={{ display: 'grid', placeItems: 'center', background: 'var(--ui-color-surface-raised)' }} aria-hidden="true">🏋</span>} title="Жим лёжа · гантели" subtitle="Вес × повторы · Грудь · Гантели x2" trailing="База" /><ListItem leadingShape="square" leading={<span style={{ display: 'grid', placeItems: 'center', background: 'var(--ui-color-surface-raised)' }} aria-hidden="true">💪</span>} title="Грудь" trailing="29" /></List><FloatingActionButton label="Добавить клиента" onClick={() => setModalOpen(true)}><span aria-hidden="true">＋</span></FloatingActionButton></Surface>
      <Surface as="section" className="ui-kit-section"><Text variant="title">Telegram list · text only</Text><Text variant="caption" tone="muted">Без leading-картинки: высота строки определяется текстом и вертикальными отступами.</Text><Divider /><List><ListItem title="Первый вариант" /><ListItem title="Второй вариант" /><ListItem title="Третий вариант" /><ListItem title="Четвёртый вариант" /></List></Surface>
      <Surface as="section" className="ui-kit-section"><Text variant="title">Sortable Telegram list</Text><Text variant="caption" tone="muted">Удерживайте строку и перетащите её. Интерактивные элементы можно исключить через data-no-dnd.</Text><Divider /><SortableList items={exercises} onReorder={setExercises} /></Surface>
      <Surface as="section" elevated className="ui-kit-section"><Text variant="title">Modal</Text><Divider /><Button onClick={() => setModalOpen(true)}>Open modal</Button></Surface>
      <Modal isOpen={modalOpen} title="Пригласить клиента" onClose={() => setModalOpen(false)}><Text>Здесь будет ссылка-приглашение и действие копирования.</Text></Modal>
    </main>
  );
}
