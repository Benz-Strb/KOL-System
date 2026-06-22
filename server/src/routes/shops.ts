import { Router } from 'express';
import { prisma } from '../prisma.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const rows = await prisma.$queryRaw<{ name: string; has_branches: boolean }[]>`
      SELECT * FROM shops_dropdown ORDER BY name`;
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to load shops' });
  }
});

router.get('/branches', async (req, res) => {
  try {
    const { shop } = req.query as { shop?: string };
    if (!shop) return res.status(400).json({ error: 'shop required' });
    const rows = await prisma.$queryRaw<{ id: number; name: string; branch: string | null }[]>`
      SELECT store_id AS id, name, branch FROM store_branches WHERE name = ${shop} ORDER BY branch`;
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to load branches' });
  }
});

router.post('/branches', async (req, res) => {
  try {
    const { shop_name, branch } = req.body;
    if (!shop_name?.trim()) return res.status(400).json({ error: 'shop_name required' });
    if (!branch?.trim()) return res.status(400).json({ error: 'branch required' });

    const store = await prisma.stores.create({
      data: { name: shop_name.trim(), branch: branch.trim() },
    });
    res.status(201).json(store);
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === 'P2002') return res.status(409).json({ error: 'สาขานี้มีอยู่แล้ว' });
    console.error(err);
    res.status(500).json({ error: 'failed to create branch' });
  }
});

export default router;
