import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button, IconButton, TextInput } from './index';

describe('selectable UI Kit controls', () => {
  it('supports compact colored selected buttons through the public API', () => {
    const html = renderToStaticMarkup(<Button variant="secondary" size="compact" color="purple" selected shadow>RPE 8</Button>);
    expect(html).toContain('ui-button--compact');
    expect(html).toContain('ui-button--color-purple');
    expect(html).toContain('ui-button--selected');
    expect(html).toContain('ui-button--shadow');
    expect(html).toContain('aria-pressed="true"');
  });

  it('supports selected and shadow states for icon buttons', () => {
    const html = renderToStaticMarkup(<IconButton label="Bands" color="blue" selected shadow><span>+</span></IconButton>);
    expect(html).toContain('ui-icon-button--color-blue');
    expect(html).toContain('ui-icon-button--selected');
    expect(html).toContain('ui-icon-button--shadow');
    expect(html).toContain('aria-pressed="true"');
  });

  it('supports centered numeric input without browser number controls', () => {
    const html = renderToStaticMarkup(<TextInput type="number" textAlign="center" showNumberControls={false} />);
    expect(html).toContain('ui-text-input--align-center');
    expect(html).toContain('ui-text-input--hide-number-controls');
    expect(html).toContain('type="number"');
  });
});
