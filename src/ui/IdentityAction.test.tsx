/** @vitest-environment jsdom */
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdentityAction } from './IdentityAction';
import { getUiIconAsset } from './icons/registry';

function renderIdentityAction(node: React.ReactNode) {
  return renderToStaticMarkup(
    <KonstaProvider theme="ios" dark>
      {node}
    </KonstaProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('IdentityAction', () => {
  it('renders avatar and title as one semantic action', () => {
    const html = renderIdentityAction(
      <IdentityAction avatar={{ name: 'Andrei Sokolov' }} title="Andrei Sokolov" />,
    );

    expect(html).toContain('<button');
    expect(html).toContain('type="button"');
    expect(html).toContain('ui-glass-surface');
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

  it('renders the registered outline icon in the labeled identity visual slot', () => {
    const view = render(<IdentityAction icon="users" title="Клиенты" />);
    const icon = view.container.querySelector<HTMLElement>('.ui-identity-action__icon');

    expect(view.getByRole('button', { name: 'Клиенты' })).not.toBeNull();
    expect(icon).not.toBeNull();
    expect(icon?.style.getPropertyValue('mask-image')).toContain(getUiIconAsset('users', 'outline'));
    expect(view.container.querySelector('.ui-avatar--fallback')).toBeNull();
  });

  it('supports the public headline title role', () => {
    const view = render(<IdentityAction icon="users" title="Клиенты" titleRole="headline" />);
    const title = view.container.querySelector<HTMLElement>('.ui-identity-action__title');

    expect(title?.classList.contains('ui-text--headline')).toBe(true);
  });

  it('renders the default labeled icon at a real 32px inline size', () => {
    const view = render(<IdentityAction icon="chart-dots-2" title="Аналитика" />);
    const icon = view.container.querySelector<HTMLElement>('.ui-identity-action__icon');

    expect(icon?.style.width).toBe('32px');
    expect(icon?.style.height).toBe('32px');
  });

  it('preserves Konsta disabled button semantics', () => {
    const html = renderIdentityAction(
      <IdentityAction avatar={{ name: 'Andrei Sokolov' }} title="Andrei Sokolov" disabled />,
    );

    expect(html).toContain('disabled');
  });

  it('forwards composite glass overrides without changing IdentityAction mechanics', () => {
    const view = render(
      <IdentityAction
        icon="users"
        title="Клиенты"
        glass={{ tintA: 0, blur: 0, border: 0, shadow: 0, bezel: 0 }}
        glassBezelOpacity={0}
      />,
    );
    const button = view.getByRole('button', { name: 'Клиенты' });

    expect(button.style.getPropertyValue('--ui-glass-surface-tint-a')).toBe('0');
    expect(button.style.getPropertyValue('--ui-glass-surface-blur')).toBe('0px');
    expect(button.style.getPropertyValue('--ui-glass-surface-border')).toBe('0');
    expect(button.style.getPropertyValue('--ui-glass-surface-shadow')).toBe('0');
    expect(button.style.getPropertyValue('--ui-glass-surface-bezel')).toBe('0');
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

  it('finishes the press animation before invoking the action', () => {
    const onClick = vi.fn();
    const view = render(
      <IdentityAction avatar={{ name: 'Andrei Sokolov' }} title="Andrei Sokolov" onClick={onClick} />,
    );
    const button = view.getByRole('button', { name: 'Andrei Sokolov' });

    fireEvent.pointerDown(button, { pointerType: 'touch', button: 0 });
    fireEvent.pointerUp(button, { pointerType: 'touch', button: 0 });
    fireEvent.click(button);
    fireEvent.pointerLeave(button, { pointerType: 'touch' });

    expect(button.classList.contains('ui-identity-action--animating')).toBe(true);
    expect(onClick).not.toHaveBeenCalled();

    fireEvent.animationEnd(button, { animationName: 'ui-identity-action-press' });

    expect(button.classList.contains('ui-identity-action--animating')).toBe(false);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not replay the animation when a long press completed before click', () => {
    const onClick = vi.fn();
    const view = render(<IdentityAction icon="users" title="Клиенты" onClick={onClick} />);
    const button = view.getByRole('button', { name: 'Клиенты' });

    fireEvent.pointerDown(button, { pointerType: 'touch', button: 0 });
    fireEvent.animationEnd(button, { animationName: 'ui-identity-action-press' });

    expect(onClick).not.toHaveBeenCalled();
    expect(button.classList.contains('ui-identity-action--animating')).toBe(false);

    fireEvent.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(button.classList.contains('ui-identity-action--animating')).toBe(false);
  });

  it('coalesces repeated clicks while one animated activation is pending', () => {
    const onClick = vi.fn();
    const view = render(<IdentityAction icon="users" title="Клиенты" onClick={onClick} />);
    const button = view.getByRole('button', { name: 'Клиенты' });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(onClick).not.toHaveBeenCalled();
    expect(button.classList.contains('ui-identity-action--animating')).toBe(true);

    fireEvent.animationEnd(button, { animationName: 'ui-identity-action-press' });

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
