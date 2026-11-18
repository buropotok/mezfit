// @vitest-environment jsdom
import { StrictMode, useState } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiquidGlassTextOnly } from './LiquidGlassTextOnly';
import { installTextOnlyLayout, sceneElement, textOnlyScene } from './liquid-glass-text-only/layout.test-support';

const tabs = ['Тренировки', 'Питание', 'Личное', 'Клиентские'].map(label => ({ value: label, label }));
const changed = vi.fn();
const action = vi.fn();
let layout: ReturnType<typeof installTextOnlyLayout>;
function Tabs({ withAction = true, wide = false, custom = false }: { withAction?: boolean; wide?: boolean; custom?: boolean }) {
  const [value, setValue] = useState(tabs[0].value);
  return <LiquidGlassTextOnly tabs={custom ? [...tabs, { value: 'custom', label: 'Своя' }] : tabs}
    hidden={false} fullWidth value={value} onValueChange={next => { changed(next); setValue(next); }}
    actionTab={withAction ? { label: '+', onClick: action, widthMultiplier: wide ? 2 : undefined } : undefined} />;
}
beforeEach(() => {
  vi.useFakeTimers();
  layout = installTextOnlyLayout();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  changed.mockClear();
  action.mockClear();
});

describe('Text Only action layout and completed touch clicks', () => {
  it.each([false, true])('keeps the immediate right neighbour visible, withAction=%s', withAction => {
    const view = render(<Tabs withAction={withAction} wide />);
    const root = textOnlyScene(view.container);
    const strip = sceneElement(root, '#tab-strip');
    fireEvent.click(sceneElement(root, '[data-index="3"]'));
    act(() => vi.advanceTimersByTime(340));
    const neighbour = sceneElement(root, withAction ? '[data-action-tab]' : '[data-index="3"]');
    expect(neighbour.offsetLeft + neighbour.offsetWidth).toBeLessThanOrEqual(strip.scrollLeft + strip.clientWidth + .5);
    expect(strip.scrollLeft).toBeCloseTo(withAction ? 148 : 80, 0);
    expect(changed).toHaveBeenCalledExactlyOnceWith('Клиентские');
    expect(action).not.toHaveBeenCalled();
  });

  it('uses the next custom category rather than skipping to the final action', () => {
    const view = render(<Tabs custom wide />);
    const root = textOnlyScene(view.container);
    const strip = sceneElement(root, '#tab-strip');
    fireEvent.click(sceneElement(root, '[data-index="3"]'));
    act(() => vi.advanceTimersByTime(340));
    expect(strip.scrollLeft).toBeCloseTo(170, 0);
    expect(sceneElement(root, '[data-action-tab]').offsetLeft + 68).toBeGreaterThan(strip.scrollLeft + strip.clientWidth);
  });

  it('doubles only intrinsic action width, tracks label resize, and restores the default', () => {
    const view = render(<Tabs />);
    const root = textOnlyScene(view.container);
    const initialWidth = sceneElement(root, '[data-action-tab]').offsetWidth;
    const tabWidth = sceneElement(root, '[data-index="3"]').offsetWidth;
    view.rerender(<Tabs wide />);
    expect(textOnlyScene(view.container)).toBe(root);
    expect(sceneElement(root, '[data-action-tab]').offsetWidth).toBe(initialWidth * 2);
    expect(sceneElement(root, '[data-index="3"]').offsetWidth).toBe(tabWidth);
    act(() => layout.resizeLabel(12));
    expect(sceneElement(root, '[data-action-tab]').offsetWidth).toBe((12 + 26) * 2);
    view.rerender(<Tabs />);
    expect(sceneElement(root, '[data-action-tab]').style.width).toBe('');
    expect(sceneElement(root, '[data-action-tab]').offsetWidth).toBe(12 + 26);
    expect(changed).not.toHaveBeenCalled();
  });

  it('accepts the captured-pane compatibility click exactly once without selection', () => {
    const view = render(<StrictMode><Tabs wide /></StrictMode>);
    const root = textOnlyScene(view.container);
    const strip = sceneElement(root, '#tab-strip');
    const button = sceneElement(root, '[data-action-tab]');
    strip.scrollLeft = strip.scrollWidth - strip.clientWidth;
    const clientX = button.offsetLeft + button.offsetWidth / 2 - strip.scrollLeft;
    fireEvent.pointerDown(button, { pointerType: 'touch', pointerId: 1, clientX, clientY: 22 });
    fireEvent.pointerUp(document, { pointerType: 'touch', pointerId: 1, clientX, clientY: 22 });
    expect(action).not.toHaveBeenCalled();
    fireEvent.click(sceneElement(root, '#toolbar-pane'), { clientX, clientY: 22 });
    expect(action).toHaveBeenCalledTimes(1);
    fireEvent.click(button, { clientX, clientY: 22 });
    expect(action).toHaveBeenCalledTimes(1);
    expect(changed).not.toHaveBeenCalled();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['hold', 'swipe', 'cancel'] as const)('rejects a captured click after action %s', gesture => {
    const view = render(<Tabs wide />);
    const root = textOnlyScene(view.container);
    const strip = sceneElement(root, '#tab-strip');
    const button = sceneElement(root, '[data-action-tab]');
    strip.scrollLeft = strip.scrollWidth - strip.clientWidth;
    const clientX = button.offsetLeft + button.offsetWidth / 2 - strip.scrollLeft;
    fireEvent.pointerDown(button, { pointerId: 2, pointerType: 'touch', clientX, clientY: 22 });
    if (gesture === 'hold') act(() => vi.advanceTimersByTime(160));
    if (gesture === 'swipe') fireEvent.pointerMove(document, { pointerId: 2, pointerType: 'touch', clientX: clientX + 40, clientY: 22 });
    if (gesture === 'cancel') fireEvent.pointerCancel(document, { pointerId: 2, pointerType: 'touch', clientX, clientY: 22 });
    else fireEvent.pointerUp(document, { pointerId: 2, pointerType: 'touch', clientX, clientY: 22 });
    fireEvent.click(sceneElement(root, '#toolbar-pane'), { clientX, clientY: 22 });
    fireEvent.click(button, { clientX, clientY: 22 });
    expect(action).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });

  it('does not scroll a strip that fits the available width', () => {
    cleanup();
    vi.restoreAllMocks();
    installTextOnlyLayout(600);
    const view = render(<Tabs wide />);
    const root = textOnlyScene(view.container);
    fireEvent.click(sceneElement(root, '[data-index="3"]'));
    act(() => vi.advanceTimersByTime(340));
    expect(sceneElement(root, '#tab-strip').scrollLeft).toBe(0);
  });
});
