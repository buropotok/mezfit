import { pathToFileURL } from 'node:url';

const bucket = 'mezfit-comm-poc-20261106';
const ruleId = 'mezfit-pending-upload-v1';
const endpoint = 'https://storage.api.cloud.yandex.net/storage/v1/buckets/' + bucket;
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).sort().join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
export function desiredBucket(current, origin, folderId) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.origin !== origin) throw new Error('INVALID_MEDIA_ORIGIN');
  if (current.name !== bucket || current.folderId !== folderId
    || Object.values(current.anonymousAccessFlags ?? {}).some(Boolean)
    || (current.acl?.grants ?? []).some(grant => grant.grantType !== 'GRANT_TYPE_ACCOUNT')
    || current.versioning !== 'VERSIONING_DISABLED' || current.disabledStatickeyAuth)
    throw new Error('UNSAFE_OR_INCOMPATIBLE_BUCKET_CONFIGURATION');
  const statements = current.policy?.Statement ?? [];
  if (!Array.isArray(statements) || statements.some(statement => statement.Effect === 'Allow'
    && (!statement.Principal || JSON.stringify(statement.Principal).includes('*'))))
    throw new Error('PUBLIC_BUCKET_POLICY_FORBIDDEN');
  const otherRules = (current.lifecycleRules ?? []).filter(rule => rule.id !== ruleId);
  for (const rule of otherRules) {
    const prefix = rule.filter?.prefix ?? rule.filter?.andOperator?.prefix ?? '';
    if (rule.enabled && (prefix.startsWith('media/') || 'media/'.startsWith(prefix)))
      throw new Error('OVERLAPPING_MEDIA_LIFECYCLE');
  }
  return {
    cors: [{ id: 'mezfit-media-v1', allowedOrigins: [origin], allowedMethods: ['METHOD_GET', 'METHOD_HEAD', 'METHOD_PUT'],
      allowedHeaders: ['content-type', 'content-md5', 'cache-control', 'if-none-match', 'range',
        'x-amz-meta-mezfit-proof', 'x-amz-tagging'],
      exposeHeaders: ['ETag', 'Content-Length', 'Content-Range', 'Accept-Ranges'], maxAgeSeconds: '300' }],
    lifecycleRules: [...otherRules, { id: ruleId, enabled: true,
      filter: { andOperator: { prefix: 'media/objects/', tag: [{ key: 'mezfit-upload', value: 'pending' }] } },
      expiration: { days: '1' } }],
  };
}
async function reconcile() {
  const { YC_IAM_TOKEN, YC_FOLDER_ID, MEDIA_ORIGIN } = process.env;
  if (!YC_IAM_TOKEN || !YC_FOLDER_ID || !MEDIA_ORIGIN) throw new Error('MISSING_CONFIGURATION');
  async function call(url, method = 'GET', body) {
    const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: 'Bearer ' + YC_IAM_TOKEN, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined });
    if (!response.ok) throw new Error('BUCKET_CONFIGURATION_API_ERROR_' + response.status);
    return response.json();
  }
  const read = () => call(endpoint + '?view=VIEW_FULL');
  const view = ({ cors, lifecycleRules }) => ({ cors, lifecycleRules });
  const before = await read();
  const desired = desiredBucket(before, MEDIA_ORIGIN, YC_FOLDER_ID);
  if (canonical(view(before)) !== canonical(desired)) {
    let operation = await call(endpoint, 'PATCH', { updateMask: 'cors,lifecycleRules', ...desired });
    for (let attempt = 0; !operation.done && operation.id && attempt < 30; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      operation = await call('https://storage.api.cloud.yandex.net/operations/' + encodeURIComponent(operation.id));
    }
    if (!operation.done || operation.error) throw new Error('BUCKET_UPDATE_FAILED');
  }
  const after = await read();
  if (canonical(view(after)) !== canonical(desired)
    || canonical(desiredBucket(after, MEDIA_ORIGIN, YC_FOLDER_ID)) !== canonical(desired))
    throw new Error('BUCKET_READBACK_MISMATCH');
  console.log('Existing media bucket configuration verified');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  reconcile().catch(error => { console.error(error.message); process.exitCode = 1; });
}
