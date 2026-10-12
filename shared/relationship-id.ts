/**
 * Deterministic IDs shared by the privileged invitation provisioner and the
 * local PLAN repository. Never derive an approved realm from client-supplied
 * IDs alone: callers must also verify the realm and its memberships.
 */
export async function stableCloudRelationshipId(prefix: 'rlm' | 'mmb' | 'prf', input: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return prefix + [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0'))
    .join('').slice(0, 28);
}

export function relationshipRealmId(coachTelegramId: string, clientTelegramId: string): Promise<string> {
  return stableCloudRelationshipId(
    'rlm', 'mezfit-relationship-v1:' + coachTelegramId + ':' + clientTelegramId,
  );
}
