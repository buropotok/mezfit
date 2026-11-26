/* Connectivity hints only. This is NOT authentication or an HTTP health check. */
export const MEZFIT_URL = 'https://mezfit.online/';
export const TELEGRAM_SDK_URL = 'https://oauth.telegram.org/js/telegram-login.js?6';

/**
 * A browser-side, credentialless cross-origin GET. An opaque response proves
 * only that the network request completed, not that the service returned 200,
 * that JavaScript would execute or that login would succeed.
 */
export async function probeNetwork(url, fetchImpl = fetch, timeoutMs = 6500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      mode: 'no-cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
    });
    return response.type === 'opaque' || response.type === 'opaqueredirect' || response.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function connectionAdvice(site, telegram) {
  if (site === 'down') {
    return {
      title: 'Не удаётся подключиться к Mezfit',
      description: 'Если у вас включён VPN, попробуйте отключить его или сменить сервер VPN. Затем проверьте соединение ещё раз.',
    };
  }
  if (site === 'up' && telegram === 'down') {
    return {
      title: 'Telegram может быть недоступен',
      description: 'Сайт открывается, но сервер входа Telegram не ответил на проверку. Попробуйте другое подключение или повторите проверку.',
    };
  }
  return null;
}

const statusText = {
  checking: 'Проверяем соединение…',
  up: 'Соединение установлено',
  down: 'Не удалось установить соединение',
};

export function initializeAccessPage(doc = document, fetchImpl = fetch) {
  const siteItem = doc.getElementById('site-item');
  const telegramItem = doc.getElementById('telegram-item');
  const siteStatus = doc.getElementById('site-status');
  const telegramStatus = doc.getElementById('telegram-status');
  const telegramLink = doc.getElementById('telegram-login');
  const notice = doc.getElementById('notice');
  const noticeTitle = doc.getElementById('notice-title');
  const noticeDescription = doc.getElementById('notice-description');
  const openLink = doc.getElementById('open-mezfit');
  const retryButton = doc.getElementById('retry');

  let site = 'checking';
  let telegram = 'checking';
  let runId = 0;
  let lastCheckedAt = 0;

  function render() {
    siteItem.dataset.state = site;
    telegramItem.dataset.state = telegram;
    siteStatus.textContent = statusText[site];
    telegramStatus.textContent = statusText[telegram];

    const advice = connectionAdvice(site, telegram);
    notice.hidden = !advice;
    if (advice) {
      noticeTitle.textContent = advice.title;
      noticeDescription.textContent = advice.description;
    }

    const siteAvailable = site === 'up';
    telegramLink.hidden = !siteAvailable || telegram !== 'up';
    openLink.textContent = siteAvailable ? 'Открыть Mezfit ↗' : 'Попробовать открыть Mezfit ↗';
    openLink.classList.toggle('action-primary', siteAvailable);
    openLink.classList.toggle('action-secondary', !siteAvailable);
    retryButton.disabled = site === 'checking' || telegram === 'checking';
  }

  async function check() {
    const current = ++runId;
    site = 'checking';
    telegram = 'checking';
    render();
    const tasks = [
      probeNetwork(MEZFIT_URL, fetchImpl).then(ok => {
        if (current !== runId) return;
        site = ok ? 'up' : 'down';
        render();
      }),
      probeNetwork(TELEGRAM_SDK_URL, fetchImpl).then(ok => {
        if (current !== runId) return;
        telegram = ok ? 'up' : 'down';
        render();
      }),
    ];
    await Promise.all(tasks);
    if (current === runId) lastCheckedAt = Date.now();
  }

  retryButton.addEventListener('click', () => { void check(); });

  // Returning from a VPN switch may restore network access without a reload.
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'visible' && Date.now() - lastCheckedAt > 30_000) {
      void check();
    }
  });

  void check();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initializeAccessPage(), { once: true });
  } else {
    initializeAccessPage();
  }
}
