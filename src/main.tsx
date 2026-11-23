import { KonstaProvider } from 'konsta/react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startAppBootstrap } from './appBootstrap';
import { completePendingLocalDataReset } from './data/local/resetLocalData';
import { finishBoot } from './bootDiagnostics';
import { getTelegramLaunchStartParam, getTelegramWebApp } from './telegram';
import './ui/konsta.css';
import './style.css';
import './exercise.css';
import './exercise-catalog-fab.css';
import './global-exercise.css';
import './gym-keeper-exercise-parity.css';
import './exercise-media.css';
import './coach.css';
import './shell.css';
import './navigation.css';
import './theme.css';
import './ui/tokens/index.css';

function resolveRoot(): HTMLElement {
  const element = document.getElementById('root');
  if (!element) throw new Error('Root element not found');
  return element;
}

const root = resolveRoot();

function BootCompletion({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    finishBoot();
  }, []);
  return <>{children}</>;
}

async function bootstrap(): Promise<void> {
  root.classList.add('k-ios', 'dark', 'safe-areas');
  try {
    // No mounted React/Dexie instances can reopen the stores during deletion.
    await completePendingLocalDataReset();
  } catch {
    root.setAttribute('role', 'alert');
    root.textContent = 'Не удалось очистить локальные данные. Закройте другие окна Mezfit и откройте приложение заново.';
    return;
  }
  let content = <App />;
  const isFullscreenDayScheduleUiKit = (
    window.location.pathname === '/ui-kit-day-schedule.html'
    || window.location.pathname === '/ui-kit-day-schedule'
  );
  const webApp = getTelegramWebApp();
  if (webApp?.initData && getTelegramLaunchStartParam(webApp) === 'cloud_auth_check') {
    const { CloudAuthDiagnostic } = await import('./diagnostics/CloudAuthDiagnostic');
    content = <CloudAuthDiagnostic />;
  } else if (isFullscreenDayScheduleUiKit) {
    const { DayScheduleCatalog } = await import('./ui/DayScheduleCatalog');
    content = <DayScheduleCatalog fullScreen />;
  } else if (window.location.pathname === '/ui-kit') {
    const [{ UiKitPage }, { ThemeVariantsCatalog }, { LiquidGlassIconOnlyCatalog }, { LiquidGlassTextOnlyCatalog }, { DayScheduleCatalog }, { LiquidGlassTabsNoFabCatalog }] = await Promise.all([
      import('./ui/UiKitPage'), import('./ui/ThemeVariantsCatalog'), import('./ui/LiquidGlassIconOnlyCatalog'), import('./ui/LiquidGlassTextOnlyCatalog'), import('./ui/DayScheduleCatalog'), import('./ui/LiquidGlassTabsNoFabCatalog'),
    ]);
    content = <><UiKitPage /><ThemeVariantsCatalog /><LiquidGlassIconOnlyCatalog /><LiquidGlassTabsNoFabCatalog /><LiquidGlassTextOnlyCatalog /><DayScheduleCatalog /></>;
  }
  createRoot(root).render(
    <React.StrictMode>
      <KonstaProvider theme="ios" dark>
        <BootCompletion>{content}</BootCompletion>
      </KonstaProvider>
    </React.StrictMode>,
  );
}

// The HTML bootstrap resolves immediately in a regular browser. A real
// Telegram Mini App launch waits for its SDK before inspecting initData,
// preserving the existing signed-initData authentication path.
const telegramSdkReady = (window as Window & {
  __MEZFIT_TELEGRAM_SDK_READY__?: Promise<void>;
}).__MEZFIT_TELEGRAM_SDK_READY__;

void (async () => {
  try {
    await telegramSdkReady;
    await startAppBootstrap(bootstrap);
  } catch {
    // The inline boot diagnostics already report an SDK load failure.
    // Do not misclassify a failed Telegram launch as an unauthenticated browser.
  }
})();
