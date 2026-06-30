import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

const app = new Hono<AppEnv>();
app.use('*', requireAuth);

app.post('/', async c => {
  try {
    const prisma = c.get('prisma');
    const body = await c.req.json<{ name?: string }>();
    const name = (body.name ?? '').trim();
    if (!name) return c.json({ error: 'name_required' }, 400);

    const existing = await prisma.product_categories.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });

    if (existing) {
      if (existing.active) return c.json({ error: 'duplicate' }, 409);
      // Reactivate soft-deleted category
      const reactivated = await prisma.product_categories.update({
        where: { id: existing.id },
        data: { active: true, name },
        select: { id: true, name: true },
      });
      return c.json(reactivated, 201);
    }

    const created = await prisma.product_categories.create({
      data: { name, active: true },
      select: { id: true, name: true },
    });
    return c.json(created, 201);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to create category' }, 500);
  }
});

app.patch('/:id', async c => {
  try {
    const user = c.get('user');
    if (user.role !== 'admin') return c.json({ error: 'forbidden' }, 403);

    const prisma = c.get('prisma');
    const id = Number(c.req.param('id'));
    const body = await c.req.json<{ name?: string }>();
    const name = (body.name ?? '').trim();
    if (!name) return c.json({ error: 'name_required' }, 400);

    const duplicate = await prisma.product_categories.findFirst({
      where: { name: { equals: name, mode: 'insensitive' }, id: { not: id }, active: true },
    });
    if (duplicate) return c.json({ error: 'duplicate' }, 409);

    const updated = await prisma.product_categories.update({
      where: { id },
      data: { name },
      select: { id: true, name: true },
    });
    return c.json(updated);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to update category' }, 500);
  }
});

app.delete('/:id', async c => {
  try {
    const user = c.get('user');
    if (user.role !== 'admin') return c.json({ error: 'forbidden' }, 403);

    const prisma = c.get('prisma');
    const id = Number(c.req.param('id'));
    await prisma.product_categories.update({
      where: { id },
      data: { active: false },
    });
    return c.json({ ok: true });
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to delete category' }, 500);
  }
});

export default app;
