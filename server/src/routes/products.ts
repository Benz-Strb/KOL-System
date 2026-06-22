import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

const app = new Hono<AppEnv>();
app.use('*', requireAuth);

app.get('/', async c => {
  try {
    const prisma = c.get('prisma');
    const brand_id = c.req.query('brand_id');
    const rows = brand_id
      ? await prisma.$queryRaw<{ id: number; model_code: string }[]>`
          SELECT DISTINCT pd.id, pd.model_code
          FROM products_dropdown pd
          JOIN placements pl ON pl.product_id = pd.id
          WHERE pl.brand_id = ${Number(brand_id)}
          ORDER BY pd.model_code`
      : await prisma.$queryRaw<{ id: number; model_code: string }[]>`
          SELECT id, model_code FROM products_dropdown ORDER BY model_code`;
    return c.json(rows);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to load products' }, 500);
  }
});

export default app;
