import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IconButton, Surface } from './index';

const iconPair = {
  outline: <span data-icon="outline" />,
  filled: <span data-icon="filled" />,
};

if (false) {
  // @ts-expect-error glass IconButton owns its material color
  <IconButton label="Invalid color" theme="glass" color="green" />;
  // @ts-expect-error glass IconButton owns its material shadow
  <IconButton label="Invalid shadow" theme="glass" shadow />;
  // @ts-expect-error controlled glass selection requires outline + filled artwork
  <IconButton label="Invalid selection" theme="glass" selected={false} />;
  // @ts-expect-error glass Surface owns its border
  <Surface theme="glass" border={false} />;
  // @ts-expect-error glass Surface owns its shadow
  <Surface theme="glass" elevated />;
}

describe('glass primitive composition', () => {
  it('keeps glass material classes separate from default IconButton selected/shadow classes', () => {
    const html = renderToStaticMarkup(
      <IconButton label="Settings" theme="glass" selected icon={iconPair} />,
    );

    expect(html).toContain('data-ui-theme="glass"');
    expect(html).toContain('data-selected="true"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('ui-icon-button__icon-outline');
    expect(html).toContain('ui-icon-button__icon-filled');
    expect(html).not.toContain('ui-icon-button--selected');
    expect(html).not.toContain('ui-icon-button--shadow');
  });

  it('keeps glass Surface free of default border/elevation modifiers', () => {
    const html = renderToStaticMarkup(<Surface theme="glass">Glass</Surface>);

    expect(html).toContain('data-ui-theme="glass"');
    expect(html).not.toContain('ui-surface--borderless');
    expect(html).not.toContain('ui-surface--elevated');
  });
});
