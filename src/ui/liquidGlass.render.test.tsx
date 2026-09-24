import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IconButton, Surface, Tabs, TabsContent, TabsList, TabsTrigger } from './index';

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
  it('keeps TabsContent outside the springing liquid visual layer', () => {
    const html = renderToStaticMarkup(
      <Tabs theme="liquidGlass" defaultValue="overview">
        <TabsList aria-label="Sections">
          <TabsTrigger value="overview">Обзор</TabsTrigger>
          <TabsTrigger value="program">Программа</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">Persistent page content</TabsContent>
      </Tabs>,
    );

    const layerStart = html.indexOf('class="ui-tabs__liquid-layer"');
    const lensStart = html.indexOf('class="ui-tabs__press-lens"');
    const contentStart = html.indexOf('class="ui-tabs__content"');

    expect(layerStart).toBeGreaterThan(-1);
    expect(lensStart).toBeGreaterThan(layerStart);
    expect(contentStart).toBeGreaterThan(lensStart);
    expect(html.slice(lensStart, contentStart)).toContain('</div></div>');
  });
  it('renders the liquidGlass iconOnly startup shell with hidden state', () => {
    const iconPair = {
      outline: <span data-icon="outline" />,
      filled: <span data-icon="filled" />,
    };
    const html = renderToStaticMarkup(
      <Tabs theme="liquidGlass" mode="iconOnly" hidden defaultValue="overview">
        <TabsList aria-label="Sections">
          <TabsTrigger value="overview" icon={iconPair}>Обзор</TabsTrigger>
          <TabsTrigger value="program" icon={iconPair}>Программа</TabsTrigger>
        </TabsList>
      </Tabs>,
    );

    expect(html).toContain('data-ui-mode="iconOnly"');
    expect(html).toContain('data-startup-state="hidden"');
    expect(html).toContain('ui-tabs__icon-only-startup');
    expect(html).toContain('Обзор');
  });



});
