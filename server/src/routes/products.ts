import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

const app = new Hono<AppEnv>();
app.use('*', requireAuth);

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const EXT_MAP: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

app.post('/image', async c => {
  try {
    const env = c.env;
    const body = await c.req.parseBody();
    const file = body['file'];
    if (!(file instanceof File)) return c.json({ error: 'file_required' }, 400);
    if (!ALLOWED_MIME.has(file.type)) return c.json({ error: 'invalid_type' }, 400);
    if (file.size > 2 * 1024 * 1024) return c.json({ error: 'too_large' }, 400);

    const ext = EXT_MAP[file.type];
    const path = `products/${crypto.randomUUID()}.${ext}`;
    const upRes = await fetch(
      `${env.SUPABASE_URL}/storage/v1/object/product-images/${path}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': file.type,
          'x-upsert': 'false',
        },
        body: await file.arrayBuffer(),
      },
    );
    if (!upRes.ok) {
      console.error('Storage upload failed', upRes.status, await upRes.text());
      return c.json({ error: 'upload_failed' }, 502);
    }
    const publicUrl = `${env.SUPABASE_URL}/storage/v1/object/public/product-images/${path}`;
    return c.json({ url: publicUrl }, 201);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'upload_error' }, 500);
  }
});

app.get('/', async c => {
  try {
    const prisma = c.get('prisma');
    const brand_id = c.req.query('brand_id');
    const rows = brand_id
      ? await prisma.$queryRaw<{ id: number; model_code: string }[]>`
          SELECT DISTINCT pd.id, pd.model_code
          FROM products_dropdown pd
          JOIN products p ON p.id = pd.id
          WHERE p.brand_id = ${Number(brand_id)}
             OR pd.id IN (
               SELECT product_id FROM placements
               WHERE brand_id = ${Number(brand_id)} AND product_id IS NOT NULL
             )
          ORDER BY pd.model_code`
      : await prisma.$queryRaw<{ id: number; model_code: string }[]>`
          SELECT id, model_code FROM products_dropdown ORDER BY model_code`;
    return c.json(rows);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to load products' }, 500);
  }
});

app.post('/', async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const body = await c.req.json<{
      model_code?: string;
      brand_id?: number;
      product_category_id?: number | null;
      image_url?: string | null;
    }>();

    const model_code = (body.model_code ?? '').trim();
    if (!model_code) {
      return c.json({ error: 'model_code is required' }, 400);
    }

    const brand_id = body.brand_id;
    if (!brand_id) {
      return c.json({ error: 'brand_id is required' }, 400);
    }

    // Check brand exists
    const brand = await prisma.brands.findUnique({ where: { id: brand_id } });
    if (!brand) {
      return c.json({ error: 'brand not found' }, 400);
    }

    // Non-admin must belong to the brand
    if (user.role !== 'admin' && !user.brandIds.includes(brand_id)) {
      return c.json({ error: 'forbidden' }, 403);
    }

    // Check duplicate model_code
    const existing = await prisma.products.findUnique({ where: { model_code } });
    if (existing) {
      return c.json({ error: 'duplicate', message: 'model code นี้มีอยู่แล้ว' }, 409);
    }

    const product = await prisma.products.create({
      data: {
        model_code,
        brand_id,
        product_category_id: body.product_category_id ?? null,
        image_url: body.image_url ?? null,
        is_canonical: true,
        active: true,
      },
      select: { id: true, model_code: true },
    });

    return c.json(product, 201);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to create product' }, 500);
  }
});

export default app;
