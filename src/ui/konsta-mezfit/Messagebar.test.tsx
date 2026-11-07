// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KonstaProvider } from 'konsta/react';
import { MezfitMessagebar } from './Messagebar';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function Example() {
  const [value, setValue] = useState('');
  return <KonstaProvider theme="ios" dark>
    <MezfitMessagebar placeholder="Сообщение" value={value} maxRows={5}
      onChange={event => setValue(event.target.value)} />
  </KonstaProvider>;
}

describe('Mezfit Konsta Messagebar autosizing adapter', () => {
  it('grows to five lines, scrolls internally beyond the limit, then shrinks', () => {
    vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLTextAreaElement) {
      return this.value.split('\n').length * 16 + 16;
    });
    render(<Example />);
    const area = screen.getByPlaceholderText('Сообщение') as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: '1\n2\n3\n4' } });
    const medium = Number.parseFloat(area.style.height);
    expect(medium).toBeGreaterThan(40);
    fireEvent.change(area, { target: { value: '1\n2\n3\n4\n5\n6\n7\n8' } });
    expect(Number.parseFloat(area.style.height)).toBeLessThan(150);
    expect(area.style.overflowY).toBe('auto');
    fireEvent.change(area, { target: { value: '1' } });
    expect(Number.parseFloat(area.style.height)).toBeLessThan(medium);
    expect(area.style.overflowY).toBe('hidden');
  });
  it('centers the bare single-line input at 48 px while retaining five-row growth and overflow', () => {
    vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLTextAreaElement) {
      return this.value.split('\\n').length * 16 + 32;
    });
    function BareExample() {
      const [value, setValue] = useState('');
      return <KonstaProvider theme="ios" dark>
        <MezfitMessagebar bare placeholder="Сообщение" value={value} maxRows={5}
          onChange={event => setValue(event.target.value)} />
      </KonstaProvider>;
    }
    const view = render(<BareExample />);
    const input = screen.getByPlaceholderText('Сообщение') as HTMLTextAreaElement;
    expect(view.container.querySelector('.ui-mezfit-messagebar--bare')).not.toBeNull();
    expect(input.style.height).toBe('48px');
    fireEvent.change(input, { target: { value: '1\\n2\\n3' } });
    expect(Number.parseFloat(input.style.height)).toBeGreaterThan(48);
    fireEvent.change(input, { target: { value: '1\\n2\\n3\\n4\\n5\\n6\\n7\\n8' } });
    expect(input.style.overflowY).toBe('auto');
    fireEvent.change(input, { target: { value: 'Одна строка' } });
    expect(input.style.height).toBe('48px');
  });

});
