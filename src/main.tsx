import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadGlobalTheme } from './theme';
import './style.css';
import './exercise.css';
import './coach.css';
import './shell.css';
import './navigation.css';
import './theme.css';

function resolveRoot(): HTMLElement {
  const element = document.getElementById('root');
  if (!element) throw new Error('Root element not found');
  return element;
}

const root = resolveRoot();

async function bootstrap(): Promise<void> {
  await loadGlobalTheme();
  createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
