const KNOWN_CODES = new Set([
  'AccessDenied', 'Unauthorized', 'SignatureDoesNotMatch', 'InvalidArgument', 'AuthorizationQueryParametersError',
  'AuthorizationHeaderMalformed', 'InvalidToken', 'ExpiredToken', 'RequestExpired', 'RequestTimeTooSkewed',
  'PreconditionFailed', 'ConditionalRequestConflict', 'MissingContentLength',
  'InvalidAccessKeyId', 'SlowDown', 'ServiceUnavailable', 'NoSuchKey', 'NoSuchBucket',
]);

export interface S3Reply {
  status: number;
  code: string;
  expired: boolean;
  missingSignedHeader: boolean;
  contentType: 'xml' | 'json' | 'html' | 'text' | 'other' | 'absent';
  bodyFormat: 's3-xml' | 'opaque' | 'empty' | 'truncated' | 'unread';
  codePresent: boolean;
}

function contentTypeKind(header: string | null): S3Reply['contentType'] {
  const mime = header?.split(';')[0].trim().toLowerCase();
  if (!mime) return 'absent';
  if (['application/xml', 'text/xml'].includes(mime) || mime.endsWith('+xml')) return 'xml';
  if (mime === 'application/json' || mime.endsWith('+json')) return 'json';
  if (mime === 'text/html') return 'html';
  if (mime.startsWith('text/')) return 'text';
  return 'other';
}

export async function readS3Reply(response: Response): Promise<S3Reply> {
  const status = response.status;
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let xml = '';
  let truncated = false;
  try {
    if (reader && status >= 400) {
      let remaining = 4096;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (chunk.value.length > remaining) { truncated = true; break; }
        xml += decoder.decode(chunk.value, { stream: true });
        remaining -= chunk.value.length;
      }
      xml += decoder.decode();
    }
  } finally {
    await reader?.cancel();
  }
  // S3 errors have an Error root. Accept namespace prefixes, whitespace and CDATA
  // without logging the body, raw response headers or unrecognized error codes.
  const root = !truncated && /^\s*(?:<\?xml[^?]*\?>\s*)?<(?:[\w.-]+:)?Error(?:\s[^<>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?Error>\s*$/.exec(xml);
  const code = root ? /<(?:[\w.-]+:)?Code\s*>\s*([A-Za-z][A-Za-z0-9_-]{0,79})\s*<\/(?:[\w.-]+:)?Code\s*>/.exec(root[1])?.[1] ?? '' : '';
  const message = root ? /<(?:[\w.-]+:)?Message\s*>\s*(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))\s*<\/(?:[\w.-]+:)?Message\s*>/.exec(root[1]) : null;
  const reason = (message?.[1] ?? message?.[2] ?? '').trim();
  return {
    status, code: KNOWN_CODES.has(code) ? code : 'UnknownS3Code', codePresent: !!code,
    expired: /^(?:(?:the )?(?:presigned (?:url|request)|request|signature|url) (?:has expired|is expired)|(?:the )?request is already expired)[.!]?$/i.test(reason),
    missingSignedHeader: /\b(?:missing|not (?:present|included))\b/i.test(reason)
      && /\b(?:signed header|if-none-match)\b/i.test(reason),
    contentType: contentTypeKind(response.headers.get('Content-Type')),
    bodyFormat: status < 400 ? 'unread' : truncated ? 'truncated' : root ? 's3-xml' : xml.trim() ? 'opaque' : 'empty',
  };
}

export function signatureRejected(reply: S3Reply, missingHeader = false): boolean {
  return (reply.status === 403 && reply.code === 'SignatureDoesNotMatch')
    || (missingHeader && [400, 403].includes(reply.status) && reply.missingSignedHeader
      && ['InvalidArgument', 'AuthorizationQueryParametersError', 'AccessDenied'].includes(reply.code));
}

export function expiryRejected(reply: S3Reply): boolean {
  return reply.status === 403 && (reply.code === 'RequestExpired'
    || (reply.code === 'AccessDenied' && reply.expired));
}

// Only eligible for a before/after comparison of the same authorized request.
// Explicit wrong-signature, credential, clock and permission errors are excluded.
export function expiryNeedsControl(reply: S3Reply): boolean {
  return reply.status === 403 && reply.code === 'UnknownS3Code';
}

export function writeOnceRejected(reply: S3Reply): boolean {
  return reply.status === 412 && reply.code === 'PreconditionFailed';
}

export function anonymousRejected(reply: S3Reply): boolean {
  return (reply.status === 403 && reply.code === 'AccessDenied')
    || (reply.status === 401 && reply.code === 'Unauthorized');
}
