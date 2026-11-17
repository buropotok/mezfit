const KNOWN_CODES = new Set([
  'AccessDenied', 'Unauthorized', 'SignatureDoesNotMatch', 'InvalidArgument', 'AuthorizationQueryParametersError',
  'RequestExpired', 'RequestTimeTooSkewed', 'PreconditionFailed', 'ConditionalRequestConflict', 'MissingContentLength',
  'InvalidAccessKeyId', 'SlowDown', 'ServiceUnavailable', 'NoSuchKey', 'NoSuchBucket',
]);

export interface S3Reply {
  status: number;
  code: string;
  expired: boolean;
  missingSignedHeader: boolean;
}

export async function readS3Reply(response: Response): Promise<S3Reply> {
  const status = response.status;
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let xml = '';
  try {
    if (reader && status >= 400) {
      let remaining = 4096;
      while (remaining > 0) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const bytes = chunk.value.subarray(0, remaining);
        xml += decoder.decode(bytes, { stream: true });
        remaining -= bytes.length;
      }
      xml += decoder.decode();
    }
  } finally {
    await reader?.cancel();
  }
  const code = /<Code>([A-Za-z]+)<\/Code>/.exec(xml)?.[1] ?? '';
  const message = /<Message>([^<]*)<\/Message>/.exec(xml)?.[1] ?? '';
  return { status, code: KNOWN_CODES.has(code) ? code : 'UnknownS3Code',
    expired: /\b(?:request|signature|url|presign(?:ed)?)\b[^.]{0,70}\bexpir(?:ed|ation)\b/i.test(message),
    missingSignedHeader: /\b(?:missing|not (?:present|included))\b/i.test(message)
      && /\b(?:signed header|if-none-match)\b/i.test(message) };
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

export function writeOnceRejected(reply: S3Reply): boolean {
  return reply.status === 412 && reply.code === 'PreconditionFailed';
}

export function anonymousRejected(reply: S3Reply): boolean {
  return (reply.status === 403 && reply.code === 'AccessDenied')
    || (reply.status === 401 && reply.code === 'Unauthorized');
}
