// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { forwardRef, useState, type CSSProperties, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { MezfitAutosizeTextarea } from './AutosizeTextarea';

// Keep the public Konsta inputStyle/ref/event contract without replacing the
// adapter's measurement behavior with a handcrafted fake autosize control.
vi.mock('konsta/react', () => ({
  ListInput: forwardRef<HTMLLIElement, {
    label: string; value: string; inputStyle?: CSSProperties;
    onInput?: (event: FormEvent<HTMLTextAreaElement>) => void;
    onChange?: (event: ChangeEvent<HTMLTextAreaElement>) => void;
    children?: ReactNode;
  }>(function MockKonstaListInput({ label, value, inputStyle, onInput, onChange }, ref) {
    return <li ref={ref}><textarea aria-label={label} value={value} style={inputStyle}
      onInput={onInput} onChange={onChange} /></li>;
  }),
}));

const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
afterEach(() => {
  cleanup();
  if (originalScrollHeight) {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeight);
  } else {
    delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
  }
});

function stubContentHeight() {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (this instanceof HTMLTextAreaElement) {
        return this.value.length > 30 ? 168 : 58;
      }
      return 0;
    },
  });
}

it('expands already populated event notes and shrinks when text is deleted', () => {
  stubContentHeight();
  const long = 'Длинное описание. '.repeat(8);
  const view = render(<MezfitAutosizeTextarea label="Описание" value={long} />);
  const textarea = screen.getByRole('textbox', { name: 'Описание' }) as HTMLTextAreaElement;
  expect(textarea.style.height).toBe('168px');
  expect(textarea.style.overflowY).toBe('hidden');
  expect(textarea.style.resize).toBe('none');

  view.rerender(<MezfitAutosizeTextarea label="Описание" value="Коротко" />);
  expect(textarea.style.height).toBe('80px');
});

it('expands as the user types without changing the Konsta onChange contract', () => {
  stubContentHeight();
  function Editor() {
    const [value, setValue] = useState('');
    return <MezfitAutosizeTextarea label="Описание" value={value}
      onChange={event => setValue(event.target.value)} />;
  }
  render(<Editor />);
  const textarea = screen.getByRole('textbox', { name: 'Описание' }) as HTMLTextAreaElement;
  expect(textarea.style.height).toBe('80px');
  fireEvent.change(textarea, { target: { value: 'Большое описание. '.repeat(8) } });
  expect(textarea.style.height).toBe('168px');
});
