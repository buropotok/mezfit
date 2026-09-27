import { App as KonstaApp } from 'konsta/react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App as MezfitApp } from './App';
import { loadGlobalTheme } from './theme';
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
  await loadGlobalTheme();
  let content = <MezfitApp />;
  if (window.location.pathname === '/ui-kit') {
    const [{ UiKitPage }, { ThemeVariantsCatalog }, { LiquidGlassIconOnlyCatalog }] = await Promise.all([
      import('./ui/UiKitPage'), import('./ui/ThemeVariantsCatalog'), import('./ui/LiquidGlassIconOnlyCatalog'),
    ]);
    content = <><UiKitPage /><ThemeVariantsCatalog /><LiquidGlassIconOnlyCatalog /></>;
  }
  createRoot(root).render(
    <React.StrictMode>
      <KonstaApp theme="ios" dark safeAreas className="dark">
        {content}
      </KonstaApp>
    </React.StrictMode>,
  );
}

void bootstrap();
