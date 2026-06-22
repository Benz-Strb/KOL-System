import { Router } from 'express';
import { prisma } from '../prisma.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const isAdmin = req.user!.role === 'admin';
    const seesAllBrands = isAdmin || req.user!.role === 'manager';
    const userBrandIds = req.user!.brandIds;

    const [platforms, contentCategories, users, campaigns, brands] = await Promise.all([
      prisma.platforms.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
      prisma.content_categories.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
      prisma.users.findMany({
        where: {
          role: 'marketing',
          user_brands: { some: { brand_id: { in: userBrandIds } } },
        },
        orderBy: [{ is_active: 'desc' }, { full_name: 'asc' }],
        select: { id: true, full_name: true, is_active: true },
      }),
      prisma.campaigns.findMany({
        where: { year: new Date().getFullYear() },
        orderBy: { start_date: 'asc' },
      }),
      prisma.brands.findMany({
        where: {
          active: true,
          ...(seesAllBrands ? {} : { id: { in: userBrandIds } }),
        },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
    ]);

    res.json({ platforms, contentCategories, users, campaigns, brands });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to load dropdowns' });
  }
});

export default router;
