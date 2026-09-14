import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Checkbox, Radio, TextInput } from './FormControls';

describe('TextInput', () => {
  it('connects the floating label to the native input', () => {
    const html = renderToStaticMarkup(<TextInput id="name" label="Имя" defaultValue="Андрей" />);
    expect(html).toContain('id="name"');
    expect(html).toContain('for="name"');
    expect(html).toContain('ui-text-input--filled');
  });

  it('exposes invalid state to assistive technology', () => {
    const html = renderToStaticMarkup(<TextInput label="Имя" error="Обязательное поле" />);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('Обязательное поле');
  });
});

describe('Checkbox', () => {
  it('renders a native checkbox with its label', () => {
    const html = renderToStaticMarkup(<Checkbox id="sync" label="Синхронизировать" defaultChecked />);
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('for="sync"');
    expect(html).toContain('checked=""');
  });
});

describe('Radio', () => {
  it('renders a native radio and preserves grouping props', () => {
    const html = renderToStaticMarkup(<Radio id="one" name="choice" value="one" label="Первый" defaultChecked />);
    expect(html).toContain('type="radio"');
    expect(html).toContain('name="choice"');
    expect(html).toContain('value="one"');
  });
});
