import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
// The REST API expects milliseconds for the batch timeout and seconds for the retry delay.
const CONSUMER_SETTINGS = { batch_size: 10, max_wait_time_ms: 5 * 1000, max_retries: 5, retry_delay: 10 };
const CONSUMER_DEFAULTS = { batch_size: 10, max_wait_time_ms: 5000, max_retries: 3 };
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

function cloudflarePermission(path, method) {
  const access = method === 'GET' ? 'Read or Edit' : 'Edit';
  if (path.startsWith('/tokens')) return 'Account API Tokens: ' + access;
  if (path.startsWith('/d1/')) return 'D1: ' + access;
  if (path.startsWith('/r2/') || path.startsWith('/event_notifications/')) return 'Workers R2 Storage: ' + access;
  if (path.startsWith('/queues')) return method === 'GET' ? 'Queues: Read or Edit (or Workers Scripts)' : 'Queues: Edit';
  if (path.startsWith('/workers/') || path.startsWith('/workflows/')) return 'Workers Scripts: ' + access;
  return 'access to this account API';
}

export class CloudflareApi {
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
      // R2 returns this error before the bucket has any notification rules.
      if (method === 'GET' && path === NOTIFICATIONS && response.status === 404
        && data?.success === false && data.errors?.length === 1 && codes[0] === 11015) {
        return { success: true, result: { bucketName: BUCKET, queues: [] } };
      }
      const access = [401, 403].includes(response.status) || codes.includes(10000) || codes.includes(9109)
        ? ' (verify ' + cloudflarePermission(path, method) + ')' : '';
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

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function notificationQueueLinks(config) {
  if (config?.bucketName === BUCKET && (config.queues === undefined || Array.isArray(config.queues))) {
    return config.queues ?? [];
  }

  // Wrangler also reads the older bucket -> configuration ID -> { queue, rules } response.
  if (isRecord(config) && Object.keys(config).length === 1
    && Object.hasOwn(config, BUCKET) && isRecord(config[BUCKET])) {
    const links = Object.values(config[BUCKET]);
    if (links.length) return links.map(link => isRecord(link) ? { queueId: link.queue, rules: link.rules } : link);
  }

  throw new Error('MIGRATION_BUCKET_SETTINGS_RESPONSE_INVALID: R2 notification response');
}

function notificationQueueId(value) {
  if (typeof value !== 'string') return null;
  const id = value.toLowerCase();
  return ID.test(id) || UUID.test(id) ? id.replaceAll('-', '') : null;
}

function notificationDifferences(links, queue) {
  if (links.length !== 1) return ['queues.length (expected 1, got ' + links.length + ')'];
  const [target] = links;
  if (!isRecord(target)) return ['queues[0] (expected an object)'];

  // Keep diagnostics to field names and counts. API-provided strings may contain arbitrary text.
  const differences = [];
  const id = notificationQueueId(target.queueId);
  if (!id || id !== queue?.queue_id) differences.push('queueId (expected the migration queue ID)');
  if (target.queueName !== undefined && target.queueName !== QUEUE) {
    differences.push('queueName (expected the migration queue name)');
  }
  if (!Array.isArray(target.rules)) return [...differences, 'rules (expected an array)'];
  if (target.rules.length !== 1) {
    return [...differences, 'rules.length (expected 1, got ' + target.rules.length + ')'];
  }
  const [rule] = target.rules;
  if (!isRecord(rule)) return [...differences, 'rules[0] (expected an object)'];
  if (!Array.isArray(rule.actions) || rule.actions.length !== RULE.actions.length
    || !RULE.actions.every(action => rule.actions.includes(action))) {
    differences.push('actions (expected PutObject, CopyObject and CompleteMultipartUpload once each)');
  }
  if ((rule.prefix ?? '') !== '') differences.push('prefix (expected no filter)');
  if ((rule.suffix ?? '') !== '') differences.push('suffix (expected no filter)');
  return differences;
}

export async function inspectBucket(api, queue, origin) {
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
    && (!cors || Array.isArray(cors.rules)),
  'MIGRATION_BUCKET_SETTINGS_RESPONSE_INVALID');
  const rules = cors?.rules ?? [];
  const links = notificationQueueLinks(notifications);
  const differences = links.length ? notificationDifferences(links, queue) : [];
  return {
    bucket: true,
    cors: !rules.length ? 'missing' : matchesCors(rules, origin) ? 'current' : 'conflict',
    notifications: !links.length ? 'missing' : differences.length ? 'conflict' : 'current',
    ...(differences.length ? { notificationConflict: 'R2_EVENT_NOTIFICATIONS_CONFLICT: ' + differences.join(', ') } : {}),
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

function queueWorkerDifferences(binding, path) {
  // The REST schema uses script_name for a consumer. Wrangler's Queue
  // readback also supports script and service + environment references.
  const names = [binding.script_name, binding.script, binding.service].filter(name => name != null);
  const differences = [];
  if (!names.length || names.some(name => name !== WORKER)) {
    differences.push(path + '.script_name/script/service (expected the migration Worker)');
  }
  const environment = binding.environment;
  if ((binding.service != null || environment != null) && environment !== 'production') {
    differences.push(path + '.environment (expected production)');
  }
  if ((binding.namespace ?? '') !== '') differences.push(path + '.namespace (expected no namespace)');
  return differences;
}

function queueSettingDifference(path, expected, actual) {
  const value = actual == null ? 'unset' : Number.isSafeInteger(actual) ? String(actual) : 'invalid value';
  return path + ' (expected ' + expected + ', got ' + value + ')';
}

export function queueConfigurationDifferences(queue) {
  if (!queue) return [];
  const differences = [];
  if (queue.settings != null && !isRecord(queue.settings)) {
    differences.push('settings (expected an object)');
  }
  if ((queue.settings?.delivery_paused ?? false) !== false) {
    differences.push('settings.delivery_paused (expected false)');
  }
  const deliveryDelay = queue.settings?.delivery_delay ?? 0;
  if (deliveryDelay !== 0) differences.push(queueSettingDifference('settings.delivery_delay', 0, deliveryDelay));

  const consumers = queue.consumers ?? [];
  if (!Array.isArray(consumers)) {
    differences.push('consumers (expected an array)');
  } else if (consumers.length > 1) {
    differences.push('consumers.length (expected at most 1, got ' + consumers.length + ')');
  } else if (consumers.length) {
    const [consumer] = consumers;
    if (!isRecord(consumer)) {
      differences.push('consumers[0] (expected an object)');
    } else {
      if (consumer.type !== 'worker') differences.push('consumers[0].type (expected worker)');
      differences.push(...queueWorkerDifferences(consumer, 'consumers[0]'));
      if ((consumer.dead_letter_queue ?? '') !== '') {
        differences.push('consumers[0].dead_letter_queue (expected no dead-letter queue)');
      }
      const settings = consumer.settings;
      if (!isRecord(settings)) {
        differences.push('consumers[0].settings (expected an object)');
      } else {
        if (settings.max_concurrency != null) {
          differences.push(queueSettingDifference('consumers[0].settings.max_concurrency', 'automatic', settings.max_concurrency));
        }
        for (const [key, expected] of Object.entries(CONSUMER_SETTINGS)) {
          const actual = settings[key] ?? CONSUMER_DEFAULTS[key];
          if (actual !== expected) {
            differences.push(queueSettingDifference('consumers[0].settings.' + key, expected, actual));
          }
        }
      }
    }
  }

  const producers = queue.producers ?? [];
  if (!Array.isArray(producers)) {
    differences.push('producers (expected an array)');
    return differences;
  }
  for (const [index, producer] of producers.entries()) {
    const path = 'producers[' + index + ']';
    if (producer?.type === 'worker') {
      differences.push(...queueWorkerDifferences(producer, path));
    } else if (producer?.type === 'r2_bucket') {
      if (producer.bucket_name !== BUCKET) differences.push(path + '.bucket_name (expected the migration bucket)');
    } else {
      differences.push(path + '.type (expected worker or r2_bucket)');
    }
  }
  return differences;
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
  const queueDifferences = queueConfigurationDifferences(queue);
  const conflicts = [
    ...(!bucket.private ? ['R2_BUCKET_IS_PUBLIC'] : []),
    ...(bucket.cors === 'conflict' ? ['R2_CORS_CONFLICT'] : []),
    ...(bucket.notificationConflict ? [bucket.notificationConflict] : []),
    ...(queueDifferences.length ? ['QUEUE_CONFIGURATION_CONFLICT: ' + queueDifferences.join(', ')] : []),
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
    'MIGRATION_BUCKET_CHANGED_DURING_APPLY' + (current.notificationConflict ? ': ' + current.notificationConflict : ''));
  if (current.cors === 'missing') {
    await infra.request(BUCKET_PATH + '/cors', { method: 'PUT', body: desiredCors(origin) });
  }
  if (current.notifications === 'missing') {
    await infra.request(NOTIFICATIONS + '/queues/' + target.queue_id, { method: 'PUT', body: { rules: [RULE] } });
  }
  if (!token) {
    const [preflight, currentTokens] = await Promise.all([inspectWorker(deploy), infra.pages('/tokens')]);
    requireState(preflight.owned && preflight.private && !preflight.exists,
      'EXISTING_WORKER_WITHOUT_MIGRATION_TOKEN_REQUIRES_REVIEW');
    requireState(!unique(currentTokens, 'name', TOKEN), 'MIGRATION_TOKEN_APPEARED_DURING_APPLY: rerun preview');
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
  requireState(!after.conflicts.length, 'MIGRATION_INFRASTRUCTURE_READBACK_CONFLICT: ' + after.conflicts.join('; '));
  requireProvisioned(after);
  if (operation === 'deploy') {
    requireState(after.workflow, 'MIGRATION_WORKFLOW_MISSING');
    requireState(after.queue.consumers?.length === 1, 'QUEUE_CONFIGURATION_CONFLICT: consumers.length (expected 1 after deploy)');
    await smoke(deploy);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
