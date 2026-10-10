import type { SyncPushEnvelope, SyncPushResult } from '../../shared/sync';

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

export async function bumpSyncScopeRevision(
  db: D1Database,
  scopeKey: string,
): Promise<number> {
  await db.prepare(`
    INSERT INTO sync_scope_revision(scope_key, revision, updated_at)
    VALUES (?, 1, CURRENT_TIMESTAMP)
    ON CONFLICT(scope_key) DO UPDATE SET
      revision = sync_scope_revision.revision + 1,
      updated_at = CURRENT_TIMESTAMP
  `).bind(scopeKey).run();
  return readSyncScopeRevision(db, scopeKey);
}

/**
 * Run a validated and authorized domain mutation in the same D1 transaction as
 * revision CAS and request-id persistence.
 *
 * The caller owns authentication, authorization, snapshot validation and the
 * domain statements. This helper owns only synchronization protocol semantics.
 */
export async function applySyncBatch(
  db: D1Database,
  envelope: Pick<SyncPushEnvelope, 'requestId' | 'scopeKey' | 'baseServerRevision'>,
  domainStatements: readonly D1PreparedStatement[],
): Promise<SyncPushResult> {
  validateSyncEnvelopeMetadata(envelope);

  const existing = await db.prepare(`
    SELECT scope_key, response_revision
    FROM sync_request
    WHERE request_id = ?
  `).bind(envelope.requestId).first<{
    scope_key: string;
    response_revision: number;
  }>();
  if (existing) {
    if (existing.scope_key !== envelope.scopeKey) {
      throw new SyncRequestReuseError(envelope.requestId);
    }
    return { kind: 'accepted', serverRevision: existing.response_revision };
  }

  const currentRevision = await ensureSyncScopeRevision(db, envelope.scopeKey);
  if (currentRevision !== envelope.baseServerRevision) {
    return { kind: 'conflict', serverRevision: currentRevision };
  }

  const nextRevision = currentRevision + 1;
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
      INSERT INTO sync_request(request_id, scope_key, response_revision)
      VALUES (?, ?, ?)
    `).bind(envelope.requestId, envelope.scopeKey, nextRevision),
    db.prepare(
      'DELETE FROM sync_cas_assert WHERE request_id = ?',
    ).bind(envelope.requestId),
  ];

  try {
    await db.batch(statements);
    return { kind: 'accepted', serverRevision: nextRevision };
  } catch (error) {
    const repeated = await db.prepare(`
      SELECT scope_key, response_revision
      FROM sync_request
      WHERE request_id = ?
    `).bind(envelope.requestId).first<{
      scope_key: string;
      response_revision: number;
    }>();
    if (repeated) {
      if (repeated.scope_key !== envelope.scopeKey) {
        throw new SyncRequestReuseError(envelope.requestId);
      }
      return { kind: 'accepted', serverRevision: repeated.response_revision };
    }

    const latestRevision = await readSyncScopeRevision(db, envelope.scopeKey);
    if (latestRevision !== envelope.baseServerRevision) {
      return { kind: 'conflict', serverRevision: latestRevision };
    }
    throw error;
  }
}
