import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectionAdvice, initializeAccessPage, probeNetwork, MEZFIT_URL, TELEGRAM_SDK_URL } from './access.js';

test('only approved HTTPS endpoints are checked', () => {
  assert.equal(MEZFIT_URL, 'https://mezfit.online/');
  assert.equal(TELEGRAM_SDK_URL, 'https://oauth.telegram.org/js/telegram-login.js?6');
});

test('no warning for two reachable services', () => {
  assert.equal(connectionAdvice('up', 'up'), null);
});

test('a blocked Mezfit site suggests VPN change regardless of Telegram', () => {
  for (const telegram of ['up', 'down', 'checking']) {
    const advice = connectionAdvice('down', telegram);
    assert.match(advice.title, /Mezfit/);
    assert.match(advice.description, /VPN/);
  }
});

test('Telegram warning is shown only after site reachability', () => {
  assert.equal(connectionAdvice('checking', 'down'), null);
  assert.equal(connectionAdvice('up', 'checking'), null);
  assert.match(connectionAdvice('up', 'down').title, /Telegram/);
});

test('opaque cross-origin response counts as network reachability without inspecting body', async () => {
  let observed;
  const fetchImpl = async (url, options) => {
    observed = { url, options };
    return { type: 'opaque', ok: false };
  };
  assert.equal(await probeNetwork(TELEGRAM_SDK_URL, fetchImpl, 1000), true);
  assert.equal(observed.url, TELEGRAM_SDK_URL);
  assert.equal(observed.options.method, 'GET');
  assert.equal(observed.options.mode, 'no-cors');
  assert.equal(observed.options.credentials, 'omit');
  assert.equal(observed.options.cache, 'no-store');
});

test('a visible unsuccessful HTTP response is not treated as success', async () => {
  assert.equal(await probeNetwork(MEZFIT_URL, async () => ({ type: 'basic', ok: false }), 1000), false);
});

test('network error is nonfatal and returns unavailable', async () => {
  assert.equal(await probeNetwork(MEZFIT_URL, async () => {
    throw new TypeError('Failed to fetch');
  }, 1000), false);
});

test('hung network request is aborted at the timeout', async () => {
  let aborted = false;
  const fetchImpl = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      aborted = true;
      reject(new Error('Aborted'));
    }, { once: true });
  });
  assert.equal(await probeNetwork(MEZFIT_URL, fetchImpl, 10), false);
  assert.equal(aborted, true);
});

test('browser UI shows Telegram option only when both paths are reachable', async () => {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        hidden: false,
        textContent: '',
        disabled: false,
        dataset: {},
        listeners: {},
        classList: { toggle() {} },
        addEventListener(name, callback) { this.listeners[name] = callback; },
      });
    }
    return elements.get(id);
  }
  const doc = {
    visibilityState: 'visible',
    getElementById: element,
    addEventListener() {},
  };
  let siteWorks = true;
  let telegramWorks = true;
  const fakeFetch = async url => {
    if (url === MEZFIT_URL && !siteWorks) throw new Error('blocked site');
    if (url === TELEGRAM_SDK_URL && !telegramWorks) throw new Error('blocked sdk');
    return { type: 'opaque' };
  };
  const tick = () => new Promise(resolve => setImmediate(resolve));
  initializeAccessPage(doc, fakeFetch);
  await tick();
  assert.equal(element('site-item').dataset.state, 'up');
  assert.equal(element('telegram-item').dataset.state, 'up');
  assert.equal(element('telegram-login').hidden, false);
  assert.equal(element('notice').hidden, true);

  telegramWorks = false;
  element('retry').listeners.click();
  await tick();
  assert.equal(element('site-item').dataset.state, 'up');
  assert.equal(element('telegram-item').dataset.state, 'down');
  assert.equal(element('telegram-login').hidden, true);
  assert.match(element('notice-title').textContent, /Telegram/);

  siteWorks = false;
  telegramWorks = true;
  element('retry').listeners.click();
  await tick();
  assert.equal(element('site-item').dataset.state, 'down');
  assert.equal(element('telegram-login').hidden, true);
  assert.match(element('notice-description').textContent, /VPN/);
  assert.match(element('open-mezfit').textContent, /Попробовать открыть Mezfit/);
});

test('page links only to the intended app and does not collect passwords', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  assert.match(html, /href="https:\/\/mezfit\.online\/"/);
  assert.match(html, /id="retry"/);
  assert.match(html, /id="telegram-login"/);
  assert.doesNotMatch(html, /type="password"/);
  assert.doesNotMatch(html, /googleapis|gtag|analytics|fetch\(/);
});
