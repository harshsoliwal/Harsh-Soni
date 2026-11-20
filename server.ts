import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { fetchLiveMcxRates } from './src/server/mcxRates.ts';
import { calculateBullionPricing, getMcxRatePerUnit } from './src/lib/pricing.ts';
import type { MetalType, PurityGrade } from './src/types/bullion.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin strictly for stateless ID token verification (requires zero IAM)
function getAdminAuth() {
  const configPath = path.resolve(__dirname, 'firebase-applet-config.json');
  let projectId = process.env.FIREBASE_PROJECT_ID || '';
  if (fs.existsSync(configPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as { projectId?: string };
      if (parsed.projectId && parsed.projectId !== 'remixed-project-id') {
        projectId = parsed.projectId;
      }
    } catch {
      // ignore parse errors
    }
  }
  const app = getApps().length ? getApp() : initializeApp(projectId ? { projectId } : {});
  return getAuth(app);
}

async function verifyBearerToken(req: express.Request): Promise<{
  uid: string;
  email?: string;
  emailVerified: boolean;
} | null> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return null;
  }
  const token = header.slice('Bearer '.length).trim();
  if (!token) return null;
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    return {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: Boolean(decoded.email_verified),
    };
  } catch {
    return null;
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '1mb' }));

  // Health endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'BullionBridge', timestamp: new Date().toISOString() });
  });

  // Live public MCX Gold & Silver rate endpoint (no paid API key required)
  app.get('/api/rates/mcx', async (req, res) => {
    const forceRefresh = req.query.refresh === 'true';
    const result = await fetchLiveMcxRates(forceRefresh);

    if (!result.rate) {
      res.status(503).json({
        ok: false,
        status: 'unavailable',
        rate: null,
        error: result.error,
      });
      return;
    }

    res.status(200).json({
      ok: result.ok,
      status: result.rate.status,
      rate: result.rate,
      warning: result.error,
    });
  });

  // Protected endpoint: Verifies caller's Firebase ID token and computes server-authoritative
  // live MCX rate lock breakdown for supplier confirmation (cannot trust frontend-supplied rates)
  app.post('/api/orders/verify-lock-rate', async (req, res) => {
    const caller = await verifyBearerToken(req);
    if (!caller) {
      res.status(401).json({ error: 'Unauthorized: valid Firebase ID token required.' });
      return;
    }
    if (!caller.emailVerified) {
      res.status(403).json({ error: 'Email verification is required to lock live bullion rates.' });
      return;
    }

    const {
      metal,
      purity,
      weightGrams,
      supplierPremiumPerUnitInr,
      platformCommissionRatePct,
      gstRatePct,
      manualOverrideRatePerUnit,
    } = req.body as {
      metal?: MetalType;
      purity?: PurityGrade;
      weightGrams?: number;
      supplierPremiumPerUnitInr?: number;
      platformCommissionRatePct?: number;
      gstRatePct?: number;
      manualOverrideRatePerUnit?: number;
    };

    if (
      (metal !== 'GOLD' && metal !== 'SILVER') ||
      (purity !== '999' && purity !== '995') ||
      typeof weightGrams !== 'number' ||
      weightGrams <= 0 ||
      typeof supplierPremiumPerUnitInr !== 'number' ||
      typeof platformCommissionRatePct !== 'number' ||
      typeof gstRatePct !== 'number'
    ) {
      res.status(400).json({ error: 'Invalid bullion lock calculation parameters.' });
      return;
    }

    let mcxBaseRatePerUnit: number;
    let rateSource: string;

    if (typeof manualOverrideRatePerUnit === 'number' && manualOverrideRatePerUnit > 0) {
      mcxBaseRatePerUnit = manualOverrideRatePerUnit;
      rateSource = 'Super Admin Manual Reference Rate';
    } else {
      const liveResult = await fetchLiveMcxRates(false);
      if (!liveResult.rate) {
        res.status(503).json({
          error:
            'Live MCX rate feed is currently unavailable and no manual override is active. Cannot lock rate without verified reference price.',
        });
        return;
      }
      mcxBaseRatePerUnit = getMcxRatePerUnit(liveResult.rate, metal, purity);
      rateSource = liveResult.rate.source;
    }

    const breakdown = calculateBullionPricing({
      metal,
      purity,
      weightGrams,
      mcxBaseRatePerUnit,
      supplierPremiumPerUnitInr,
      platformCommissionRatePct,
      gstRatePct,
    });

    res.json({
      ok: true,
      verifiedByUid: caller.uid,
      rateSource,
      capturedAt: new Date().toISOString(),
      breakdown,
    });
  });

  // Protected token verification helper endpoint
  app.get('/api/auth/verify', async (req, res) => {
    const caller = await verifyBearerToken(req);
    if (!caller) {
      res.status(401).json({ ok: false, error: 'Invalid or missing Firebase ID token.' });
      return;
    }
    res.json({ ok: true, uid: caller.uid, email: caller.email, emailVerified: caller.emailVerified });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`BullionBridge server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
