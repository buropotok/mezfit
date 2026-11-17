// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiscussionSheet } from './DiscussionSheet';
import { useRecordingGesture, RECORDING_LOCK_DISTANCE } from './useRecordingGesture';
import { PRESS_SCALE_PEAK_TIME } from '../ui/PressScale';
import { createDiscussionPreviewPort, previewDiscussionAnchor, previewDiscussionThread } from '../ui/discussion-preview';

class Pointer extends MouseEvent {
  readonly pointerId = 11;
  readonly isPrimary = true;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fakeTelegramSuccess() {
  const notificationOccurred = vi.fn();
  const selectionChanged = vi.fn();
  const impactOccurred = vi.fn();
  vi.stubGlobal('Telegram', { WebApp: { HapticFeedback: {
    notificationOccurred, selectionChanged, impactOccurred,
  } } });
  return { notificationOccurred, selectionChanged, impactOccurred };
}

describe('Telegram success notification at deliberate discussion interactions', () => {
  it('sends exactly one success notification on each voice ↔ video-note mode toggle, not on typing', async () => {
    const haptics = fakeTelegramSuccess();
    render(<KonstaProvider theme="ios" dark>
      <DiscussionSheet opened repository={createDiscussionPreviewPort()}
        threadId={previewDiscussionThread.id} anchor={previewDiscussionAnchor}
        onClose={() => {}} parentNavigation={null} onNavigationContextChange={() => {}}
        resolveAuthor={userId => ({ name: userId })} />
    </KonstaProvider>);

    const microphone = await screen.findByRole('button', { name: 'Переключить на кружок' });
    await waitFor(() => expect(microphone).toHaveProperty('disabled', false));
    fireEvent.click(microphone);
    expect(await screen.findByRole('button', { name: 'Переключить на голосовое' })).toBeTruthy();
    expect(haptics.notificationOccurred).toHaveBeenCalledExactlyOnceWith('success');

    const textarea = screen.getByPlaceholderText('Сообщение');
    fireEvent.change(textarea, { target: { value: 'Черновик' } });
    expect(haptics.notificationOccurred).toHaveBeenCalledTimes(1);
    fireEvent.change(textarea, { target: { value: '' } });

    fireEvent.click(screen.getByRole('button', { name: 'Переключить на голосовое' }));
    expect(await screen.findByRole('button', { name: 'Переключить на кружок' })).toBeTruthy();
    expect(haptics.notificationOccurred).toHaveBeenCalledTimes(2);
    expect(haptics.notificationOccurred).toHaveBeenNthCalledWith(2, 'success');
    expect(haptics.impactOccurred).not.toHaveBeenCalled();
    expect(haptics.selectionChanged).not.toHaveBeenCalled();
  });

  it('notifies once exactly when an active recording crosses the upward lock threshold', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('PointerEvent', Pointer);
    const haptics = fakeTelegramSuccess();

    function Recorder() {
      const [status, setStatus] = useState<'idle' | 'recording'>('idle');
      const gesture = useRecordingGesture({
        status,
        start: async () => { setStatus('recording'); return true; },
        finish: () => setStatus('idle'),
        cancel: () => setStatus('idle'),
      });
      return <button aria-label="Запись" onPointerDown={event => gesture.onPointerDown(event, true)}
        onPointerMove={gesture.onPointerMove} onPointerUp={gesture.onPointerUp}>
        {gesture.phase}
      </button>;
    }

    render(<Recorder />);
    const recorder = screen.getByRole('button', { name: 'Запись' });
    fireEvent.pointerDown(recorder, { clientX: 300, clientY: 600 });
    // No feedback on tap/press alone or before recording actually starts.
    fireEvent.pointerMove(recorder, { clientX: 300, clientY: 600 - RECORDING_LOCK_DISTANCE });
    expect(haptics.notificationOccurred).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(PRESS_SCALE_PEAK_TIME); });

    fireEvent.pointerMove(recorder, { clientX: 300, clientY: 600 - RECORDING_LOCK_DISTANCE + 1 });
    expect(haptics.notificationOccurred).not.toHaveBeenCalled();
    fireEvent.pointerMove(recorder, { clientX: 300, clientY: 600 - RECORDING_LOCK_DISTANCE });
    expect(recorder.textContent).toBe('locked');
    expect(haptics.notificationOccurred).toHaveBeenCalledExactlyOnceWith('success');

    fireEvent.pointerMove(recorder, { clientX: 300, clientY: 420 });
    fireEvent.pointerUp(recorder);
    expect(haptics.notificationOccurred).toHaveBeenCalledTimes(1);
    expect(haptics.impactOccurred).not.toHaveBeenCalled();
    expect(haptics.selectionChanged).not.toHaveBeenCalled();
  });
});
