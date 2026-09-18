import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IconButton, Surface, Tabs, TabsList, TabsTrigger } from './index';

describe('liquidGlass UI Kit variants', () => {
  it('exposes liquidGlass as an IconButton theme without changing button semantics', () => {
    const html = renderToStaticMarkup(
      <IconButton label="Settings" theme="liquidGlass"><span aria-hidden="true">⚙</span></IconButton>,
    );

    expect(html).toContain('<button');
    expect(html).toContain('aria-label="Settings"');
    expect(html).toContain('data-ui-theme="liquidGlass"');
    expect(html).toContain('ui-icon-button');
  });

  it('exposes liquidGlass as a Surface theme', () => {
    const html = renderToStaticMarkup(<Surface theme="liquidGlass">Content</Surface>);

    expect(html).toContain('data-ui-theme="liquidGlass"');
    expect(html).toContain('ui-surface');
    expect(html).toContain('Content');
  });

  it('renders the liquidGlass lens layer for text tabs', () => {
    const html = renderToStaticMarkup(
      <Tabs theme="liquidGlass" defaultValue="overview">
        <TabsList aria-label="Sections">
          <TabsTrigger value="overview">Обзор</TabsTrigger>
          <TabsTrigger value="program">Программа</TabsTrigger>
        </TabsList>
      </Tabs>,
    );

    expect(html).toContain('data-ui-theme="liquidGlass"');
    expect(html).toContain('data-ui-mode="default"');
    expect(html).toContain('ui-tabs__press-lens');
    expect(html).toContain('data-ui-tab-value="overview"');
  });
});
