import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

const app = new Hono<AppEnv>();
app.use('*', requireAuth);

app.post('/', async c => {
  try {
    const prisma = c.get('prisma');
    const { code, label, year, start_date, end_date } = await c.req.json();
    if (!code?.trim()) return c.json({ error: 'code required' }, 400);
    if (!year) return c.json({ error: 'year required' }, 400);

    const campaign = await prisma.campaigns.create({
      data: {
        code: code.trim().toUpperCase(),
        label: label?.trim() || null,
        year: Number(year),
        start_date: start_date ? new Date(start_date) : null,
        end_date: end_date ? new Date(end_date) : null,
      },
    });
    return c.json(campaign, 201);
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === 'P2002') return c.json({ error: 'แคมเปญนี้มีอยู่แล้ว' }, 409);
    console.error(err);
    return c.json({ error: 'failed to create campaign' }, 500);
  }
});

export default app;
