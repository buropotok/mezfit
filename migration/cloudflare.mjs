import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const BUCKET = 'mezfit-migration-uploads';
const QUEUE = 'mezfit-migration-events';
const DATABASE = 'mezfit-migration-jobs';
const WORKER = 'mezfit-migration';
const WORKFLOW = 'mezfit-migration-workflow';
const TOKEN = 'mezfit-migration-uploads-uploader';
const OWNER = 'mezfit-migration-v1';
const SECRET_NAMES = ['MIGRATION_R2_ACCESS_KEY_ID', 'MIGRATION_R2_SECRET_ACCESS_KEY'];
const R2_WRITE = 'Workers R2 Storage Bucket Item Write';
const R2_SCOPE = 'com.cloudflare.edge.r2.bucket';
const UUID = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const ID = /^[a-f0-9]{32}$/;
const CONSUMER_SETTINGS = { batch_size: 10, max_wait_time_ms: 5000, max_retries: 5, retry_delay: 10 };
const WORKER_PATH = '/workers/scripts/' + WORKER;
const BUCKET_PATH = '/r2/buckets/' + BUCKET;
const NOTIFICATIONS = '/event_notifications/r2/' + BUCKET + '/configuration';
const RULE = {
  actions: ['PutObject', 'CopyObject', 'CompleteMultipartUpload'],
  description: 'Register migration backup uploads',
};

function requireState(condition, code) {
  if (!condition) throw new Error(code);
}

class CloudflareApi {
  constructor(account, token, label) {
    requireState(ID.test(account), 'CLOUDFLARE_ACCOUNT_ID_INVALID');
    requireState(token, label + '_SECRET_REQUIRED');
    this.base = 'https://api.cloudflare.com/client/v4/accounts/' + account;
    this.token = token;
    this.label = label;
  }

  async request(path, { method = 'GET', body, optional = false } = {}) {
    const response = await fetch(this.base + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: 'Bearer ' + this.token,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }).catch(() => null);
    const operation = this.label + ' ' + method + ' ' + path.split('?')[0];
    requireState(response, operation + ' request failed');
    if (optional && response.status === 404) return null;
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.success !== true || !Object.hasOwn(data, 'result')) {
      const codes = Array.isArray(data?.errors) ? data.errors.map(error => error?.code).filter(Number.isInteger) : [];
      const access = [401, 403].includes(response.status) ? ' (check this token’s access to the named Cloudflare API)' : '';
      throw new Error(operation + ' failed with HTTP ' + response.status + ' (Cloudflare codes: '
        + (codes.join(', ') || 'none') + ')' + access);
    }
    return data;
  }

  async get(path, optional = false) {
    return (await this.request(path, { optional }))?.result ?? null;
  }

  async pages(path) {
    const results = [];
    const size = 50;
    for (let page = 1; page <= 100; page++) {
      const response = await this.request(path + '?per_page=' + size + '&page=' + page);
      requireState(Array.isArray(response.result), 'INVALID_LIST_RESPONSE ' + path);
      results.push(...response.result);
      const { total_pages, total_count } = response.result_info ?? {};
      if (Number.isInteger(total_pages) ? page >= total_pages
        : Number.isInteger(total_count) ? results.length >= total_count
          : response.result.length < size) return results;
    }
    throw new Error('PAGINATION_LIMIT ' + path);
  }
}

function unique(entries, field, name) {
  const matches = entries.filter(entry => entry[field] === name);
  requireState(matches.length < 2, 'DUPLICATE_RESOURCE ' + name);
  return matches[0] ?? null;
}

function appOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('MEZFIT_APP_ORIGIN_INVALID');
  }
  requireState(url.protocol === 'https:' && (value === url.origin || value === url.origin + '/'),
    'MEZFIT_APP_ORIGIN_MUST_BE_EXACT_HTTPS_ORIGIN');
  return url.origin;
}

function desiredCors(origin) {
  return { rules: [{
    id: 'mezfit-migration-direct-upload',
    allowed: { origins: [origin], methods: ['PUT'], headers: ['Content-Type', 'If-None-Match'] },
    maxAgeSeconds: 3600,
  }] };
}

function sorted(values) { return Array.isArray(values) ? [...values].sort().join(',') : ''; }

