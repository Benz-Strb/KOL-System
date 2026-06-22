import { Router } from 'express';
import { prisma } from '../prisma.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { brand_id } = req.query as { brand_id?: string };
    const rows = brand_id
      ? await prisma.$queryRaw<{ id: number; model_code: string }[]>`
          SELECT DISTINCT pd.id, pd.model_code
          FROM products_dropdown pd
          JOIN placements pl ON pl.product_id = pd.id
          WHERE pl.brand_id = ${Number(brand_id)}
          ORDER BY pd.model_code`
      : await prisma.$queryRaw<{ id: number; model_code: string }[]>`
          SELECT id, model_code FROM products_dropdown ORDER BY model_code`;
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to load products' });
  }
});

export default router;
