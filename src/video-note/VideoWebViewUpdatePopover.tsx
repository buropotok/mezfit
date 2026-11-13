import { Button } from 'konsta/react';
import { createPortal } from 'react-dom';
import { getTelegramWebApp, openExternalLink } from '../telegram';
import { MezfitPopover } from '../ui/konsta-mezfit/Popover';
import { Text } from '../ui/primitives';

const WEBVIEW_STORE_URL = 'https://play.google.com/store/apps/details?id=com.google.android.webview';
const UPDATE_MESSAGE = 'Для записи видео обновите Android System WebView.';

export function shouldShowWebViewUpdate(unsupportedFormat: boolean): boolean {
  if (!unsupportedFormat) return false;
  return /^android(?:_|$)/i.test(getTelegramWebApp()?.platform ?? '') || /android/i.test(navigator.userAgent);
}

export function VideoWebViewUpdatePopover({ onClose, portal = false }: { onClose: () => void; portal?: boolean }) {
  const popover = <MezfitPopover opened role="dialog" aria-modal="true" aria-label={UPDATE_MESSAGE}
    viewportTop={Math.round(window.innerHeight * 0.3)} onBackdropClick={onClose}>
    <div className="flex flex-col gap-4 p-4">
      <Text variant="body">{UPDATE_MESSAGE}</Text>
      <Button rounded onClick={() => {
        openExternalLink(WEBVIEW_STORE_URL);
        onClose();
      }}><Text variant="body">Обновить</Text></Button>
    </div>
  </MezfitPopover>;

  return portal
    ? createPortal(<div className="navigation-overlay-root k-ios dark safe-areas">{popover}</div>, document.body)
    : popover;
}