function matchesCors(rules, origin) {
  const [rule] = rules;
  return rules.length === 1 && rule.id === 'mezfit-migration-direct-upload'
    && sorted(rule.allowed?.origins) === origin && sorted(rule.allowed?.methods) === 'PUT'
    && sorted(rule.allowed?.headers?.map(value => value.toLowerCase())) === 'content-type,if-none-match'
    && !rule.exposeHeaders?.length && rule.maxAgeSeconds === 3600;
}

async function inspectBucket(api, queue, origin) {
  const bucket = await api.get(BUCKET_PATH, true);
  if (!bucket) return { bucket: false, cors: 'missing', notifications: 'missing', private: true };
  requireState(bucket.name === BUCKET && (!bucket.jurisdiction || bucket.jurisdiction === 'default'),
    'MIGRATION_BUCKET_SCOPE_CONFLICT');
  const [managed, custom, cors, notifications] = await Promise.all([
    api.get(BUCKET_PATH + '/domains/managed'),
    api.get(BUCKET_PATH + '/domains/custom'),
    api.get(BUCKET_PATH + '/cors', true),
    api.get(NOTIFICATIONS),
  ]);
  requireState(typeof managed?.enabled === 'boolean' && Array.isArray(custom?.domains)
    && (!cors || Array.isArray(cors.rules)) && notifications?.bucketName === BUCKET
    && (notifications.queues === undefined || Array.isArray(notifications.queues)),
  'MIGRATION_BUCKET_SETTINGS_RESPONSE_INVALID');
  const rules = cors?.rules ?? [];
  const linked = notifications.queues ?? [];
  const [target] = linked;
  const [rule] = target?.rules ?? [];
  const matches = linked.length === 1 && target.queueId === queue?.queue_id
    && target.rules?.length === 1 && !rule.prefix && !rule.suffix
    && sorted(rule.actions) === sorted(RULE.actions);
  return {
    bucket: true,
    cors: !rules.length ? 'missing' : matchesCors(rules, origin) ? 'current' : 'conflict',
    notifications: !linked.length ? 'missing' : matches ? 'current' : 'conflict',
    private: !managed.enabled && !custom.domains.length,
  };
}

async function inspectWorker(api) {
  const settings = await api.get(WORKER_PATH + '/settings', true);
  if (!settings) return { exists: false, owned: true, private: true, secrets: [] };
  const [secrets, subdomain] = await Promise.all([
    api.get(WORKER_PATH + '/secrets'), api.get(WORKER_PATH + '/subdomain'),
  ]);
  requireState(Array.isArray(settings.bindings) && Array.isArray(secrets)
    && typeof subdomain?.enabled === 'boolean' && typeof subdomain?.previews_enabled === 'boolean',
  'MIGRATION_WORKER_SETTINGS_RESPONSE_INVALID');
  return {
    exists: true,
    owned: settings.bindings.some(binding => binding.name === 'MIGRATION_INFRA_OWNER'
      && binding.type === 'plain_text' && binding.text === OWNER),
    private: !subdomain.enabled && !subdomain.previews_enabled,
    secrets: secrets.filter(secret => secret.type === 'secret_text').map(secret => secret.name),
  };
}

async function inspectQueue(api) {
  const queue = unique(await api.pages('/queues'), 'queue_name', QUEUE);
  if (!queue) return null;
  requireState(ID.test(queue.queue_id), 'MIGRATION_QUEUE_ID_INVALID');
  const details = await api.get('/queues/' + queue.queue_id);
  requireState(details?.queue_name === QUEUE && details.queue_id === queue.queue_id, 'MIGRATION_QUEUE_READBACK_INVALID');
  return details;
}

function queueConflict(queue) {
  if (!queue) return false;
  return queue.settings?.delivery_paused === true
    || (queue.settings?.delivery_delay ?? 0) !== 0
    || (queue.consumers ?? []).some(consumer => consumer.type !== 'worker' || consumer.script_name !== WORKER
      || Boolean(consumer.dead_letter_queue) || consumer.settings?.max_concurrency != null
      || Object.entries(CONSUMER_SETTINGS).some(([key, value]) => consumer.settings?.[key] !== value))
    || (queue.producers ?? []).some(producer => !(
      producer.type === 'worker' && producer.script === WORKER
      || producer.type === 'r2_bucket' && producer.bucket_name === BUCKET
    ));
}

