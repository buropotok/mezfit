import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadGlobalTheme } from './theme';
import './style.css';
import './exercise.css';
import './theme.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

async function bootstrap(): Promise<void> {
  await loadGlobalTheme();
  createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
