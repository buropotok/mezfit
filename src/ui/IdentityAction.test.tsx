import { renderToStaticMarkup } from 'react-dom/server';
import { KonstaProvider } from 'konsta/react';
import { describe, expect, it } from 'vitest';
import { IdentityAction } from './IdentityAction';

describe('IdentityAction', () => {
  it('renders avatar and title as one semantic action', () => {
    const html = renderToStaticMarkup(
      <KonstaProvider theme="ios" dark>
        <IdentityAction avatar={{ name: 'Andrei Sokolov' }} title="Andrei Sokolov" />
      </KonstaProvider>,
    );

    expect(html).toContain('<button');
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Andrei Sokolov"');
    expect(html).toContain('ui-identity-action');
    expect(html).toContain('ui-identity-action__avatar');
    expect(html).toContain('>AS<');
    expect(html).toContain('ui-identity-action__title">Andrei Sokolov</span>');
  });

  it('preserves native disabled button semantics', () => {
    const html = renderToStaticMarkup(
      <KonstaProvider theme="ios" dark>
        <IdentityAction avatar={{ name: 'Andrei Sokolov' }} title="Andrei Sokolov" disabled />
      </KonstaProvider>,
    );

    expect(html).toContain('disabled');
  });

  it('accepts an explicit accessible label without changing the visible title', () => {
    const html = renderToStaticMarkup(
      <KonstaProvider theme="ios" dark>
        <IdentityAction
          avatar={{ name: 'Andrei Sokolov' }}
          title="Andrei Sokolov"
          aria-label="Открыть клиента Андрей Соколов"
        />
      </KonstaProvider>,
    );

    expect(html).toContain('aria-label="Открыть клиента Андрей Соколов"');
    expect(html).toContain('ui-identity-action__title">Andrei Sokolov</span>');
  });
});
