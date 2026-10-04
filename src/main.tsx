import { KonstaProvider } from 'konsta/react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadGlobalTheme } from './theme';
import { applyTypographySettings, loadBrowserTypographySettings } from './typographySettings';
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

async function bootstrap(): Promise<void> {
  applyTypographySettings(loadBrowserTypographySettings());
  await loadGlobalTheme();
  root.classList.add('k-ios', 'dark', 'safe-areas');
  let content = <App />;
  const isFullscreenDayScheduleUiKit = (
    window.location.pathname === '/ui-kit-day-schedule.html'
    || window.location.pathname === '/ui-kit-day-schedule'
  );
  if (isFullscreenDayScheduleUiKit) {
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
        {content}
      </KonstaProvider>
    </React.StrictMode>,
  );
}

void bootstrap();
