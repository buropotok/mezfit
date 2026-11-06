// @vitest-environment jsdom
import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Message, KonstaProvider } from 'konsta/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MezfitMessage } from './Message';

afterEach(cleanup);
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
    expect(adapted.outerHTML).toBe(roots[0].outerHTML);
  });
});
