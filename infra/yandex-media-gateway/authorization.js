'use strict';

async function authorize(fetchImpl, contracts, env, headers, body, fail) {
  const initData = headers['x-telegram-init-data'];
  const bearer = headers.authorization;
  if (typeof initData !== 'string' || initData.length > 12000
    || typeof bearer !== 'string' || !/^Bearer [^\s]{1,16384}$/.test(bearer)) fail(401, 'UNAUTHORIZED');
  const params = [...new URLSearchParams(initData).keys()];
  if (new Set(params).size !== params.length) fail(401, 'UNAUTHORIZED');
  let identity;
  try { identity = await contracts.validateTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN); }
  catch { fail(401, 'UNAUTHORIZED'); }
  const actor = 'tg:' + identity.user.id;

  async function cloud(path) {
    const response = await fetchImpl(contracts.dbUrl + path, {
      redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { Authorization: bearer, Origin: env.MEDIA_ORIGIN, Accept: 'application/json' },
    });
    if (response.status === 401) fail(401, 'UNAUTHORIZED');
    if ([403, 404].includes(response.status)) fail(403, 'MEDIA_FORBIDDEN');
    if (!response.ok) fail(502, 'DEXIE_UNAVAILABLE');
    try { return await response.json(); }
    catch { fail(502, 'INVALID_DEXIE_RESPONSE'); }
  }
  const token = await cloud('/token/validate');
  if (token?.valid !== true || token.claims?.sub !== actor) fail(401, 'UNAUTHORIZED');
  const get = (table, key) => cloud('/my/' + table + '/' + encodeURIComponent(key));
  const [thread, message, attachment] = await Promise.all([
    get('discussionThreads', body.threadId),
    get('discussionMessages', body.messageId),
    get('messageAttachments', body.attachmentId),
  ]);
  if (thread?.id !== body.threadId || message?.id !== body.messageId || attachment?.id !== body.attachmentId
    || [thread, message, attachment].some(row => row.realmId !== body.realmId)
    || message.threadId !== thread.id || attachment.messageId !== message.id
    || thread.owner !== thread.realmId || message.owner !== message.authorUserId
    || attachment.owner !== attachment.authorUserId || message.authorUserId !== attachment.authorUserId
    || !/^tg:[1-9]\d*$/.test(attachment.authorUserId)) fail(403, 'MEDIA_FORBIDDEN');
  let anchorKey;
  try { anchorKey = contracts.discussionAnchorKey(thread, thread.anchor); }
  catch { fail(403, 'MEDIA_FORBIDDEN'); }
  if (anchorKey !== thread.anchorKey) fail(403, 'MEDIA_FORBIDDEN');
  if (thread.coachClientId === null) {
    if (body.realmId !== actor || attachment.authorUserId !== actor) fail(403, 'MEDIA_FORBIDDEN');
  } else {
    const [realm, rows] = await Promise.all([
      get('realms', body.realmId), cloud('/my/members?realmId=' + encodeURIComponent(body.realmId)),
    ]);
    if (!Array.isArray(rows) || !rows.every(row => row && Array.isArray(row.roles))) fail(403, 'MEDIA_FORBIDDEN');
    const members = rows.map(row => ({ ...row, accepted: row.accepted === true ? true
      : typeof row.accepted === 'string' ? new Date(row.accepted)
        : row.accepted?.$t === 'Date' ? new Date(row.accepted.v) : false }));
    const coach = members.find(row => row.roles.length === 1 && row.roles[0] === 'coach');
    const client = members.find(row => row.roles.length === 1 && row.roles[0] === 'client');
    if (!realm || !coach || !client || thread.coachClientId !== body.realmId
      || ![coach.userId, client.userId].includes(actor)
      || ![coach.userId, client.userId].includes(attachment.authorUserId)
      || !await contracts.checkApprovedAssignedPair({ realm, members, coachUserId: coach.userId, clientUserId: client.userId }))
      fail(403, 'MEDIA_FORBIDDEN');
  }
  if (body.operation !== 'read' && attachment.authorUserId !== actor) fail(403, 'MEDIA_FORBIDDEN');
  if (body.operation !== 'remove' && (message.deletedAt || attachment.deletedAt)) fail(410, 'MEDIA_REMOVED');
  return { thread, message, attachment };
}
module.exports = { authorize };
