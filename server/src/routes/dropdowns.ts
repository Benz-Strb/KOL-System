import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

const app = new Hono<AppEnv>();
app.use('*', requireAuth);

app.get('/', async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const isAdmin = user.role === 'admin';
    const seesAllBrands = isAdmin || user.role === 'manager';
    const userBrandIds = user.brandIds;

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

    return c.json({ platforms, contentCategories, users, campaigns, brands });
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to load dropdowns' }, 500);
  }
});

export default app;
