import type { SyncPushEnvelope, SyncPushResult } from '../../shared/sync';

export const SYNC_REQUEST_RETENTION_REVISIONS = 128;

export class SyncRequestReuseError extends Error {
  constructor(readonly requestId: string) {
    super('SYNC_REQUEST_ID_REUSED');
    this.name = 'SyncRequestReuseError';
  }
}

export function validateSyncEnvelopeMetadata(
  envelope: Pick<SyncPushEnvelope, 'requestId' | 'scopeKey' | 'baseServerRevision'>,
): void {
  if (!/^[A-Za-z0-9-]{8,100}$/.test(envelope.requestId)) {
    throw new Error('SYNC_REQUEST_ID_INVALID');
  }
  if (
    envelope.scopeKey.length < 3
    || envelope.scopeKey.length > 200
    || !/^[A-Za-z0-9:_-]+$/.test(envelope.scopeKey)
  ) {
    throw new Error('SYNC_SCOPE_KEY_INVALID');
  }
  if (!Number.isInteger(envelope.baseServerRevision) || envelope.baseServerRevision < 0) {
    throw new Error('SYNC_SERVER_REVISION_INVALID');
  }
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('SYNC_SNAPSHOT_NOT_JSON');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  throw new Error('SYNC_SNAPSHOT_NOT_JSON');
}

async function snapshotFingerprint(snapshot: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(snapshot));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function ensureSyncScopeRevision(
  db: D1Database,
  scopeKey: string,
): Promise<number> {
  await db.prepare(
    'INSERT OR IGNORE INTO sync_scope_revision(scope_key, revision) VALUES (?, 0)',
  ).bind(scopeKey).run();
  return readSyncScopeRevision(db, scopeKey);
}

export async function readSyncScopeRevision(
  db: D1Database,
  scopeKey: string,
): Promise<number> {
  const row = await db.prepare(
    'SELECT revision FROM sync_scope_revision WHERE scope_key = ?',
  ).bind(scopeKey).first<{ revision: number }>();
  return row?.revision ?? 0;
}

/**
 * Standalone revision bump for a scope without a domain snapshot write.
 * A caller that mutates domain data at the same time must place that mutation
 * and the revision bump in one D1 batch/transaction.
 */
export async function bumpSyncScopeRevision(
  db: D1Database,
  scopeKey: string,
): Promise<number> {
  const row = await db.prepare(`
    INSERT INTO sync_scope_revision(scope_key, revision, updated_at)
    VALUES (?, 1, CURRENT_TIMESTAMP)
    ON CONFLICT(scope_key) DO UPDATE SET
      revision = sync_scope_revision.revision + 1,
      updated_at = CURRENT_TIMESTAMP
    RETURNING revision
  `).bind(scopeKey).first<{ revision: number }>();
  if (!row) throw new Error('SYNC_REVISION_BUMP_FAILED');
  return row.revision;
}

interface StoredSyncRequest {
  scope_key: string;
  base_server_revision: number;
  payload_fingerprint: string;
  response_revision: number;
}

function assertIdempotentReplay(
  existing: StoredSyncRequest,
  envelope: SyncPushEnvelope,
  fingerprint: string,
): SyncPushResult {
  if (
    existing.scope_key !== envelope.scopeKey
    || existing.base_server_revision !== envelope.baseServerRevision
    || existing.payload_fingerprint !== fingerprint
  ) {
    throw new SyncRequestReuseError(envelope.requestId);
  }
  return { kind: 'accepted', serverRevision: existing.response_revision };
}

/**
 * Run a validated and authorized domain mutation in the same D1 transaction as
 * revision CAS and request-id persistence.
 *
 * The caller owns authentication, authorization and domain validation.
 * This helper fingerprints the validated snapshot, then owns synchronization
 * protocol semantics and a bounded idempotency history.
 */
export async function applySyncBatch(
  db: D1Database,
  envelope: SyncPushEnvelope,
  domainStatements: readonly D1PreparedStatement[],
): Promise<SyncPushResult> {
  validateSyncEnvelopeMetadata(envelope);
  const fingerprint = await snapshotFingerprint(envelope.snapshot);

  const existing = await db.prepare(`
    SELECT scope_key, base_server_revision, payload_fingerprint, response_revision
    FROM sync_request
    WHERE request_id = ?
  `).bind(envelope.requestId).first<StoredSyncRequest>();
  if (existing) {
    return assertIdempotentReplay(existing, envelope, fingerprint);
  }

  const currentRevision = await ensureSyncScopeRevision(db, envelope.scopeKey);
  if (currentRevision !== envelope.baseServerRevision) {
    return { kind: 'conflict', serverRevision: currentRevision };
  }

  const nextRevision = currentRevision + 1;
  const retentionCutoff = Math.max(
    0,
    nextRevision - SYNC_REQUEST_RETENTION_REVISIONS,
  );
  const statements: D1PreparedStatement[] = [
    db.prepare(`
      INSERT INTO sync_cas_assert(request_id, ok)
      SELECT ?, CASE WHEN revision = ? THEN 1 ELSE 0 END
      FROM sync_scope_revision
      WHERE scope_key = ?
    `).bind(
      envelope.requestId,
      envelope.baseServerRevision,
      envelope.scopeKey,
    ),
    ...domainStatements,
    db.prepare(`
      UPDATE sync_scope_revision
      SET revision = ?, updated_at = CURRENT_TIMESTAMP
      WHERE scope_key = ? AND revision = ?
    `).bind(nextRevision, envelope.scopeKey, envelope.baseServerRevision),
    db.prepare(`
      INSERT INTO sync_request(
        request_id,
        scope_key,
        base_server_revision,
        payload_fingerprint,
        response_revision
      )
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      envelope.requestId,
      envelope.scopeKey,
      envelope.baseServerRevision,
      fingerprint,
      nextRevision,
    ),
    db.prepare(`
      DELETE FROM sync_request
      WHERE scope_key = ?
        AND response_revision <= ?
    `).bind(envelope.scopeKey, retentionCutoff),
    db.prepare(
      'DELETE FROM sync_cas_assert WHERE request_id = ?',
    ).bind(envelope.requestId),
  ];

  try {
    await db.batch(statements);
    return { kind: 'accepted', serverRevision: nextRevision };
  } catch (error) {
    const repeated = await db.prepare(`
      SELECT scope_key, base_server_revision, payload_fingerprint, response_revision
      FROM sync_request
      WHERE request_id = ?
    `).bind(envelope.requestId).first<StoredSyncRequest>();
    if (repeated) {
      return assertIdempotentReplay(repeated, envelope, fingerprint);
    }

    const latestRevision = await readSyncScopeRevision(db, envelope.scopeKey);
    if (latestRevision !== envelope.baseServerRevision) {
      return { kind: 'conflict', serverRevision: latestRevision };
    }
    throw error;
  }
}
