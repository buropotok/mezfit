import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TextInput } from './FormControls';
import { Button, IconButton, type ButtonColor } from './primitives';

const colors: ButtonColor[] = ['green', 'yellow', 'blue', 'red', 'orange', 'purple', 'cyan', 'gray'];

describe('selectable UI controls', () => {
  it.each(colors)('exposes the %s color through Button public API', (color) => {
    const html = renderToStaticMarkup(<Button color={color} selected>{color}</Button>);
    expect(html).toContain(`ui-button--color-${color}`);
    expect(html).toContain('ui-button--selected');
    expect(html).toContain('aria-pressed="true"');
  });

  it('supports compact and shadow button presentation', () => {
    const html = renderToStaticMarkup(<Button size="compact" shadow>RPE 8</Button>);
    expect(html).toContain('ui-button--compact');
    expect(html).toContain('ui-button--shadow');
  });

  it('supports selected color and shadow on IconButton', () => {
    const html = renderToStaticMarkup(<IconButton label="Ленты" color="purple" selected shadow>+</IconButton>);
    expect(html).toContain('ui-icon-button--color-purple');
    expect(html).toContain('ui-icon-button--selected');
    expect(html).toContain('ui-icon-button--shadow');
    expect(html).toContain('aria-pressed="true"');
  });

  it('exposes number alignment and native-control visibility through TextInput', () => {
    const html = renderToStaticMarkup(<TextInput type="number" textAlign="center" showNumberControls={false} aria-label="Вес" />);
    expect(html).toContain('ui-text-input--align-center');
    expect(html).toContain('ui-text-input--hide-number-controls');
    expect(html).toContain('type="number"');
  });
});
