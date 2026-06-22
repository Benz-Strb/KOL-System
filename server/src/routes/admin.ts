import { Hono } from 'hono';
import { requireAuth, requireRole, invalidateAuthCache } from '../middleware/auth.js';
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import type { AppEnv } from '../types.js';

const app = new Hono<AppEnv>();
app.use('*', requireAuth, requireRole('admin'));

app.get('/brands', async c => {
  try {
    const prisma = c.get('prisma');
    const brands = await prisma.brands.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, active: true },
    });
    return c.json(brands);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'Database error' }, 500);
  }
});

app.post('/brands', async c => {
  const prisma = c.get('prisma');
  const { name } = await c.req.json() as { name: string };
  if (!name?.trim()) return c.json({ error: 'name จำเป็น' }, 400);
  try {
    const brand = await prisma.brands.create({
      data: { name: name.trim() },
      select: { id: true, name: true, active: true },
    });
    return c.json(brand, 201);
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === 'P2002') return c.json({ error: 'ชื่อแบรนด์นี้มีอยู่แล้ว' }, 409);
    console.error(err);
    return c.json({ error: 'Database error' }, 500);
  }
});

app.patch('/brands/:id', async c => {
  const prisma = c.get('prisma');
  const id = Number(c.req.param('id'));
  const { name, active } = await c.req.json() as { name?: string; active?: boolean };
  try {
    const brand = await prisma.brands.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(active !== undefined ? { active } : {}),
      },
      select: { id: true, name: true, active: true },
    });
    return c.json(brand);
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === 'P2002') return c.json({ error: 'ชื่อแบรนด์นี้มีอยู่แล้ว' }, 409);
    console.error(err);
    return c.json({ error: 'Database error' }, 500);
  }
});

app.get('/users', async c => {
  try {
    const prisma = c.get('prisma');
    const users = await prisma.users.findMany({
      orderBy: { created_at: 'asc' },
      select: {
        id: true, full_name: true, email: true, role: true, is_active: true, created_at: true,
        user_brands: { select: { brands: { select: { id: true, name: true } } } },
      },
    });
    return c.json(users);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'Database error' }, 500);
  }
});

app.post('/users', async c => {
  const prisma = c.get('prisma');
  const { email, full_name, role, password, brand_ids } = await c.req.json() as {
    email: string; full_name: string; role: string; password: string; brand_ids?: number[];
  };

  if (!email || !full_name || !role || !password) {
    return c.json({ error: 'email, full_name, role, password จำเป็นทั้งหมด' }, 400);
  }
  if (password.length < 6) {
    return c.json({ error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' }, 400);
  }

  const supabaseAdmin = getSupabaseAdmin(c.env);
  const { error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { must_change_password: true, full_name },
  });

  if (authError) {
    return c.json({ error: authError.message }, 400);
  }

  try {
    const user = await prisma.users.upsert({
      where: { email },
      update: { full_name, role, is_active: true },
      create: { full_name, email, role, is_active: true },
      select: { id: true, full_name: true, email: true, role: true, is_active: true },
    });

    const brandIdsToAssign = Array.isArray(brand_ids) && brand_ids.length > 0 ? brand_ids : [1];
    await prisma.user_brands.createMany({
      data: brandIdsToAssign.map(bid => ({ user_id: user.id, brand_id: Number(bid) })),
      skipDuplicates: true,
    });

    return c.json(user);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'Database error' }, 500);
  }
});

app.patch('/users/:id', async c => {
  const prisma = c.get('prisma');
  const id = Number(c.req.param('id'));
  const { role, is_active, brand_ids } = await c.req.json() as { role?: string; is_active?: boolean; brand_ids?: number[] };

  try {
    const user = await prisma.users.update({
      where: { id },
      data: {
        ...(role !== undefined ? { role } : {}),
        ...(is_active !== undefined ? { is_active } : {}),
      },
      select: {
        id: true, full_name: true, email: true, role: true, is_active: true, created_at: true,
        user_brands: { select: { brands: { select: { id: true, name: true } } } },
      },
    });

    if (brand_ids !== undefined) {
      await prisma.user_brands.deleteMany({ where: { user_id: id } });
      if (brand_ids.length > 0) {
        await prisma.user_brands.createMany({
          data: brand_ids.map(bid => ({ user_id: id, brand_id: bid })),
        });
      }
      const refreshed = await prisma.users.findUnique({
        where: { id },
        select: {
          id: true, full_name: true, email: true, role: true, is_active: true, created_at: true,
          user_brands: { select: { brands: { select: { id: true, name: true } } } },
        },
      });
      if (is_active === false) invalidateAuthCache(id);
      return c.json(refreshed);
    }

    if (is_active === false) invalidateAuthCache(id);
    return c.json(user);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'Database error' }, 500);
  }
});

app.post('/users/:id/reset-password', async c => {
  const prisma = c.get('prisma');
  const id = Number(c.req.param('id'));
  const { password } = await c.req.json() as { password: string };

  if (!password || password.length < 6) {
    return c.json({ error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' }, 400);
  }

  const dbUser = await prisma.users.findUnique({ where: { id }, select: { email: true } });
  if (!dbUser?.email) {
    return c.json({ error: 'ไม่พบผู้ใช้' }, 404);
  }

  const supabaseAdmin = getSupabaseAdmin(c.env);
  const { data, error: listError } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
  if (listError) {
    return c.json({ error: listError.message }, 500);
  }

  const supaUser = data.users.find(u => u.email === dbUser.email);
  if (!supaUser) {
    return c.json({ error: 'ไม่พบ auth user สำหรับอีเมลนี้' }, 404);
  }

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(supaUser.id, {
    password,
    user_metadata: { ...supaUser.user_metadata, must_change_password: true },
  });

  if (updateError) {
    return c.json({ error: updateError.message }, 400);
  }

  return c.json({ ok: true });
});

export default app;
