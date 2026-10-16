/** Reports the synced global policy, not the actor's effective realm permissions. */
export function globalCoachPhasePermission(roles: readonly unknown[]): boolean | null {
  const role = roles.find((value) => typeof value === 'object' && value !== null
    && 'realmId' in value && value.realmId === 'rlm-public'
    && 'name' in value && value.name === 'coach');
  if (typeof role !== 'object' || role === null || !('permissions' in role)) return null;
  const permissions = role.permissions;
  if (typeof permissions !== 'object' || permissions === null) return null;
  if (!('manage' in permissions)) return false;
  return permissions.manage === '*' || (Array.isArray(permissions.manage)
    && permissions.manage.includes('programPhases'));
}
