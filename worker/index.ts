interface Env { DB_BINDING: D1Database; ASSETS: Fetcher }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') {
      try {
        const result = await env.DB_BINDING.prepare('SELECT 1 AS ok').first<{ ok: number }>();
        return Response.json({ ok: result?.ok === 1, service: 'mezfit', d1: result?.ok === 1 ? 'connected' : 'unexpected' });
      } catch (error) {
        return Response.json({ ok: false, service: 'mezfit', d1: 'error', error: error instanceof Error ? error.message : String(error) }, { status: 500 });
      }
    }
    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;
