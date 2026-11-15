import { createHash } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const D1_NAME = 'mezfit';
export const R2_BUCKETS = ['mezfit', 'mezfit-discussion-media'];
export const R2_TOKEN_NAME = 'mezfit-discussion-media-uploader';
const API_BASE = 'https://api.cloudflare.com/client/v4';
const R2_WRITE_GROUP = 'Workers R2 Storage Bucket Item Write';

export function validateOrigin(value) {
  if (typeof value !== 'string' || !value) throw new Error('APP_ORIGIN_REQUIRED');
  let url;
  try { url = new URL(value); } catch { throw new Error('APP_ORIGIN_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || url.search || url.hash || url.pathname !== '/' || !url.hostname.includes('.')) {
    throw new Error('APP_ORIGIN_MUST_BE_EXACT_HTTPS_ORIGIN');
  }
  return url.origin;
}

export function validateAccountId(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{32}$/i.test(value)) throw new Error('CLOUDFLARE_ACCOUNT_ID_INVALID');
  return value.toLowerCase();
}

export function desiredCors(origin) {
  return { rules: [{
    id: 'mezfit-discussion-direct-upload',
    allowed: {
      origins: [validateOrigin(origin)],
      methods: ['GET', 'HEAD', 'PUT'],
      headers: ['Content-Type', 'If-None-Match', 'Range'],
    },
    exposeHeaders: ['ETag', 'Accept-Ranges', 'Content-Range', 'Content-Length'],
    maxAgeSeconds: 3600,
  }] };
}

export function sameCors(existing, desired) {
  const normalize = (item) => {
    const rules = item?.rules;
    if (!Array.isArray(rules)) return false;
    return JSON.stringify(rules.map(rule => ({
      id: rule.id,
      origins: [...(rule.allowed?.origins ?? [])].sort(),
      methods: [...(rule.allowed?.methods ?? [])].sort(),
      headers: [...(rule.allowed?.headers ?? [])].sort(),
      exposeHeaders: [...(rule.exposeHeaders ?? [])].sort(),
      maxAgeSeconds: rule.maxAgeSeconds ?? 0,
    })).sort((a, b) => String(a.id).localeCompare(String(b.id))));
  };
  return normalize(existing) === normalize(desired);
}

export class CloudflareApi {
  constructor(accountId, token, transport = fetch) {
    this.accountId = validateAccountId(accountId);
    if (!token) throw new Error('CLOUDFLARE_BOOTSTRAP_TOKEN_REQUIRED');
    this.token = token;
    this.transport = transport;
  }

