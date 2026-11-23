interface TelegramLoginOptions {
  client_id: number;
  scope: ['profile'];
  nonce: string;
  lang: 'ru';
}

export interface TelegramLoginSdk {
  auth(options: TelegramLoginOptions, callback: (payload: unknown) => void): void;
}

const sdkUrl = 'https://oauth.telegram.org/js/telegram-login.js?6';
let pendingSdk: Promise<TelegramLoginSdk> | undefined;

function currentSdk(): TelegramLoginSdk | undefined {
  const telegram = (window as Window & { Telegram?: { Login?: TelegramLoginSdk } }).Telegram;
  return typeof telegram?.Login?.auth === 'function' ? telegram.Login : undefined;
}

export function loadTelegramLoginSdk(): Promise<TelegramLoginSdk> {
  const existing = currentSdk();
  if (existing) return Promise.resolve(existing);
  pendingSdk ??= new Promise<TelegramLoginSdk>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = sdkUrl;
    script.async = true;
    const timeout = window.setTimeout(unavailable, 8000);
    function unavailable() {
      script.remove();
      reject(new Error('Telegram Login недоступен'));
    }
    script.addEventListener('load', () => {
      window.clearTimeout(timeout);
      const sdk = currentSdk();
      if (sdk) resolve(sdk);
      else unavailable();
    }, { once: true });
    script.addEventListener('error', () => {
      window.clearTimeout(timeout);
      unavailable();
    }, { once: true });
    document.head.append(script);
  }).finally(() => { pendingSdk = undefined; });
  return pendingSdk;
}
