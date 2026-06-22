import 'dotenv/config';
import express from 'express';

// Prisma $queryRaw returns PostgreSQL integers as BigInt — patch for JSON serialization
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};
import cors from 'cors';
import { prisma } from './prisma.js';
import { requireAuth } from './middleware/auth.js';
import dropdownsRouter from './routes/dropdowns.js';
import productsRouter from './routes/products.js';
import shopsRouter from './routes/shops.js';
import kolsRouter from './routes/kols.js';
import placementsRouter from './routes/placements.js';
import placementsImportRouter from './routes/placementsImport.js';
import campaignsRouter from './routes/campaigns.js';
import adminRouter from './routes/admin.js';
import authRouter from './routes/auth.js';
import samplesRouter from './routes/samples.js';
import dashboardRouter from './routes/dashboard.js';

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173', credentials: true }));
app.use(express.json());

app.get('/', (_req, res) => res.json({ ok: true, service: 'KOL System API' }));
app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/api/_dbcheck', async (_req, res) => {
  try {
    const rows = await prisma.$queryRaw<{ placements: number }[]>`
      select count(*)::int as placements from placements`;
    res.json({ ok: true, placements: rows[0]?.placements ?? 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'db connection failed' });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/dropdowns', requireAuth, dropdownsRouter);
app.use('/api/products', requireAuth, productsRouter);
app.use('/api/shops', requireAuth, shopsRouter);
app.use('/api/kols', requireAuth, kolsRouter);
app.use('/api/placements/import', requireAuth, placementsImportRouter);
app.use('/api/placements', requireAuth, placementsRouter);
app.use('/api/campaigns', requireAuth, campaignsRouter);
app.use('/api/samples', requireAuth, samplesRouter);
app.use('/api/dashboard', dashboardRouter);

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`server on http://localhost:${port}`));
