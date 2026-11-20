import type { IncomingMessage, ServerResponse } from 'http';
import { fetchLiveMcxRates } from '../../src/server/mcxRates.ts';

/**
 * Vercel Serverless API Route: GET /api/rates/mcx
 * Fetches live public MCX-linked Gold & Silver rates with zero paid API keys.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');

  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const url = new URL(req.url || '/api/rates/mcx', 'http://localhost');
  const forceRefresh = url.searchParams.get('refresh') === 'true';

  const result = await fetchLiveMcxRates(forceRefresh);
  if (!result.rate) {
    res.statusCode = 503;
    res.end(
      JSON.stringify({
        ok: false,
        status: 'unavailable',
        rate: null,
        error: result.error,
      })
    );
    return;
  }

  res.statusCode = 200;
  res.end(
    JSON.stringify({
      ok: result.ok,
      status: result.rate.status,
      rate: result.rate,
      warning: result.error,
    })
  );
}
