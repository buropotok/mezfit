import { describe, expect, it } from 'vitest';
import { anonymousRejected, readS3Reply } from './smoke-http';

function s3(status, code, contentType = 'application/xml') {
  return new Response(
    '<Error><Code>' + code + '</Code><Message>Request rejected</Message></Error>',
    { status, headers: { 'Content-Type': contentType } },
  );
}

describe('migration anonymous R2 S3 GET refusal', () => {
  it('accepts the actual R2 response: HTTP 400 with a valid XML S3 InvalidArgument error', async () => {
    const reply = await readS3Reply(s3(400, 'InvalidArgument'));
    expect(reply).toMatchObject({
      status: 400, code: 'InvalidArgument', contentType: 'xml',
      bodyFormat: 's3-xml', codePresent: true,
    });
    expect(anonymousRejected(reply)).toBe(true);
  });

  it('still recognizes explicit unauthenticated S3 denials', async () => {
    expect(anonymousRejected(await readS3Reply(s3(401, 'Unauthorized')))).toBe(true);
    expect(anonymousRejected(await readS3Reply(s3(403, 'AccessDenied')))).toBe(true);
  });

  it.each([
    ['successful object response', new Response('object-bytes', { status: 200 })],
    ['partial object response', new Response('object-bytes', { status: 206 })],
    ['redirect', new Response(null, { status: 302, headers: { Location: 'https://example.test/object' } })],
    ['unrelated S3 bad request', s3(400, 'InvalidToken')],
    ['missing object', s3(404, 'NoSuchKey')],
    ['signature failure', s3(403, 'SignatureDoesNotMatch')],
    ['non-S3 HTML page', new Response('<html><Code>InvalidArgument</Code></html>',
      { status: 400, headers: { 'Content-Type': 'text/html' } })],
    ['XML with a non-S3 root', new Response('<Other><Code>InvalidArgument</Code></Other>',
      { status: 400, headers: { 'Content-Type': 'application/xml' } })],
    ['S3-shaped error with wrong content type', s3(400, 'InvalidArgument', 'text/html')],
    ['empty error response', new Response(null, { status: 400, headers: { 'Content-Type': 'application/xml' } })],
  ])('does not confuse %s with a verified anonymous S3 refusal', async (_label, response) => {
    expect(anonymousRejected(await readS3Reply(response))).toBe(false);
  });
});
