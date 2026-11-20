// Exact JSON contracts share their implementation with the inferred TS types.
export type Rule<T> = (value: unknown) => value is T;
export type Value<R> = R extends Rule<infer T> ? T : never;

export function object<F extends Record<string, Rule<unknown>>>(fields: F): Rule<{ [K in keyof F]: Value<F[K]> }> {
  const entries = Object.entries(fields);
  return (value): value is { [K in keyof F]: Value<F[K]> } =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === entries.length
    && entries.every(([key, rule]) => Object.hasOwn(value, key) && rule(Reflect.get(value, key)));
}

export function choice<const T extends readonly (string | number | boolean | null)[]>(...values: T): Rule<T[number]> {
  return (value): value is T[number] => values.some(item => item === value);
}

export function union<A, B>(a: Rule<A>, b: Rule<B>): Rule<A | B> {
  return (value): value is A | B => a(value) || b(value);
}

export const nullable = <T>(rule: Rule<T>) => union(choice(null), rule);
export const list = <T>(rule: Rule<T>, max: number): Rule<T[]> =>
  (value): value is T[] => Array.isArray(value) && value.length <= max && value.every(rule);
export const text = (max: number, nonempty = false): Rule<string> =>
  (value): value is string => typeof value === 'string' && value.length <= max
    && (!nonempty || value.trim().length > 0);
export const key: Rule<string> = (value): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128;
export const digest: Rule<string> = (value): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const finite: Rule<number> = (value): value is number => typeof value === 'number' && Number.isFinite(value);
export const nonnegative: Rule<number> = (value): value is number => finite(value) && value >= 0;
export const count: Rule<number> = (value): value is number => nonnegative(value) && Number.isSafeInteger(value);

export const date: Rule<string> = (value): value is string =>
  typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value) && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString().slice(0, 10) === value;

export const instant: Rule<string> = (value): value is string =>
  typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction: string | undefined) =>
    '.' + (fraction ?? '').padEnd(3, '0') + 'Z');

export const zone: Rule<string> = (value): value is string => {
  if (!key(value) || !/^(UTC|[A-Za-z_]+(?:\/[A-Za-z_+0-9-]+)+)$/.test(value)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; }
  catch { return false; }
};

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

// Copy while checking the JSON budget and reading only own data properties.
// Creating containers here keeps the snapshot in the validator's JS realm.
export function jsonSnapshot(root: unknown, maxBytes: number): unknown {
  let nodes = 0;
  let bytes = 0;
  const encoder = new TextEncoder();
  const ancestors = new Set<object>();

  function copy(value: unknown, depth: number): JsonValue | undefined {
    if (++nodes > 100_000 || depth > 18 || ++bytes > maxBytes) return undefined;
    if (typeof value === 'string') {
      if (value.length > maxBytes - bytes) return undefined;
      bytes += encoder.encode(JSON.stringify(value)).length;
      return bytes <= maxBytes ? value : undefined;
    }
    if (value === null || typeof value === 'boolean' || finite(value)) {
      bytes += JSON.stringify(value).length;
      return bytes <= maxBytes ? value : undefined;
    }
    if (typeof value !== 'object' || value === null || ancestors.has(value)) return undefined;
    ancestors.add(value);
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return undefined;
    const properties = Reflect.ownKeys(value);
    if (array ? value.length > 10_000 || properties.length !== value.length + 1 : properties.length > 32) return undefined;
    const items: JsonValue[] = [];
    const entries: [string, JsonValue][] = [];
    for (const property of properties) {
      if (array && property === 'length') continue;
      if (typeof property !== 'string' || (array && property !== String(items.length))) return undefined;
      if (!array) {
        if (property.length > maxBytes - bytes) return undefined;
        bytes += encoder.encode(JSON.stringify(property)).length + 1;
        if (bytes > maxBytes) return undefined;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, property);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return undefined;
      const item = copy(descriptor.value, depth + 1);
      if (item === undefined) return undefined;
      if (array) items.push(item);
      else entries.push([property, item]);
    }
    ancestors.delete(value);
    if (++bytes > maxBytes) return undefined;
    return array ? items : Object.fromEntries(entries);
  }

  try { return copy(root, 0); }
  catch { return undefined; }
}

export const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.entries(value).sort(([a], [b]) => compare(a, b))
      .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
  }
  return JSON.stringify(value);
}

export async function hash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(value));
  const result = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('');
}
