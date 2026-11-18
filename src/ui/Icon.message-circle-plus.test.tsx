import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Icon } from './Icon';
import { getUiIconAsset } from './icons/registry';
import messageCirclePlus from './icons/message-circle-plus.svg';

describe('message-circle-plus icon', () => {
  it('renders dedicated chat creation artwork through the shared icon registry', () => {
    expect(getUiIconAsset('message-circle-plus', 'outline')).toBe(messageCirclePlus);
    expect(getUiIconAsset('message-circle-plus', 'filled')).toBe(messageCirclePlus);
    expect(messageCirclePlus).not.toBe(getUiIconAsset('message-circle', 'outline'));
    expect(renderToStaticMarkup(<Icon name="message-circle-plus" />)).toContain('data:image/svg+xml');
  });
});
