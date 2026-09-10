import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Avatar, Button, IconButton, Surface, Text } from './index';

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
});
