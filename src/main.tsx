import {
  formatStartupLogEntry,
  getStartupLogSnapshot,
  logStartup,
  subscribeStartupLog,
  trackStartupStep,
} from './startupDiagnostics';
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

function renderBootstrapSplash(root: HTMLElement): () => void {
  root.innerHTML = '<main class="center"><div><p>Подключаем Mezfit…</p><div data-startup-log aria-live="polite" aria-label="Логи запуска"></div></div></main>';
  const logContainer = root.querySelector<HTMLElement>('[data-startup-log]');
  if (!logContainer) throw new Error('Startup log container not found');

  const renderLog = () => {
    const fragment = document.createDocumentFragment();
    getStartupLogSnapshot().forEach((entry) => {
      const line = document.createElement('p');
      line.className = 'inline-message';
      line.textContent = formatStartupLogEntry(entry);
      fragment.append(line);
    });
    logContainer.replaceChildren(fragment);
  };

  renderLog();
  return subscribeStartupLog(renderLog);
}

function signalTelegramReady(): void {
  const webApp = window.Telegram?.WebApp;
  if (!webApp) {
    logStartup('Telegram WebApp: API не найден', 'error');
    return;
  }

  try {
    webApp.ready();
    logStartup('Telegram WebApp: ready', 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logStartup(`Telegram WebApp: ошибка — ${message}`, 'error');
  }
}

const root = resolveRoot();

async function bootstrap(): Promise<void> {
  logStartup('Загрузчик: запущен', 'success');
  const stopBootstrapLog = renderBootstrapSplash(root);
  signalTelegramReady();

  const reactPromise = trackStartupStep('Модуль React', () => import('react'));
  const reactDomPromise = trackStartupStep('Модуль React DOM', () => import('react-dom/client'));
  const themePromise = trackStartupStep('Модуль темы', () => import('./theme'));
  const isUiKit = window.location.pathname === '/ui-kit';
  const screenPromise = isUiKit
    ? trackStartupStep('Модуль UI Kit', () => import('./ui/UiKitPage')).then((module) => module.UiKitPage)
    : trackStartupStep('Модуль приложения', () => import('./App')).then((module) => module.App);

  const dependencyPromises = isUiKit
    ? []
    : [
        trackStartupStep('Модуль API', () => import('./api')),
        trackStartupStep('Модуль Telegram', () => import('./telegram')),
        trackStartupStep('Модуль навигации', () => import('./NavigationShell')),
        trackStartupStep('Модуль тренера', () => import('./coach/CoachShell')),
        trackStartupStep('UI-модуль', () => import('./ui')),
      ];

  const [React, reactDom, theme, Screen] = await Promise.all([
    reactPromise,
    reactDomPromise,
    themePromise,
    screenPromise,
    ...dependencyPromises,
  ]);

  await trackStartupStep('Настройки темы', () => theme.loadGlobalTheme());
  logStartup('React: запуск интерфейса');
  stopBootstrapLog();
  reactDom.createRoot(root).render(
    React.createElement(
      React.StrictMode,
      null,
      React.createElement(Screen),
    ),
  );
}

void bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logStartup(`Загрузка приложения остановлена — ${message}`, 'error');
});
