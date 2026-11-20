import { buildUnitConversions, roundInr } from '../lib/pricing.ts';
import type { LiveMcxRate } from '../types/bullion.ts';

const TROY_OUNCE_IN_GRAMS = 31.1034768;
// Indian MCX bullion import parity: customs duty + AIDC (6.0%) reflecting Jaipur MCX landed basis
const INDIA_MCX_PARITY_MULTIPLIER = 1.06;
const CACHE_TTL_MS = 45_000;
const MIN_FORCE_REFRESH_MS = 10_000;

interface CachedRateState {
  rate: LiveMcxRate;
  fetchedAtMs: number;
}

let cachedState: CachedRateState | null = null;

async function fetchJsonWithTimeout(url: string, timeoutMs = 6000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BullionBridgeMCX/1.0)',
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function extractYahooPrice(payload: unknown): number | null {
  const data = payload as {
    chart?: {
      result?: Array<{
        meta?: { regularMarketPrice?: number; previousClose?: number };
      }>;
    };
  };
  const meta = data?.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice ?? meta?.previousClose;
  return typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null;
}

/**
 * Primary public no-API-key source: Yahoo Finance public commodity & INR FX charts
 * GC=F (COMEX Gold Futures USD/oz), SI=F (COMEX Silver Futures USD/oz), INR=X (USD/INR)
 */
async function fetchFromYahooPublic(): Promise<{
  xauUsd: number;
  xagUsd: number;
  usdInr: number;
  source: string;
}> {
  const [goldJson, silverJson, fxJson] = await Promise.all([
    fetchJsonWithTimeout('https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1d'),
    fetchJsonWithTimeout('https://query1.finance.yahoo.com/v8/finance/chart/SI=F?interval=1m&range=1d'),
    fetchJsonWithTimeout('https://query1.finance.yahoo.com/v8/finance/chart/INR=X?interval=1m&range=1d'),
  ]);

  const xauUsd = extractYahooPrice(goldJson);
  const xagUsd = extractYahooPrice(silverJson);
  const usdInr = extractYahooPrice(fxJson);

  if (!xauUsd || !xagUsd || !usdInr) {
    throw new Error('Incomplete commodity/FX quote from Yahoo public feed');
  }

  return {
    xauUsd: roundInr(xauUsd),
    xagUsd: roundInr(xagUsd),
    usdInr: roundInr(usdInr),
    source: 'Live Public Commodity & INR Parity (MCX Equivalent)',
  };
}

/**
 * Secondary public no-API-key source: gold-api.com + open.er-api.com
 */
async function fetchFromGoldApiPublic(): Promise<{
  xauUsd: number;
  xagUsd: number;
  usdInr: number;
  source: string;
}> {
  const [goldJson, silverJson, fxJson] = await Promise.all([
    fetchJsonWithTimeout('https://api.gold-api.com/price/XAU'),
    fetchJsonWithTimeout('https://api.gold-api.com/price/XAG'),
    fetchJsonWithTimeout('https://open.er-api.com/v6/latest/USD'),
  ]);

  const xauUsd = (goldJson as { price?: number })?.price;
  const xagUsd = (silverJson as { price?: number })?.price;
  const usdInr = (fxJson as { rates?: { INR?: number } })?.rates?.INR;

  if (
    typeof xauUsd !== 'number' ||
    typeof xagUsd !== 'number' ||
    typeof usdInr !== 'number' ||
    xauUsd <= 0 ||
    xagUsd <= 0 ||
    usdInr <= 0
  ) {
    throw new Error('Incomplete quote from public spot bullion fallback');
  }

  return {
    xauUsd: roundInr(xauUsd),
    xagUsd: roundInr(xagUsd),
    usdInr: roundInr(usdInr),
    source: 'Live Public Spot XAU/XAG & USD/INR (MCX Parity)',
  };
}

function computeMcxInrRates(raw: {
  xauUsd: number;
  xagUsd: number;
  usdInr: number;
  source: string;
}): LiveMcxRate {
  const goldPerGramInr = (raw.xauUsd / TROY_OUNCE_IN_GRAMS) * raw.usdInr * INDIA_MCX_PARITY_MULTIPLIER;
  const silverPerGramInr = (raw.xagUsd / TROY_OUNCE_IN_GRAMS) * raw.usdInr * INDIA_MCX_PARITY_MULTIPLIER;

  const gold999Per10g = roundInr(goldPerGramInr * 10);
  const silver999Per1kg = roundInr(silverPerGramInr * 1000);
  const conversions = buildUnitConversions(gold999Per10g, silver999Per1kg);

  return {
    ...conversions,
    usdInr: raw.usdInr,
    xauUsd: raw.xauUsd,
    xagUsd: raw.xagUsd,
    source: raw.source,
    isDelayed: false,
    isManualOverride: false,
    lastUpdatedAt: new Date().toISOString(),
    cacheAgeSeconds: 0,
    status: 'live',
  };
}

/**
 * Fetches live public MCX-equivalent Gold & Silver bullion rates without paid APIs.
 * Resilience & Honesty Guardrail:
 * - Caches live responses for 45 seconds.
 * - If upstream public feeds fail, NEVER fabricates fake live numbers.
 *   Returns the last real cached rate flagged as `isDelayed: true` (`status: 'delayed'`),
 *   or `null` (`status: 'unavailable'`) so the frontend falls back to Firestore's last
 *   cached rate or Super Admin's manual override with a clear Delayed/Manual indicator.
 */
export async function fetchLiveMcxRates(forceRefresh = false): Promise<{
  ok: boolean;
  rate: LiveMcxRate | null;
  error?: string;
}> {
  const now = Date.now();

  if (cachedState) {
    const ageMs = now - cachedState.fetchedAtMs;
    const withinTtl = ageMs < CACHE_TTL_MS;
    const tooSoonToForce = forceRefresh && ageMs < MIN_FORCE_REFRESH_MS;
    if (withinTtl && (!forceRefresh || tooSoonToForce)) {
      return {
        ok: true,
        rate: {
          ...cachedState.rate,
          cacheAgeSeconds: Math.floor(ageMs / 1000),
        },
      };
    }
  }

  let lastErr = '';
  try {
    const raw = await fetchFromYahooPublic();
    const rate = computeMcxInrRates(raw);
    cachedState = { rate, fetchedAtMs: now };
    return { ok: true, rate };
  } catch (err) {
    lastErr = err instanceof Error ? err.message : String(err);
  }

  try {
    const raw = await fetchFromGoldApiPublic();
    const rate = computeMcxInrRates(raw);
    cachedState = { rate, fetchedAtMs: now };
    return { ok: true, rate };
  } catch (err) {
    lastErr = `${lastErr}; Fallback: ${err instanceof Error ? err.message : String(err)}`;
  }

  // Strict Honesty Guardrail: never fabricate live rates when upstream fails
  if (cachedState) {
    const ageSeconds = Math.floor((now - cachedState.fetchedAtMs) / 1000);
    return {
      ok: false,
      rate: {
        ...cachedState.rate,
        isDelayed: true,
        status: 'delayed',
        cacheAgeSeconds: ageSeconds,
        source: `${cachedState.rate.source} (Delayed Cache)`,
      },
      error: `Live public feed temporarily unavailable (${lastErr}). Displaying last cached reference rate.`,
    };
  }

  return {
    ok: false,
    rate: null,
    error: `Live public MCX sources are temporarily unreachable (${lastErr}). Use last Firestore cached rate or Admin Manual Reference Rate.`,
  };
}
