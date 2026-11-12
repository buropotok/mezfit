import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const css = readFileSync(new URL('./discussion-sheet.css', import.meta.url), 'utf8');
describe('discussion-owned composition', () => {
  it('isolates the transparent wallpaper below the chat media and keeps media opaque', () => {
    const thread = css.match(/\.discussion-thread\s*\{([^}]+)\}/)?.[1] ?? '';
    expect(thread).toContain('isolation: isolate');
    expect(thread).toContain('background-color: #000');
    expect(thread).not.toContain('background-image:');

    const wallpaper = css.match(/\.discussion-thread::before\s*\{([^}]+)\}/)?.[1] ?? '';
    for (const declaration of [
      "content: ''",
      'position: absolute',
      'inset: 0',
      'z-index: 0',
      'pointer-events: none',
      "background-image: url('/discussion-fitness-pattern.svg')",
      'background-position: center',
      'background-repeat: no-repeat',
      'background-size: cover',
    ]) expect(wallpaper).toContain(declaration);

    const scroll = css.match(/\.discussion-thread__scroll\s*\{([^}]+)\}/)?.[1] ?? '';
    expect(scroll).toContain('z-index: 1');
    expect(scroll).toContain('overflow-y: auto');

    const media = css.match(/\.discussion-media--thumbnail\s*\{([^}]+)\}/)?.[1] ?? '';
    expect(media).toContain('background: #111');

    const svg = readFileSync(new URL('../../public/discussion-fitness-pattern.svg', import.meta.url), 'utf8');
    expect(svg).toContain('viewBox="0 0 864 1536"');
    expect(svg).toMatch(/<path\b/);
    expect(svg).not.toMatch(/<(?:rect|image)\b/);
  });

  it('keeps a non-visible round source in the bubble center and one-line quote ellipsis without Konsta selectors', () => {
    const source = css.match(/\.discussion-menu-source\s*\{([^}]+)\}/)?.[1] ?? '';
    for (const declaration of ['left: 50%', 'top: 50%', 'width: 4px', 'height: 4px', 'border-radius: 50%', 'opacity: 0', 'pointer-events: none']) expect(source).toContain(declaration);
    const quote = css.match(/\.discussion-quote__text\s*\{([^}]+)\}/)?.[1] ?? '';
    for (const declaration of ['white-space: nowrap', 'text-overflow: ellipsis', 'overflow: hidden']) expect(quote).toContain(declaration);
    expect(css).not.toMatch(/\.k-|font-size:|font-weight:|line-height:/);
  });
  it('never draws a square outline around the target row', () => {
    expect(css).not.toContain('.discussion-message-target[data-highlighted]');
    expect(css).not.toContain('outline-offset: -2px');
  });
  it('keeps voice attachments inside the message bubble and prevents sideways chat scrolling', () => {
    const voice = css.match(/\.discussion-voice\s*\{([^}]+)\}/)?.[1] ?? '';
    expect(voice).toContain('width: min(100%, 17rem)');
    expect(voice).toContain('max-width: 100%');
    expect(voice).toContain('min-width: 0');
    expect(voice).not.toMatch(/\b(?:vw|dvw|svw|lvw)\b/);

    const scroller = css.match(/\.discussion-thread__scroll\s*\{([^}]+)\}/)?.[1] ?? '';
    expect(scroller).toContain('overflow-x: hidden');
    expect(scroller).toContain('overflow-y: auto');
  });

  it('reserves 24px corners for the growing glass input and no black sync strip', () => {
    const sheet = readFileSync(new URL('./DiscussionSheet.tsx', import.meta.url), 'utf8');
    expect(sheet).toContain('className="discussion-composer__field" {...material} shape={{ radius: 24 }}');
    expect(sheet).not.toContain('className="discussion-composer__field" {...material} shape="capsule"');
    const context = css.split('.discussion-composer-context {')[1]?.split('}')[0] ?? '';
    expect(context).toContain('background: transparent');
    const identity = css.split('.discussion-thread__identity {')[1]?.split('}')[0] ?? '';
    expect(identity).toContain('flex-direction: column');
  });

  it('keeps the composer wrapper transparent so only the three children own glass', () => {
    const block = css.match(/\.discussion-composer\s*\{([^}]+)\}/)?.[1] ?? '';
    for (const declaration of ['position: absolute', 'display: flex', 'background: transparent', 'gap: 8px']) expect(block).toContain(declaration);
    expect(css).not.toContain('.discussion-composer-surface');
  });

});
