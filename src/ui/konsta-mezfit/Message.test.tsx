// @vitest-environment jsdom
import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Message, KonstaProvider } from 'konsta/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MezfitMessage } from './Message';

afterEach(cleanup);
function normalizedMarkup(element: Element): string {
  const copy = element.cloneNode(true);
  if (!(copy instanceof Element)) throw Error('Missing message clone');
  // Class order is immaterial; retain every token, attribute, child and text node.
  for (const node of [copy, ...copy.querySelectorAll('[class]')]) {
    const classes = node.getAttribute('class');
    if (classes !== null) node.setAttribute('class', [...node.classList].sort().join(' '));
  }
  return copy.outerHTML;
}
describe('approved Konsta 5.4 Message bubble boundary adapter', () => {
  it.each(['sent', 'received'])('preserves the upstream %s renderer and exposes only the bubble ref/source/tap', type => {
    const bubble = createRef<HTMLDivElement>(), tapped = vi.fn();
    const view = render(<KonstaProvider theme="ios" dark>
      <Message type={type} name="Автор" avatar={<span>Аватар</span>} text="Текст" textHeader="Цитата" footer="Время" />
      <MezfitMessage type={type} name="Автор" avatar={<span>Аватар</span>} text="Текст" textHeader="Цитата" footer="Время"
        bubbleRef={bubble} onBubbleClick={tapped} bubbleSource={<button aria-hidden="true" data-testid="source" />} />
    </KonstaProvider>);
    // Compare actual upstream output, rather than freezing private class names in a feature.
    const source = screen.getByTestId('source');
    expect(source.parentElement).toBe(bubble.current);
    fireEvent.click(bubble.current!); expect(tapped).toHaveBeenCalledTimes(1);
    const roots = view.container.querySelectorAll('.k-message');
    const adapted = roots[1].cloneNode(true);
    if (!(adapted instanceof HTMLElement)) throw Error('Missing adapted message');
    adapted.querySelector('[data-testid="source"]')?.remove();
    expect(normalizedMarkup(adapted)).toBe(normalizedMarkup(roots[0]));
  });
  it('keeps standard text footers dimmed but renders opted-in media footers at full opacity', () => {
    const view = render(<KonstaProvider theme="ios" dark>
      <MezfitMessage type="received" textFooter={<span data-testid="standard-footer">Обычный текст</span>} />
      <MezfitMessage type="sent" opaqueTextFooter textFooter={<span data-testid="media-footer">Фото</span>} />
    </KonstaProvider>);
    const standard = screen.getByTestId('standard-footer').parentElement;
    const media = screen.getByTestId('media-footer').parentElement;
    expect(standard?.className).toBe(media?.className);
    expect(standard?.classList.contains('opacity-80')).toBe(true);
    expect(standard?.getAttribute('style')).toBeNull();
    expect((media as HTMLElement).style.opacity).toBe('1');
    expect(view.container.querySelectorAll('.k-message')).toHaveLength(2);
  });

  it('limits the focus pulse to the existing Konsta bubble without changing its wrapper or content', () => {
    const view = render(<KonstaProvider theme="ios" dark>
      <MezfitMessage type="received" text="Исходное сообщение" focusPulse />
    </KonstaProvider>);
    const root = view.container.querySelector('.k-message');
    const pulse = root?.querySelector('.ui-mezfit-message__focus-pulse');
    expect(pulse).not.toBeNull();
    expect(root?.classList.contains('ui-mezfit-message__focus-pulse')).toBe(false);
    expect(pulse?.textContent).toBe('Исходное сообщение');
  });

});
