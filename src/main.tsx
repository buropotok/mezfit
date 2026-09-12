import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadGlobalTheme } from './theme';
import { UiKitPage } from './ui/UiKitPage';
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
  const content = window.location.pathname === '/ui-kit' ? <UiKitPage /> : <App />;
  createRoot(root).render(
    <React.StrictMode>
      {content}
    </React.StrictMode>,
  );
}

void bootstrap();
