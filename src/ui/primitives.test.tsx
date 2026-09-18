import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Avatar, Button, FloatingActionButton, IconButton, List, ListItem, Surface, Text } from './index';

describe('UI Kit primitives', () => {
  it('keeps button semantics and disabled state', () => {
    const html = renderToStaticMarkup(<Button disabled>Save</Button>);
    expect(html).toContain('<button');
    expect(html).toContain('disabled');
    expect(html).toContain('type="button"');
  });

  it('requires an accessible name for icon buttons', () => {
    const html = renderToStaticMarkup(<IconButton label="Add"><span>+</span></IconButton>);
    expect(html).toContain('aria-label="Add"');
  });

  it('renders avatar fallback initials', () => {
    const html = renderToStaticMarkup(<Avatar name="Mezfit User" />);
    expect(html).toContain('MU');
    expect(html).toContain('aria-label="Mezfit User"');
  });

  it('renders semantic surface elements', () => {
    const html = renderToStaticMarkup(<Surface as="section"><Text>Content</Text></Surface>);
    expect(html).toContain('<section');
    expect(html).toContain('Content');
  });

  it('supports a borderless surface while keeping the bordered default', () => {
    const borderedHtml = renderToStaticMarkup(<Surface>Bordered</Surface>);
    const borderlessHtml = renderToStaticMarkup(<Surface border={false}>Borderless</Surface>);
    expect(borderedHtml).not.toContain('ui-surface--borderless');
    expect(borderlessHtml).toContain('ui-surface--borderless');
  });

  it('renders contact-list semantics without feature coupling', () => {
    const html = renderToStaticMarkup(<List><ListItem title="Andrei" subtitle="@sokolag" /></List>);
    expect(html).toContain('role="list"');
    expect(html).toContain('role="listitem"');
    expect(html).toContain('Andrei');
    expect(html).toContain('@sokolag');
  });

  it('exposes divider presentation through the List public API', () => {
    const plainHtml = renderToStaticMarkup(<List><ListItem title="Plain" /></List>);
    const insetHtml = renderToStaticMarkup(<List divider="inset"><ListItem title="Inset" /></List>);
    const fullHtml = renderToStaticMarkup(<List divider="full"><ListItem title="Full" /></List>);

    expect(plainHtml).not.toContain('ui-list--divider-');
    expect(insetHtml).toContain('ui-list--divider-inset');
    expect(fullHtml).toContain('ui-list--divider-full');
  });

  it('keeps an independent trailing action outside the interactive row button', () => {
    const html = renderToStaticMarkup(
      <List>
        <ListItem
          title="Exercise"
          trailing={<span aria-hidden="true">•</span>}
          trailingAction={<button type="button" aria-label="Actions">⋮</button>}
        />
      </List>,
    );

    expect(html).toContain('ui-list-item-wrap--with-action');
    expect(html).toContain('ui-list-item__trailing-action');
    expect(html).toMatch(/<\/button><span class="ui-list-item__trailing-action"><button/);
  });

  it('gives the floating action button an accessible name', () => {
    const html = renderToStaticMarkup(<FloatingActionButton label="Добавить клиента">+</FloatingActionButton>);
    expect(html).toContain('aria-label="Добавить клиента"');
    expect(html).toContain('ui-fab--shown');
  });

  it('supports canonical textual FAB labels without a nested typography primitive', () => {
    const html = renderToStaticMarkup(<FloatingActionButton label="Confirm">ОК</FloatingActionButton>);
    expect(html).toContain('>ОК</button>');
    expect(html).not.toContain('ui-text');
  });

  it('makes a hidden floating action button inaccessible and non-tabbable', () => {
    const html = renderToStaticMarkup(
      <FloatingActionButton label="Добавить клиента" isShown={false} aria-hidden={false} tabIndex={0}>+</FloatingActionButton>,
    );
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('ui-fab--hidden');
  });
});
