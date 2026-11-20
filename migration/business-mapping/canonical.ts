/** Order-insensitive collections are canonicalized; position-bearing arrays retain declared domain order. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    const values = [...value];
    if (values.every(item => typeof item === 'object' && item !== null && !Array.isArray(item))) {
      const rows = values as Record<string, unknown>[];
      const orderedKey = ['position', 'sourceKey', 'identityKey', 'operationKey', 'sourceSubjectKey',
        'id', 'startsAtUtc', 'kind', 'code', 'category'].find(k => rows.every(row => Object.hasOwn(row, k)));
      if (orderedKey) values.sort((a, b) => {
        const aa = (a as Record<string, unknown>)[orderedKey];
        const bb = (b as Record<string, unknown>)[orderedKey];
        const primary = typeof aa === 'number' && typeof bb === 'number'
          ? aa - bb : String(aa).localeCompare(String(bb), 'en');
        return primary || canonical(a).localeCompare(canonical(b), 'en');
      });
    } else if (values.every(item => typeof item === 'string')) {
      values.sort((a, b) => String(a).localeCompare(String(b), 'en'));
    }
    return '[' + values.map(canonical).join(',') + ']';
  }
  if (value !== null && typeof value === 'object') {
    return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
  }
  return JSON.stringify(value);
}

/** SHA-256 is stable across Worker/browser/Node WebCrypto; no randomness, clock, I/O or DB. */
export async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
