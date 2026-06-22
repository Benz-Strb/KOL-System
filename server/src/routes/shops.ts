import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

const app = new Hono<AppEnv>();
app.use('*', requireAuth);

app.get('/', async c => {
  try {
    const prisma = c.get('prisma');
    const rows = await prisma.$queryRaw<{ name: string; has_branches: boolean }[]>`
      SELECT * FROM shops_dropdown ORDER BY name`;
    return c.json(rows);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to load shops' }, 500);
  }
});

app.get('/branches', async c => {
  try {
    const prisma = c.get('prisma');
    const shop = c.req.query('shop');
    if (!shop) return c.json({ error: 'shop required' }, 400);
    const rows = await prisma.$queryRaw<{ id: number; name: string; branch: string | null }[]>`
      SELECT store_id AS id, name, branch FROM store_branches WHERE name = ${shop} ORDER BY branch`;
    return c.json(rows);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to load branches' }, 500);
  }
});

app.post('/branches', async c => {
  try {
    const prisma = c.get('prisma');
    const { shop_name, branch } = await c.req.json();
    if (!shop_name?.trim()) return c.json({ error: 'shop_name required' }, 400);
    if (!branch?.trim()) return c.json({ error: 'branch required' }, 400);

    const store = await prisma.stores.create({
      data: { name: shop_name.trim(), branch: branch.trim() },
    });
    return c.json(store, 201);
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === 'P2002') return c.json({ error: 'สาขานี้มีอยู่แล้ว' }, 409);
    console.error(err);
    return c.json({ error: 'failed to create branch' }, 500);
  }
});

export default app;
