import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IconButton, Surface, Tabs, TabsList, TabsTrigger } from './index';

const iconPair = {
  outline: <span data-icon="outline" />,
  filled: <span data-icon="filled" />,
};

describe('UI Kit component themes and icon states', () => {
  it('keeps default component themes when theme is omitted', () => {
    const iconButtonHtml = renderToStaticMarkup(<IconButton label="Settings">S</IconButton>);
    const tabsHtml = renderToStaticMarkup(<Tabs defaultValue="one"><TabsList><TabsTrigger value="one">One</TabsTrigger></TabsList></Tabs>);

    expect(iconButtonHtml).toContain('data-ui-theme="default"');
    expect(tabsHtml).toContain('data-ui-theme="default"');
    expect(tabsHtml).toContain('data-ui-mode="default"');
  });

  it('marks glass Surface and IconButton variants', () => {
    const surfaceHtml = renderToStaticMarkup(<Surface theme="glass">Glass</Surface>);
    const iconButtonHtml = renderToStaticMarkup(<IconButton label="Settings" theme="glass">S</IconButton>);

    expect(surfaceHtml).toContain('data-ui-theme="glass"');
    expect(surfaceHtml).not.toContain('ui-surface--borderless');
    expect(iconButtonHtml).toContain('data-ui-theme="glass"');
  });

  it('renders outline and filled IconButton artwork for selected state', () => {
    const html = renderToStaticMarkup(<IconButton label="Settings" selected icon={iconPair} />);

    expect(html).toContain('data-selected="true"');
    expect(html).toContain('ui-icon-button__icon-outline');
    expect(html).toContain('ui-icon-button__icon-filled');
    expect(html).toContain('data-icon="outline"');
    expect(html).toContain('data-icon="filled"');
  });

  it('keeps the existing selected IconButton contract without requiring an icon pair', () => {
    const html = renderToStaticMarkup(<IconButton label="Selected" selected>S</IconButton>);

    expect(html).toContain('ui-icon-button--selected');
    expect(html).toContain('aria-pressed="true"');
  });

  it('renders icon Tabs with explicit outline and filled artwork', () => {
    const html = renderToStaticMarkup(
      <Tabs defaultValue="one" mode="icon" theme="glass">
        <TabsList>
          <TabsTrigger value="one" icon={iconPair}>One</TabsTrigger>
        </TabsList>
      </Tabs>,
    );

    expect(html).toContain('data-ui-theme="glass"');
    expect(html).toContain('data-ui-mode="icon"');
    expect(html).toContain('ui-tabs__icon-outline');
    expect(html).toContain('ui-tabs__icon-filled');
  });

  it('rejects icon Tabs triggers without an icon pair', () => {
    expect(() => renderToStaticMarkup(
      <Tabs defaultValue="one" mode="icon">
        <TabsList>
          <TabsTrigger value="one">One</TabsTrigger>
        </TabsList>
      </Tabs>,
    )).toThrow('TabsTrigger requires both outline and filled icons');
  });
});
