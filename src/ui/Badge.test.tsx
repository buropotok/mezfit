// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Badge, BadgeChoice, type BadgeColor } from './Badge';

const colors: BadgeColor[] = ['green', 'yellow', 'blue', 'red', 'orange', 'purple', 'cyan', 'gray'];

afterEach(() => cleanup());

describe('Badge', () => {
  it('renders caller-provided content without business-status coupling', () => {
    const html = renderToStaticMarkup(<Badge color="green">Произвольный текст</Badge>);
    expect(html).toContain('Произвольный текст');
    expect(html).toContain('ui-badge--green');
  });

  it.each(colors)('supports the %s color variant', (color) => {
    const html = renderToStaticMarkup(<Badge color={color}>Badge</Badge>);
    expect(html).toContain(`ui-badge--${color}`);
  });

  it('marks only the selected neutral technique badge', () => {
    const selected = renderToStaticMarkup(<Badge color="gray" selected>Дропсет</Badge>);
    const unselected = renderToStaticMarkup(<Badge color="gray">Дропсет</Badge>);
    expect(selected).toContain('ui-badge--selected');
    expect(unselected).not.toContain('ui-badge--selected');
  });

  it('uses Konsta button interactions while preserving Badge selected styling', () => {
    const onClick = vi.fn();
    const view = render(<KonstaProvider theme="ios" dark>
      <BadgeChoice selected onClick={onClick}>Кластер</BadgeChoice>
    </KonstaProvider>);
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Кластер' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.querySelector('.ui-badge--selected')).not.toBeNull();
    expect(button.querySelector('.ui-badge--gray')).not.toBeNull();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();

    view.rerender(<KonstaProvider theme="ios" dark>
      <BadgeChoice disabled onClick={onClick}>Дропсет</BadgeChoice>
    </KonstaProvider>);
    const disabledButton = screen.getByRole<HTMLButtonElement>('button', { name: 'Дропсет' });
    expect(disabledButton.disabled).toBe(true);
    expect(disabledButton.getAttribute('aria-pressed')).toBe('false');
    expect(disabledButton.querySelector('.ui-badge--selected')).toBeNull();
    fireEvent.click(disabledButton);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('uses gray as the default color', () => {
    const html = renderToStaticMarkup(<Badge>Badge</Badge>);
    expect(html).toContain('ui-badge--gray');
  });
});
