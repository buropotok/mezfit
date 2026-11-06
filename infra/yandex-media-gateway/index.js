'use strict';

// Closed bootstrap version. Media signing is deliberately unavailable until
// identity, coach-client realm and anchor authorization are implemented server-side.
exports.handler = async function handler() {
  return {
    statusCode: 503,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
    isBase64Encoded: false,
    body: JSON.stringify({ code: 'MEDIA_GATEWAY_NOT_CONFIGURED' }),
  };
};
