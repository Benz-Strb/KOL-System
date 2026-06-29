import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createPrismaClient } from './prisma.js';
import type { AppEnv } from './types.js';
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
import calendarRouter from './routes/calendar.js';

// Prisma $queryRaw returns PostgreSQL integers as BigInt — patch for JSON serialization
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

const app = new Hono<AppEnv>();

app.use('*', async (c, next) => {
  const corsMiddleware = cors({ origin: c.env.CLIENT_ORIGIN ?? 'http://localhost:5173', credentials: true });
  return corsMiddleware(c, next);
});

app.use('*', async (c, next) => {
  c.set('prisma', createPrismaClient(c.env.HYPERDRIVE.connectionString));
  await next();
});

app.get('/', c => c.json({ ok: true, service: 'KOL System API' }));
app.get('/health', c => c.json({ ok: true }));

app.get('/api/_dbcheck', async c => {
  try {
    const prisma = c.get('prisma');
    const rows = await prisma.$queryRaw<{ placements: number }[]>`
      select count(*)::int as placements from placements`;
    return c.json({ ok: true, placements: rows[0]?.placements ?? 0 });
  } catch (err) {
    console.error(err);
    return c.json({ ok: false, error: 'db connection failed' }, 500);
  }
});

app.route('/api/auth', authRouter);
app.route('/api/admin', adminRouter);
app.route('/api/dropdowns', dropdownsRouter);
app.route('/api/products', productsRouter);
app.route('/api/shops', shopsRouter);
app.route('/api/kols', kolsRouter);
app.route('/api/placements/import', placementsImportRouter);
app.route('/api/placements', placementsRouter);
app.route('/api/campaigns', campaignsRouter);
app.route('/api/samples', samplesRouter);
app.route('/api/dashboard', dashboardRouter);
app.route('/api/calendar', calendarRouter);

export default app;
