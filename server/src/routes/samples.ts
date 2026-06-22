import { Hono } from 'hono';
import { Prisma } from '@prisma/client';
import { requireAuth } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

const app = new Hono<AppEnv>();
app.use('*', requireAuth);

app.get('/', async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const kol_id = c.req.query('kol_id');
    const brand_id = c.req.query('brand_id');
    const product_id = c.req.query('product_id');
    const status = c.req.query('status');
    const page = c.req.query('page') ?? '1';
    const TAKE = 25;
    const skip = (Number(page) - 1) * TAKE;

    const isAdmin = user.role === 'admin';
    const where: Prisma.kol_samplesWhereInput = {};

    if (kol_id) where.kol_id = Number(kol_id);
    if (product_id) where.product_id = Number(product_id);
    if (status) where.sample_status = status;

    if (brand_id) {
      const bid = Number(brand_id);
      where.brand_id = isAdmin || user.brandIds.includes(bid) ? bid : { in: user.brandIds };
    } else if (!isAdmin) {
      where.brand_id = { in: user.brandIds };
    }

    const [total, rows] = await Promise.all([
      prisma.kol_samples.count({ where }),
      prisma.kol_samples.findMany({
        where,
        include: {
          kols: { select: { id: true, handle: true, gen_name: true, avatar_url: true, platforms: { select: { name: true } } } },
          brands: { select: { id: true, name: true } },
          products: { select: { id: true, model_code: true } },
        },
        orderBy: { created_at: 'desc' },
        take: TAKE,
        skip,
      }),
    ]);

    return c.json({ total, page: Number(page), limit: TAKE, rows });
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to load samples' }, 500);
  }
});

app.post('/', async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const { kol_id, placement_id, brand_id, product_id, sample_status, return_policy, notes } = await c.req.json();
    if (!kol_id) return c.json({ error: 'kol_id required' }, 400);

    const isAdmin = user.role === 'admin';
    const bid = brand_id ? Number(brand_id) : user.brandIds[0];
    if (!bid && !isAdmin) return c.json({ error: 'brand_id required' }, 400);
    if (!isAdmin && bid && !user.brandIds.includes(bid)) {
      return c.json({ error: 'No access to this brand' }, 403);
    }

    const sample = await prisma.kol_samples.create({
      data: {
        kol_id: Number(kol_id),
        placement_id: placement_id ? Number(placement_id) : null,
        brand_id: bid ?? null,
        product_id: product_id ? Number(product_id) : null,
        sample_status: sample_status || 'to_be_shipped',
        return_policy: return_policy || 'no_return_required',
        notes: notes?.trim() || null,
      },
      include: {
        kols: { select: { id: true, handle: true, gen_name: true, avatar_url: true, platforms: { select: { name: true } } } },
        brands: { select: { id: true, name: true } },
        products: { select: { id: true, model_code: true } },
      },
    });
    return c.json(sample, 201);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to create sample' }, 500);
  }
});

app.patch('/:id', async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const id = Number(c.req.param('id'));

    if (user.role !== 'admin') {
      const existing = await prisma.kol_samples.findUnique({ where: { id }, select: { brand_id: true } });
      if (!existing) return c.json({ error: 'not found' }, 404);
      if (existing.brand_id != null && !user.brandIds.includes(existing.brand_id)) {
        return c.json({ error: 'No access' }, 403);
      }
    }

    const { sample_status, return_policy, shipped_at, signed_at, notes } = await c.req.json();

    const sample = await prisma.kol_samples.update({
      where: { id },
      data: {
        ...(sample_status !== undefined && { sample_status }),
        ...(return_policy !== undefined && { return_policy }),
        ...(shipped_at !== undefined && { shipped_at: shipped_at ? new Date(shipped_at) : null }),
        ...(signed_at !== undefined && { signed_at: signed_at ? new Date(signed_at) : null }),
        ...(notes !== undefined && { notes: notes?.trim() || null }),
      },
      include: {
        kols: { select: { id: true, handle: true, gen_name: true, avatar_url: true, platforms: { select: { name: true } } } },
        brands: { select: { id: true, name: true } },
        products: { select: { id: true, model_code: true } },
      },
    });
    return c.json(sample);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to update sample' }, 500);
  }
});

app.delete('/:id', async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const id = Number(c.req.param('id'));
    if (user.role !== 'admin') {
      const existing = await prisma.kol_samples.findUnique({ where: { id }, select: { brand_id: true } });
      if (!existing) return c.json({ error: 'not found' }, 404);
      if (existing.brand_id != null && !user.brandIds.includes(existing.brand_id)) {
        return c.json({ error: 'No access' }, 403);
      }
    }
    await prisma.kol_samples.delete({ where: { id } });
    return c.json({ ok: true });
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to delete sample' }, 500);
  }
});

export default app;
