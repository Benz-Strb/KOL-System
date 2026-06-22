import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { kol_id, brand_id, product_id, status, page = '1' } = req.query as Record<string, string>;
    const TAKE = 25;
    const skip = (Number(page) - 1) * TAKE;

    const isAdmin = req.user!.role === 'admin';
    const where: Prisma.kol_samplesWhereInput = {};

    if (kol_id) where.kol_id = Number(kol_id);
    if (product_id) where.product_id = Number(product_id);
    if (status) where.sample_status = status;

    if (brand_id) {
      const bid = Number(brand_id);
      where.brand_id = isAdmin || req.user!.brandIds.includes(bid) ? bid : { in: req.user!.brandIds };
    } else if (!isAdmin) {
      where.brand_id = { in: req.user!.brandIds };
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

    res.json({ total, page: Number(page), limit: TAKE, rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to load samples' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { kol_id, placement_id, brand_id, product_id, sample_status, return_policy, notes } = req.body;
    if (!kol_id) return res.status(400).json({ error: 'kol_id required' });

    const isAdmin = req.user!.role === 'admin';
    const bid = brand_id ? Number(brand_id) : req.user!.brandIds[0];
    if (!bid && !isAdmin) return res.status(400).json({ error: 'brand_id required' });
    if (!isAdmin && bid && !req.user!.brandIds.includes(bid)) {
      return res.status(403).json({ error: 'No access to this brand' });
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
    res.status(201).json(sample);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to create sample' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (req.user!.role !== 'admin') {
      const existing = await prisma.kol_samples.findUnique({ where: { id }, select: { brand_id: true } });
      if (!existing) return res.status(404).json({ error: 'not found' });
      if (existing.brand_id != null && !req.user!.brandIds.includes(existing.brand_id)) {
        return res.status(403).json({ error: 'No access' });
      }
    }

    const { sample_status, return_policy, shipped_at, signed_at, notes } = req.body;

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
    res.json(sample);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to update sample' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (req.user!.role !== 'admin') {
      const existing = await prisma.kol_samples.findUnique({ where: { id }, select: { brand_id: true } });
      if (!existing) return res.status(404).json({ error: 'not found' });
      if (existing.brand_id != null && !req.user!.brandIds.includes(existing.brand_id)) {
        return res.status(403).json({ error: 'No access' });
      }
    }
    await prisma.kol_samples.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to delete sample' });
  }
});

export default router;
