import { renderToStaticMarkup } from 'react-dom/server';
import { KonstaProvider } from 'konsta/react';
import { describe, expect, it } from 'vitest';
import { IdentityAction } from './IdentityAction';

function renderIdentityAction(node: React.ReactNode) {
  return renderToStaticMarkup(
    <KonstaProvider theme="ios" dark>
      {node}
    </KonstaProvider>,
  );
}

describe('IdentityAction', () => {
  it('renders avatar and title as one semantic action', () => {
    const html = renderIdentityAction(
      <IdentityAction avatar={{ name: 'Andrei Sokolov' }} title="Andrei Sokolov" />,
    );

    expect(html).toContain('<button');
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Andrei Sokolov"');
    expect(html).toContain('>AS<');
    expect(html).toContain('ui-identity-action__title">Andrei Sokolov</span>');
  });

  it('renders avatar-only variant as an accessible action without visible title', () => {
    const html = renderIdentityAction(
      <IdentityAction
        avatar={{ name: 'Andrei Sokolov' }}
        title="Andrei Sokolov"
        variant="avatar-only"
      />,
    );

    expect(html).toContain('aria-label="Andrei Sokolov"');
    expect(html).toContain('ui-identity-action--avatar-only');
    expect(html).toContain('>AS<');
    expect(html).not.toContain('ui-identity-action__title');
  });

  it('renders a registered filled icon in the identity visual slot', () => {
    const html = renderIdentityAction(
      <IdentityAction icon="users" title="Клиенты" />,
    );

    expect(html).toContain('aria-label="Клиенты"');
    expect(html).toContain('ui-identity-action__icon');
    expect(html).toContain('data:image/svg+xml');
    expect(html).not.toContain('ui-avatar--fallback');
  });

  it('preserves Konsta disabled button semantics', () => {
    const html = renderIdentityAction(
      <IdentityAction avatar={{ name: 'Andrei Sokolov' }} title="Andrei Sokolov" disabled />,
    );

    expect(html).toContain('disabled');
  });

  it('accepts an explicit accessible label without changing the visible title', () => {
    const html = renderIdentityAction(
      <IdentityAction
        avatar={{ name: 'Andrei Sokolov' }}
        title="Andrei Sokolov"
        aria-label="Открыть клиента Андрей Соколов"
      />,
    );

    expect(html).toContain('aria-label="Открыть клиента Андрей Соколов"');
    expect(html).toContain('ui-identity-action__title">Andrei Sokolov</span>');
  });
});
