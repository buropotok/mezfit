/** Stable keys for personal realm-scoped Flex Attribute definitions and values. */
const encodeParts = (...parts: string[]): string =>
  parts.map(part => String(part.length) + ':' + part).join(':');

export function flexAttributeId(realmId: string, key: string): string {
  return 'flex-attribute:' + encodeParts(realmId, key);
}

export function flexValueId(
  target: { realmId: string; entityType: string; entityId: string }, attributeId: string,
): string {
  return 'flex-value:' + encodeParts(target.realmId, target.entityType, target.entityId, attributeId);
}