  async request(route, { method = 'GET', body, optional404 = false } = {}) {
    const response = await this.transport(API_BASE + route, {
      method,
      headers: {
        Authorization: 'Bearer ' + this.token,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error',
    });
    if (optional404 && response.status === 404) return null;
    // Never print upstream response bodies: these can contain newly minted credentials.
    if (!response.ok) throw new Error('CLOUDFLARE_API_FAILED:' + method + ':' + route.split('?')[0] + ':HTTP_' + response.status);
    let envelope;
    try { envelope = await response.json(); }
    catch { throw new Error('CLOUDFLARE_API_INVALID_RESPONSE:' + method + ':' + route.split('?')[0]); }
    if (envelope?.success !== true || !('result' in envelope)) {
      throw new Error('CLOUDFLARE_API_UNSUCCESSFUL:' + method + ':' + route.split('?')[0]);
    }
    return envelope;
  }

  path(suffix) { return '/accounts/' + this.accountId + suffix; }

  async pages(suffix) {
    const result = [];
    // Account-token list accepts at most 50 results/page; D1 also accepts 50.
    const pageSize = 50;
    for (let page = 1; page <= 20; page++) {
      const separator = suffix.includes('?') ? '&' : '?';
      const response = await this.request(this.path(suffix + separator + 'per_page=' + pageSize + '&page=' + page));
      if (!Array.isArray(response.result)) throw new Error('CLOUDFLARE_API_EXPECTED_LIST');
      result.push(...response.result);
      const totalPages = response.result_info?.total_pages;
      const totalCount = response.result_info?.total_count;
      if (typeof totalPages === 'number' ? page >= totalPages
        : typeof totalCount === 'number' ? result.length >= totalCount
          : response.result.length < pageSize) return result;
    }
    throw new Error('CLOUDFLARE_LIST_PAGINATION_LIMIT');
  }
}

export async function inspectInfrastructure(api, { origin, includeToken = true } = {}) {
  const accountId = api.accountId;
  const entries = await api.pages('/d1/database');
  const databases = entries.filter(db => db.name === D1_NAME);
  if (databases.length > 1) throw new Error('D1_DUPLICATE_NAME');
  const db = databases[0] ?? null;
  if (db && !/^[a-f0-9-]{36}$/i.test(db.uuid ?? '')) throw new Error('D1_INVALID_UUID');

  const buckets = {};
  for (const bucket of R2_BUCKETS) {
    const response = await api.request(api.path('/r2/buckets/' + bucket), { optional404: true });
    buckets[bucket] = response?.result ?? null;
    if (buckets[bucket] && buckets[bucket].name !== bucket) throw new Error('R2_BUCKET_NAME_MISMATCH');
  }
  const media = R2_BUCKETS[1];
  const response = buckets[media]
    ? await api.request(api.path('/r2/buckets/' + media + '/cors'), { optional404: true })
    : null;
  const actualCors = response?.result ?? { rules: [] };
  const desired = desiredCors(origin);
  const corsState = !buckets[media] ? 'bucket_missing'
    : sameCors(actualCors, desired) ? 'current'
      : (Array.isArray(actualCors.rules) && actualCors.rules.length === 0 ? 'missing' : 'conflict');

  let tokenPresent = null;
  if (includeToken) {
    const tokens = await api.pages('/tokens');
    tokenPresent = tokens.some(token => token.name === R2_TOKEN_NAME);
  }
  return { accountId, db, buckets, actualCors, desiredCors: desired, corsState, tokenPresent };
}

export async function provisionInfrastructure(api, {
  origin, mode = 'preview', replaceExistingCors = false, generateR2Token = true,
  credentialsFile,
} = {}) {
  if (!['preview', 'apply'].includes(mode)) throw new Error('INVALID_BOOTSTRAP_MODE');
  const state = await inspectInfrastructure(api, { origin, includeToken: generateR2Token });
  const actions = [];
  if (!state.db) actions.push('create D1 ' + D1_NAME);
  for (const bucket of R2_BUCKETS) {
    if (!state.buckets[bucket]) actions.push('create R2 ' + bucket);
  }
  if (state.corsState === 'missing' || state.corsState === 'bucket_missing') actions.push('configure discussion R2 CORS');
  if (state.corsState === 'conflict') actions.push('R2 CORS conflict (replace_existing_cors required)');
  if (generateR2Token && !state.tokenPresent) actions.push('create scoped discussion R2 S3 token');
  if (mode === 'preview') return { actions, state, databaseId: state.db?.uuid ?? null };

  if (state.corsState === 'conflict' && !replaceExistingCors) throw new Error('EXISTING_R2_CORS_REQUIRES_EXPLICIT_APPROVAL');
  if (generateR2Token && !state.tokenPresent && !credentialsFile) throw new Error('R2_CREDENTIAL_FILE_REQUIRED');
  // Preflight token permission metadata *before* creating resources, so lack of
  // token-management privilege does not leave a partially provisioned account.
  let bucketWriteGroup;
  if (generateR2Token && !state.tokenPresent) {
    const groups = await api.request(api.path('/tokens/permission_groups?name='
      + encodeURIComponent(R2_WRITE_GROUP) + '&scope=' + encodeURIComponent('com.cloudflare.edge.r2.bucket')));
    if (!Array.isArray(groups.result)) throw new Error('R2_TOKEN_GROUPS_INVALID');
    bucketWriteGroup = groups.result.find(item => item.name === R2_WRITE_GROUP
      && Array.isArray(item.scopes) && item.scopes.includes('com.cloudflare.edge.r2.bucket'));
    if (!bucketWriteGroup?.id) throw new Error('R2_TOKEN_WRITE_PERMISSION_MISSING');
  }

  let databaseId = state.db?.uuid;
  if (!databaseId) {
    const response = await api.request(api.path('/d1/database'), { method: 'POST', body: { name: D1_NAME } });
    databaseId = response.result?.uuid;
    if (!/^[a-f0-9-]{36}$/i.test(databaseId ?? '')) throw new Error('D1_CREATE_RESPONSE_INVALID');
  }
  for (const bucket of R2_BUCKETS) {
    if (!state.buckets[bucket]) {
      await api.request(api.path('/r2/buckets'), { method: 'POST', body: { name: bucket } });
      const actual = await api.request(api.path('/r2/buckets/' + bucket));
      if (actual.result?.name !== bucket) throw new Error('R2_BUCKET_READBACK_FAILED');
    }
  }
  if (state.corsState !== 'current') {
    await api.request(api.path('/r2/buckets/' + R2_BUCKETS[1] + '/cors'), {
      method: 'PUT', body: state.desiredCors,
    });
    const after = await api.request(api.path('/r2/buckets/' + R2_BUCKETS[1] + '/cors'));
    if (!sameCors(after.result, state.desiredCors)) throw new Error('R2_CORS_READBACK_MISMATCH');
  }
  let newR2Token = false;
  if (generateR2Token && !state.tokenPresent) {
    const resource = 'com.cloudflare.edge.r2.bucket.' + api.accountId + '_default_' + R2_BUCKETS[1];
    const token = await api.request(api.path('/tokens'), {
      method: 'POST',
      body: {
        name: R2_TOKEN_NAME,
        policies: [{ effect: 'allow', resources: { [resource]: '*' },
          permission_groups: [{ id: bucketWriteGroup.id, name: R2_WRITE_GROUP }] }],
      },
    });
    if (!/^[a-f0-9]{32}$/i.test(token.result?.id ?? '') || !token.result?.value) {
      throw new Error('R2_TOKEN_CREATE_RESPONSE_INVALID');
    }
    const secrets = {
      R2_ACCOUNT_ID: api.accountId,
      R2_MEDIA_ACCESS_KEY_ID: token.result.id,
      R2_MEDIA_SECRET_ACCESS_KEY: createHash('sha256').update(token.result.value).digest('hex'),
    };
    await mkdir(dirname(credentialsFile), { recursive: true });
    await writeFile(credentialsFile, JSON.stringify(secrets), { mode: 0o600, flag: 'wx' });
    newR2Token = true;
  }
  // Complete readback is mandatory for resources; credentials are write-only.
  const after = await inspectInfrastructure(api, { origin, includeToken: generateR2Token });
  if (!after.db || after.db.uuid !== databaseId
    || R2_BUCKETS.some(bucket => !after.buckets[bucket])
    || after.corsState !== 'current'
    || (generateR2Token && !after.tokenPresent)) throw new Error('BOOTSTRAP_READBACK_FAILED');
  return { actions, state: after, databaseId, newR2Token };
}

async function main() {
  const mode = process.env.BOOTSTRAP_MODE ?? 'preview';
  const accountId = validateAccountId(process.env.CLOUDFLARE_ACCOUNT_ID);
  const origin = validateOrigin(process.env.MEZFIT_APP_ORIGIN);
  const token = process.env.CLOUDFLARE_BOOTSTRAP_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
  const api = new CloudflareApi(accountId, token);
  const result = await provisionInfrastructure(api, {
    origin, mode,
    replaceExistingCors: process.env.REPLACE_EXISTING_CORS === 'true',
    generateR2Token: process.env.GENERATE_R2_TOKEN !== 'false',
    credentialsFile: process.env.R2_CREDENTIALS_FILE,
  });
  const lines = [
    '## Cloudflare infrastructure (' + mode + ')',
    '',
    '- Account: ' + accountId,
    '- Application origin: ' + origin,
    '- D1: ' + (result.state.db ? 'exists' : 'missing'),
    ...R2_BUCKETS.map(bucket => '- R2 ' + bucket + ': ' + (result.state.buckets[bucket] ? 'exists' : 'missing')),
    '- Media R2 CORS: ' + result.state.corsState,
    '- R2 uploader token: ' + (result.state.tokenPresent === null ? 'skipped'
      : result.state.tokenPresent ? 'exists' : 'missing'),
    '- Planned actions: ' + (result.actions.length ? result.actions.join('; ') : 'none'),
    ...(result.newR2Token ? ['- New scoped R2 token generated and staged privately for Worker deployment'] : []),
    '',
  ];
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
  process.stdout.write(lines.join('\n') + '\n');
  if (mode === 'apply') {
    if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT_REQUIRED');
    await appendFile(process.env.GITHUB_OUTPUT, 'database_id=' + result.databaseId + '\n');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    // Error codes only: never print HTTP response bodies or generated credentials.
    console.error(error instanceof Error ? error.message : 'BOOTSTRAP_FAILED');
    process.exitCode = 1;
  });
}
