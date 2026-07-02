import { Hono } from 'hono';
import { requireAuth, requireRole, invalidateAuthCache } from '../middleware/auth.js';
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import type { AppEnv } from '../types.js';

const app = new Hono<AppEnv>();
app.use('*', requireAuth, requireRole('admin'));

const ALLOWED_LOGO_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const LOGO_EXT_MAP: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

app.get('/brands', async c => {
  try {
    const prisma = c.get('prisma');
    const brands = await prisma.brands.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, active: true, logo_url: true },
    });
    return c.json(brands);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'Database error' }, 500);
  }
});

app.post('/brands', async c => {
  const prisma = c.get('prisma');
  const { name, logo_url } = await c.req.json() as { name: string; logo_url?: string | null };
  if (!name?.trim()) return c.json({ error: 'name จำเป็น' }, 400);
  try {
    const brand = await prisma.brands.create({
      data: { name: name.trim(), logo_url: logo_url?.trim() || null },
      select: { id: true, name: true, active: true, logo_url: true },
    });
    return c.json(brand, 201);
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === 'P2002') return c.json({ error: 'ชื่อแบรนด์นี้มีอยู่แล้ว' }, 409);
    console.error(err);
    return c.json({ error: 'Database error' }, 500);
  }
});

app.post('/brands/logo', async c => {
  try {
    const env = c.env;
    const body = await c.req.parseBody();
    const file = body['file'];
    if (!(file instanceof File)) return c.json({ error: 'file_required' }, 400);
    if (!ALLOWED_LOGO_MIME.has(file.type)) return c.json({ error: 'invalid_type' }, 400);
    if (file.size > 2 * 1024 * 1024) return c.json({ error: 'too_large' }, 400);

    const ext = LOGO_EXT_MAP[file.type];
    const path = `logos/${crypto.randomUUID()}.${ext}`;
    const upRes = await fetch(
      `${env.SUPABASE_URL}/storage/v1/object/brand-logos/${path}`,
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
    const publicUrl = `${env.SUPABASE_URL}/storage/v1/object/public/brand-logos/${path}`;
    return c.json({ url: publicUrl }, 201);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'upload_error' }, 500);
  }
});

app.patch('/brands/:id', async c => {
  const prisma = c.get('prisma');
  const id = Number(c.req.param('id'));
  const { name, active, logo_url } = await c.req.json() as { name?: string; active?: boolean; logo_url?: string | null };
  try {
    const brand = await prisma.brands.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(active !== undefined ? { active } : {}),
        ...(logo_url !== undefined ? { logo_url: logo_url?.trim() || null } : {}),
      },
      select: { id: true, name: true, active: true, logo_url: true },
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
  // marketing ต้องมีแบรนด์เสมอ; manager ไม่ผูก = เห็นทุกแบรนด์ (มติ 2026-07-02)
  if (role === 'marketing' && (!Array.isArray(brand_ids) || brand_ids.length === 0)) {
    return c.json({ error: 'marketing ต้องเลือกอย่างน้อย 1 แบรนด์' }, 400);
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

    // ไม่ default เป็นแบรนด์ 1 อีกต่อไป — manager/admin สร้างแบบไม่ผูกแบรนด์ได้
    // (manager ว่าง = เห็นทุกแบรนด์; marketing ถูกบังคับ ≥1 แบรนด์ด้านบนแล้ว)
    if (Array.isArray(brand_ids) && brand_ids.length > 0) {
      await prisma.user_brands.createMany({
        data: brand_ids.map(bid => ({ user_id: user.id, brand_id: Number(bid) })),
        skipDuplicates: true,
      });
    }

    return c.json(user);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'Database error' }, 500);
  }
});

app.patch('/users/:id', async c => {
  const prisma = c.get('prisma');
  const id = Number(c.req.param('id'));
  const { role, is_active, brand_ids, email, full_name } = await c.req.json() as {
    role?: string; is_active?: boolean; brand_ids?: number[]; email?: string; full_name?: string;
  };

  try {
    // marketing ต้องมีแบรนด์เสมอ — เช็คจากสถานะสุดท้ายหลัง update (role/brand_ids
    // เปลี่ยนแยกกันได้ เช่น สลับ role เป็น marketing ทั้งที่ user ไม่มีแบรนด์ผูกอยู่)
    if (role !== undefined || brand_ids !== undefined) {
      const current = await prisma.users.findUnique({
        where: { id },
        select: { role: true, user_brands: { select: { brand_id: true } } },
      });
      if (!current) return c.json({ error: 'ไม่พบผู้ใช้' }, 404);
      const finalRole = role ?? current.role;
      const finalBrandCount = brand_ids !== undefined ? brand_ids.length : current.user_brands.length;
      if (finalRole === 'marketing' && finalBrandCount === 0) {
        return c.json({ error: 'marketing ต้องเลือกอย่างน้อย 1 แบรนด์' }, 400);
      }
    }

    // Email update: sync to Supabase auth first
    if (email !== undefined) {
      const newEmail = email.trim().toLowerCase();
      if (!newEmail) return c.json({ error: 'email ห้ามว่าง' }, 400);

      const dbUser = await prisma.users.findUnique({ where: { id }, select: { email: true } });
      if (!dbUser) return c.json({ error: 'ไม่พบผู้ใช้' }, 404);

      const supabaseAdmin = getSupabaseAdmin(c.env);
      if (dbUser.email) {
        // find existing supabase user and update
        const { data, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
        if (listErr) return c.json({ error: listErr.message }, 500);
        const supaUser = data.users.find(u => u.email === dbUser.email);
        if (supaUser) {
          const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(supaUser.id, { email: newEmail });
          if (updateErr) return c.json({ error: updateErr.message }, 400);
        }
      }
      // update DB email
      await prisma.users.update({ where: { id }, data: { email: newEmail } });
    }

    const user = await prisma.users.update({
      where: { id },
      data: {
        ...(role !== undefined ? { role } : {}),
        ...(is_active !== undefined ? { is_active } : {}),
        ...(full_name !== undefined && full_name.trim() ? { full_name: full_name.trim() } : {}),
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
      // brand/role เปลี่ยน → ล้าง auth cache ให้สิทธิ์ใหม่มีผลทันที (ไม่ต้องรอ TTL 60s)
      invalidateAuthCache(id);
      return c.json(refreshed);
    }

    if (is_active === false || role !== undefined) invalidateAuthCache(id);
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