async function writeGroup(api) {
  const groups = await api.get('/tokens/permission_groups?name=' + encodeURIComponent(R2_WRITE)
    + '&scope=' + encodeURIComponent(R2_SCOPE));
  requireState(Array.isArray(groups), 'R2_PERMISSION_GROUPS_RESPONSE_INVALID');
  const group = unique(groups, 'name', R2_WRITE);
  requireState(ID.test(group?.id) && group.scopes?.includes(R2_SCOPE), 'R2_BUCKET_ITEM_WRITE_PERMISSION_GROUP_MISSING');
  return group;
}

function tokenPolicy(account, group) {
  return {
    effect: 'allow',
    resources: { [R2_SCOPE + '.' + account + '_default_' + BUCKET]: '*' },
    permission_groups: [{ id: group.id, name: R2_WRITE }],
  };
}

function sameTokenPolicy(token, desired) {
  const [policy] = token.policies ?? [];
  return token.status === 'active' && token.policies?.length === 1 && policy.effect === desired.effect
    && Object.keys(policy.resources ?? {}).length === 1
    && policy.resources[Object.keys(desired.resources)[0]] === '*'
    && policy.permission_groups?.length === 1 && policy.permission_groups[0].id === desired.permission_groups[0].id
    && !Object.keys(policy.condition ?? {}).length && !Object.keys(token.condition ?? {}).length
    && !token.expires_on && !token.not_before;
}

async function inspect(infra, deploy, account, origin) {
  const [databases, queue, tokens, worker, workflow, group] = await Promise.all([
    infra.pages('/d1/database'), inspectQueue(infra), infra.pages('/tokens'), inspectWorker(deploy),
    deploy.get('/workflows/' + WORKFLOW, true), writeGroup(infra),
  ]);
  const database = unique(databases, 'name', DATABASE);
  if (database) requireState(UUID.test(database.uuid), 'MIGRATION_D1_ID_INVALID');
  const listedToken = unique(tokens, 'name', TOKEN);
  if (listedToken) requireState(ID.test(listedToken.id), 'MIGRATION_R2_TOKEN_ID_INVALID');
  const [bucket, token] = await Promise.all([
    inspectBucket(infra, queue, origin), listedToken ? infra.get('/tokens/' + listedToken.id) : null,
  ]);
  const policy = tokenPolicy(account, group);
  const secretsReady = SECRET_NAMES.every(name => worker.secrets.includes(name));
  const secretsPartial = SECRET_NAMES.some(name => worker.secrets.includes(name));
  const conflicts = [
    ...(!bucket.private ? ['R2_BUCKET_IS_PUBLIC'] : []),
    ...(bucket.cors === 'conflict' ? ['R2_CORS_CONFLICT'] : []),
    ...(bucket.notifications === 'conflict' ? ['R2_EVENT_NOTIFICATIONS_CONFLICT'] : []),
    ...(queueConflict(queue) ? ['QUEUE_CONFIGURATION_CONFLICT'] : []),
    ...(!worker.owned || !worker.private ? ['WORKER_OWNERSHIP_OR_PUBLIC_URL_CONFLICT'] : []),
    ...(workflow && (workflow.script_name !== WORKER || workflow.class_name !== 'MigrationWorkflow')
      ? ['WORKFLOW_OWNERSHIP_CONFLICT'] : []),
    ...(token && !sameTokenPolicy(token, policy) ? ['R2_TOKEN_POLICY_CONFLICT'] : []),
    ...(token && !secretsReady ? ['R2_CREDENTIALS_LOST_OR_PARTIAL: matching token exists but Worker secrets are missing; review and explicitly revoke only the migration uploader before rerunning apply'] : []),
    ...(!token && secretsPartial ? ['R2_WORKER_SECRETS_WITHOUT_MATCHING_TOKEN'] : []),
    ...(!token && worker.exists && !secretsPartial ? ['EXISTING_WORKER_WITHOUT_MIGRATION_TOKEN_REQUIRES_REVIEW'] : []),
  ];
  return { database, queue, bucket, token, worker, workflow, secretsReady, policy, conflicts };
}

