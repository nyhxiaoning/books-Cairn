export interface Env {
  readonly DB: D1Database;
  readonly BOOKS: R2Bucket;
  readonly SESSION_SECRET: string;
}

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: jsonHeaders });

export const app = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/api/health') {
      if (!env.DB || !env.BOOKS) {
        return json({ ok: false, database: 'unavailable', storage: 'unavailable' }, 503);
      }

      return json({ ok: true, database: 'd1', storage: 'r2' });
    }

    return json({ code: 'not_found', message: 'Not found' }, 404);
  },
};

export default app;
