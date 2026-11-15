import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const OPTIONAL_KEYS = [
  'DEXIE_CLOUD_CLIENT_ID',
  'DEXIE_CLOUD_CLIENT_SECRET',
  'DEXIE_CLOUD_MEMBERSHIP_CLIENT_ID',
  'DEXIE_CLOUD_MEMBERSHIP_CLIENT_SECRET',
  'DEXIE_CLOUD_REMINDER_CLIENT_ID',
  'DEXIE_CLOUD_REMINDER_CLIENT_SECRET',
  'DEXIE_DISCUSSION_WEBHOOK_SECRET',
  'R2_MEDIA_TELEGRAM_ALLOWLIST',
];

export function collectWorkerSecrets(env, generated = {}) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN_REPOSITORY_SECRET_REQUIRED');
  const secrets = { TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN };
  for (const key of OPTIONAL_KEYS) {
    if (env[key]) secrets[key] = env[key];
  }
  const names = ['R2_ACCOUNT_ID', 'R2_MEDIA_ACCESS_KEY_ID', 'R2_MEDIA_SECRET_ACCESS_KEY'];
  if (Object.keys(generated).length > 0) {
    if (names.some(key => typeof generated[key] !== 'string' || !generated[key])) {
      throw new Error('GENERATED_R2_CREDENTIALS_INCOMPLETE');
    }
    for (const key of names) secrets[key] = generated[key];
  }
  return secrets;
}

async function main() {
  let generated = {};
  const path = process.env.R2_CREDENTIALS_FILE;
  if (path) {
    try { generated = JSON.parse(await readFile(path, 'utf8')); }
    catch (error) {
      if (error?.code !== 'ENOENT') throw new Error('GENERATED_R2_CREDENTIAL_FILE_INVALID');
    }
  }
  const destination = process.env.WORKER_SECRETS_FILE;
  if (!destination) throw new Error('WORKER_SECRETS_FILE_REQUIRED');
  const secrets = collectWorkerSecrets(process.env, generated);
  await writeFile(destination, JSON.stringify(secrets), { flag: 'wx', mode: 0o600 });
  console.log('Worker secrets prepared securely (' + Object.keys(secrets).length + ' keys).');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : 'WORKER_SECRETS_PREPARATION_FAILED');
    process.exitCode = 1;
  });
}
