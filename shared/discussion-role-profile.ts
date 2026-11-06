import overlay from '../cloud/discussion-roles.json';
import { discussionRecord } from './discussion-anchor';

/** Strip only the exact optional overlay, then let the existing membership verifier validate its baseline. */
export function discussionRolesBaseline(roles: unknown[]): unknown[] | null {
  const names = ['coach', 'client'] as const;
  const candidates = names.map(name => {
    const role = roles.find(item => discussionRecord(item) && item.realmId === 'rlm-public' && item.name === name);
    if (!discussionRecord(role) || !discussionRecord(role.permissions)) return false;
    return (Array.isArray(role.permissions.add) && role.permissions.add.some(table =>
      typeof table === 'string' && (table.startsWith('discussion') || table === 'messageAttachments')))
      || (discussionRecord(role.permissions.update) && Object.keys(role.permissions.update).some(table =>
        table.startsWith('discussion') || table === 'messageAttachments'));
  });
  if (!candidates.some(Boolean)) return roles;
  if (!candidates.every(Boolean)) return null;
  // Both roles must be on one complete reviewed profile, never a mixed rollout.
  const attachmentGrants = names.map(name => {
    const role = roles.find(item => discussionRecord(item) && item.realmId === 'rlm-public' && item.name === name);
    return discussionRecord(role) && discussionRecord(role.permissions)
      && Array.isArray(role.permissions.add) && role.permissions.add.includes('messageAttachments');
  });
  if (attachmentGrants.some(Boolean) && !attachmentGrants.every(Boolean)) return null;
  const includeAttachments = attachmentGrants.every(Boolean);
  const result: unknown[] = [];
  for (const role of roles) {
    if (!discussionRecord(role) || role.realmId !== 'rlm-public' || (role.name !== 'coach' && role.name !== 'client')) {
      result.push(role); continue;
    }
    const permissions = role.permissions;
    if (!discussionRecord(permissions) || !Array.isArray(permissions.add) || !discussionRecord(permissions.update)) return null;
    const additions = permissions.add;
    const grant = overlay.roles[role.name].permissions;
    const expectedAdd = grant.add.filter(table => includeAttachments || table !== 'messageAttachments');
    if (expectedAdd.some(table => additions.filter((item: unknown) => item === table).length !== 1)
      || !Array.isArray(permissions.update.discussionThreads)
      || permissions.update.discussionThreads.length !== 1 || permissions.update.discussionThreads[0] !== 'lastActivityAt'
      || !additions.includes('flexValues') || !Object.hasOwn(permissions.update, 'flexValues')) return null;
    const update = { ...permissions.update }; delete update.discussionThreads;
    result.push({ ...role, permissions: { ...permissions, update,
      add: additions.filter((table: unknown) => typeof table !== 'string' || !expectedAdd.includes(table)) } });
  }
  return result;
}