async function report(operation, state) {
  const lines = [
    '## Mezfit migration infrastructure (' + operation + ')',
    '- D1: ' + (state.database ? 'present' : 'create'),
    '- Queue: ' + (state.queue ? 'present' : 'create'),
    '- R2: ' + (state.bucket.bucket ? 'present' : 'create private bucket'),
    '- R2 CORS: ' + state.bucket.cors,
    '- R2 notification: ' + state.bucket.notifications,
    '- Worker: ' + (state.worker.exists ? 'present' : 'create private Worker with uploader secrets'),
    '- Workflow: ' + (state.workflow ? 'present' : 'create during deploy'),
    '- R2 uploader: ' + (state.token ? 'present' : 'create'),
    '- Worker uploader secrets: ' + (state.secretsReady ? 'present' : 'missing'),
    ...state.conflicts.map(issue => '- Conflict: ' + issue),
  ];
  const summary = lines.join('\n') + '\n';
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
}

function runWrangler(args, hideOutput = false) {
  const binary = fileURLToPath(new URL('../node_modules/.bin/wrangler', import.meta.url));
  const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
  delete env.CLOUDFLARE_BOOTSTRAP_API_TOKEN;
  const result = spawnSync(binary, args, { env, stdio: hideOutput ? 'pipe' : 'inherit', encoding: 'utf8' });
  if (result.status === 0) return;
  if (hideOutput) {
    // Print numeric API codes only. Wrangler output can include submitted bindings.
    const codes = [...(result.stderr ?? '').matchAll(/\[code: (\d+)\]/g)].map(match => match[1]);
    throw new Error('PRIVATE_WORKER_SECRET_DEPLOY_FAILED using CLOUDFLARE_API_TOKEN'
      + ' (Workers Scripts Edit; Cloudflare codes: ' + (codes.join(', ') || 'none') + ')');
  }
  throw new Error('WRANGLER_FAILED ' + args.slice(0, 3).join(' '));
}

async function withConfig(account, databaseId, action, secretValues) {
  const path = fileURLToPath(new URL('./wrangler.json', import.meta.url));
  const config = JSON.parse(await readFile(path, 'utf8'));
  config.vars.CLOUDFLARE_ACCOUNT_ID = account;
  if (databaseId) {
    config.d1_databases[0].database_id = databaseId;
  } else {
    // The initial deployment publishes secrets. The independent deploy enables processing.
    delete config.d1_databases;
    delete config.r2_buckets;
    delete config.queues;
    delete config.workflows;
  }
  const configFile = fileURLToPath(new URL('./.wrangler.' + randomUUID() + '.json', import.meta.url));
  const temp = secretValues ? await mkdtemp(join(tmpdir(), 'mezfit-migration-')) : null;
  try {
    await writeFile(configFile, JSON.stringify(config), { flag: 'wx' });
    const secretFile = temp ? join(temp, 'secrets.json') : null;
    if (secretFile) await writeFile(secretFile, JSON.stringify(secretValues), { mode: 0o600, flag: 'wx' });
    await action(configFile, secretFile);
  } finally {
    await rm(configFile, { force: true });
    if (temp) await rm(temp, { recursive: true, force: true });
  }
}

async function apply(infra, deploy, state, account, origin) {
  const { database, queue, bucket, token, policy } = state;
  if (!database) await infra.request('/d1/database', { method: 'POST', body: { name: DATABASE } });
  if (!bucket.bucket) await infra.request('/r2/buckets', { method: 'POST', body: { name: BUCKET } });
  const target = queue ?? (await infra.request('/queues', { method: 'POST', body: { queue_name: QUEUE } })).result;
  requireState(ID.test(target?.queue_id), 'MIGRATION_QUEUE_CREATE_RESPONSE_INVALID');
  const current = await inspectBucket(infra, target, origin);
  requireState(current.bucket && current.private && current.cors !== 'conflict' && current.notifications !== 'conflict',
    'MIGRATION_BUCKET_CHANGED_DURING_APPLY');
  if (current.cors === 'missing') {
    await infra.request(BUCKET_PATH + '/cors', { method: 'PUT', body: desiredCors(origin) });
  }
  if (current.notifications === 'missing') {
    await infra.request(NOTIFICATIONS + '/queues/' + target.queue_id, { method: 'PUT', body: { rules: [RULE] } });
  }
  if (!token) {
    const preflight = await inspectWorker(deploy);
    requireState(preflight.owned && preflight.private && !preflight.exists,
      'EXISTING_WORKER_WITHOUT_MIGRATION_TOKEN_REQUIRES_REVIEW');
    const minted = (await infra.request('/tokens', {
      method: 'POST', body: { name: TOKEN, policies: [policy] },
    })).result;
    requireState(ID.test(minted?.id) && typeof minted.value === 'string' && minted.value.length,
      'R2_TOKEN_CREATED_WITHOUT_USABLE_CREDENTIALS');
    const secretValues = {
      [SECRET_NAMES[0]]: minted.id,
      [SECRET_NAMES[1]]: createHash('sha256').update(minted.value).digest('hex'),
    };
    await withConfig(account, null, (configFile, secretFile) =>
      runWrangler(['deploy', '--config', configFile, '--secrets-file', secretFile], true), secretValues);
  }
}

