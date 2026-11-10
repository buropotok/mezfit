// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { gsap } from 'gsap';
import { DiscussionVoiceTrash } from './DiscussionVoiceTrash';

vi.mock('gsap', () => ({ gsap: { timeline: vi.fn(() => ({
  to: vi.fn(), timeScale: vi.fn(), call: vi.fn(), kill: vi.fn(),
})) } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it('keeps the body, viewport and colour fixed while only the lid moves at 1.5x speed', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const { container, rerender } = render(<DiscussionVoiceTrash deleting={false} onComplete={() => {}} />);
  const svg = container.querySelector('svg');
  const body = svg?.firstElementChild;
  const colour = svg?.getAttribute('fill');
  const viewport = svg?.getAttribute('viewBox');
  rerender(<DiscussionVoiceTrash deleting onComplete={() => {}} />);
  const created = vi.mocked(gsap.timeline).mock.results[0];
  if (!created || created.type !== 'return') throw new Error('Missing deletion animation');
  const animation = created.value;
  expect(animation.timeScale).toHaveBeenCalledWith(1.5);
  expect(animation.to).toHaveBeenCalled();
  for (const [target] of vi.mocked(animation.to).mock.calls) expect(target).not.toBe(body);
  expect(svg?.firstElementChild).toBe(body);
  expect(svg?.getAttribute('fill')).toBe(colour);
  expect(svg?.getAttribute('viewBox')).toBe(viewport);
});
