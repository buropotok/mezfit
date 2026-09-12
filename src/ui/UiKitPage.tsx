import { useState } from 'react';
import { Avatar, Button, Divider, FloatingActionButton, IconButton, List, ListItem, Menu, MenuDivider, MenuItem, Modal, Surface, Tabs, TabsContent, TabsList, TabsTrigger, Text } from './index';
import './catalog.css';

export function UiKitPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <main className="ui-kit-page">
      <header className="ui-kit-header"><Text variant="caption" tone="muted">Mezfit internal</Text><h1>UI Kit</h1><Text tone="muted">Foundation primitives and Telegram-derived interaction components.</Text></header>
      <Surface as="section" className="ui-kit-section"><Text variant="title">Typography</Text><Divider /><div className="ui-kit-stack"><Text variant="title">Title text</Text><Text>Body text for normal interface copy.</Text><Text variant="caption" tone="muted">Muted caption text</Text></div></Surface>
      <Surface as="section" className="ui-kit-section"><Text variant="title">Buttons</Text><Divider /><div className="ui-kit-row"><Button>Primary</Button><Button variant="secondary">Secondary</Button><Button variant="danger">Danger</Button><Button disabled>Disabled</Button></div></Surface>
      <Surface as="section" className="ui-kit-section"><Text variant="title">Icon button & avatar</Text><Divider /><div className="ui-kit-row"><IconButton label="Add item"><span aria-hidden="true">＋</span></IconButton><IconButton label="Disabled action" disabled><span aria-hidden="true">⋯</span></IconButton><Avatar name="Mezfit User" /></div></Surface>
      <Surface as="section" className="ui-kit-section"><Text variant="title">Menu</Text><Divider /><Menu isOpen={menuOpen} onOpenChange={setMenuOpen} label="Example menu" trigger={<button type="button" className="ui-icon-button" aria-label="Open menu"><span aria-hidden="true">⋮</span></button>}><MenuItem leading={<span>ⓘ</span>}>Информация</MenuItem><MenuItem active leading={<span>★</span>}>Избранное</MenuItem><MenuDivider /><MenuItem leading={<span>✎</span>}>Редактировать</MenuItem></Menu></Surface>
      <Surface as="section" className="ui-kit-section"><Text variant="title">Tabs</Text><Divider /><Tabs defaultValue="overview"><TabsList aria-label="Client sections"><TabsTrigger value="overview">Обзор</TabsTrigger><TabsTrigger value="program">Программа</TabsTrigger><TabsTrigger value="exercises">Упражнения</TabsTrigger><TabsTrigger value="calendar">Календарь</TabsTrigger></TabsList><TabsContent value="overview"><Text>Обзор клиента</Text></TabsContent><TabsContent value="program"><Text>Программа клиента</Text></TabsContent><TabsContent value="exercises"><Text>Упражнения клиента</Text></TabsContent><TabsContent value="calendar"><Text>Календарь клиента</Text></TabsContent></Tabs></Surface>
      <Surface as="section" className="ui-kit-section" style={{ position: 'relative', minHeight: '19rem' }}><Text variant="title">Telegram lists</Text><Divider /><List><ListItem leading={<Avatar name="Andrei Sokolov" />} title="Andrei Sokolov" subtitle="@sokolag" /><ListItem leadingShape="square" leading={<span style={{ display: 'grid', placeItems: 'center', background: 'var(--ui-color-surface-raised)' }} aria-hidden="true">🏋</span>} title="Жим лёжа · гантели" subtitle="Вес × повторы · Грудь · Гантели x2" trailing="База" /><ListItem leadingShape="square" leading={<span style={{ display: 'grid', placeItems: 'center', background: 'var(--ui-color-surface-raised)' }} aria-hidden="true">💪</span>} title="Грудь" trailing="29" /></List><FloatingActionButton label="Добавить клиента" onClick={() => setModalOpen(true)}><span aria-hidden="true">＋</span></FloatingActionButton></Surface>
      <Surface as="section" elevated className="ui-kit-section"><Text variant="title">Modal</Text><Divider /><Button onClick={() => setModalOpen(true)}>Open modal</Button></Surface>
      <Modal isOpen={modalOpen} title="Пригласить клиента" onClose={() => setModalOpen(false)}><Text>Здесь будет ссылка-приглашение и действие копирования.</Text></Modal>
    </main>
  );
}