function requireProvisioned(state) {
  requireState(state.database && state.queue && state.bucket.bucket && state.bucket.cors === 'current'
    && state.bucket.notifications === 'current' && state.token && state.secretsReady,
  'MIGRATION_BOOTSTRAP_INCOMPLETE: run migration-bootstrap apply');
}

async function smoke(api) {
  const id = randomUUID();
  const path = '/workflows/' + WORKFLOW + '/instances';
  await api.request(path, { method: 'POST', body: { instance_id: id, params: JSON.stringify({ operation: 'smoke' }) } });
  for (let attempt = 0; attempt < 65; attempt++) {
    const result = await api.get(path + '/' + id);
    if (result?.status === 'complete') {
      requireState(result.output === 'MIGRATION_SMOKE_OK' || result.output === '"MIGRATION_SMOKE_OK"',
        'MIGRATION_SMOKE_OUTPUT_INVALID ' + id);
      console.log('Migration smoke passed: signed PUT, R2 privacy, Queue delivery, D1 registration and replay.');
      return;
    }
    if (['errored', 'terminated', 'paused'].includes(result?.status)) {
      const code = String(result?.error?.message).match(/^SMOKE_[A-Z_]+$/)?.[0];
      throw new Error('MIGRATION_SMOKE_' + result.status.toUpperCase() + ' ' + id + (code ? ' ' + code : ''));
    }
    await delay(5000);
  }
  throw new Error('MIGRATION_SMOKE_TIMEOUT ' + id);
}

async function main() {
  const operation = process.env.MIGRATION_OPERATION ?? 'preview';
  requireState(['preview', 'apply', 'deploy'].includes(operation), 'MIGRATION_OPERATION_INVALID');
  if (operation === 'apply') requireState(process.env.MIGRATION_CONFIRMATION === 'APPLY_MEZFIT_MIGRATION_INFRASTRUCTURE',
    'MIGRATION_APPLY_CONFIRMATION_REQUIRED');
  const account = (process.env.CLOUDFLARE_ACCOUNT_ID ?? '').toLowerCase();
  const origin = appOrigin(process.env.MEZFIT_APP_ORIGIN);
  const infra = new CloudflareApi(account, process.env.CLOUDFLARE_BOOTSTRAP_API_TOKEN, 'CLOUDFLARE_BOOTSTRAP_API_TOKEN');
  const deploy = new CloudflareApi(account, process.env.CLOUDFLARE_API_TOKEN, 'CLOUDFLARE_API_TOKEN');
  const state = await inspect(infra, deploy, account, origin);
  await report(operation, state);
  if (operation === 'preview') return;
  requireState(!state.conflicts.length, 'MIGRATION_INFRASTRUCTURE_CONFLICT: see summary');
  if (operation === 'apply') await apply(infra, deploy, state, account, origin);
  if (operation === 'deploy') {
    requireProvisioned(state);
    await withConfig(account, state.database.uuid, configFile => {
      runWrangler(['d1', 'migrations', 'apply', 'JOBS', '--remote', '--config', configFile]);
      runWrangler(['deploy', '--config', configFile]);
    });
  }
  const after = await inspect(infra, deploy, account, origin);
  requireState(!after.conflicts.length, 'MIGRATION_INFRASTRUCTURE_READBACK_CONFLICT');
  requireProvisioned(after);
  if (operation === 'deploy') {
    requireState(after.workflow && after.queue.consumers?.some(consumer => consumer.script_name === WORKER),
      'MIGRATION_WORKFLOW_OR_CONSUMER_MISSING');
    await smoke(deploy);
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
