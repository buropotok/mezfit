import { Avatar, Button, Divider, IconButton, Surface, Text } from './index';
import './catalog.css';

export function UiKitPage() {
  return (
    <main className="ui-kit-page">
      <header className="ui-kit-header">
        <Text variant="caption" tone="muted">Mezfit internal</Text>
        <h1>UI Kit</h1>
        <Text tone="muted">Foundation primitives and their supported states.</Text>
      </header>

      <Surface as="section" className="ui-kit-section">
        <Text variant="title">Typography</Text>
        <Divider />
        <div className="ui-kit-stack">
          <Text variant="title">Title text</Text>
          <Text>Body text for normal interface copy.</Text>
          <Text variant="caption" tone="muted">Muted caption text</Text>
        </div>
      </Surface>

      <Surface as="section" className="ui-kit-section">
        <Text variant="title">Buttons</Text>
        <Divider />
        <div className="ui-kit-row">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="danger">Danger</Button>
          <Button disabled>Disabled</Button>
        </div>
      </Surface>

      <Surface as="section" className="ui-kit-section">
        <Text variant="title">Icon button & avatar</Text>
        <Divider />
        <div className="ui-kit-row">
          <IconButton label="Add item"><span aria-hidden="true">＋</span></IconButton>
          <IconButton label="Disabled action" disabled><span aria-hidden="true">⋯</span></IconButton>
          <Avatar name="Mezfit User" />
        </div>
      </Surface>

      <Surface as="section" elevated className="ui-kit-section">
        <Text variant="title">Elevated surface</Text>
        <Divider />
        <Text tone="muted">Surface, divider and elevation use the shared token layer.</Text>
      </Surface>
    </main>
  );
}
