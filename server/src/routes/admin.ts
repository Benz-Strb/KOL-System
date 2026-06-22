import { Router } from 'express';
import { requireAuth, requireRole, invalidateAuthCache } from '../middleware/auth.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { prisma } from '../prisma.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

router.get('/brands', async (_req, res) => {
  try {
    const brands = await prisma.brands.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, active: true },
    });
    res.json(brands);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.post('/brands', async (req, res) => {
  const { name } = req.body as { name: string };
  if (!name?.trim()) { res.status(400).json({ error: 'name จำเป็น' }); return; }
  try {
    const brand = await prisma.brands.create({
      data: { name: name.trim() },
      select: { id: true, name: true, active: true },
    });
    res.status(201).json(brand);
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === 'P2002') { res.status(409).json({ error: 'ชื่อแบรนด์นี้มีอยู่แล้ว' }); return; }
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.patch('/brands/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { name, active } = req.body as { name?: string; active?: boolean };
  try {
    const brand = await prisma.brands.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(active !== undefined ? { active } : {}),
      },
      select: { id: true, name: true, active: true },
    });
    res.json(brand);
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === 'P2002') { res.status(409).json({ error: 'ชื่อแบรนด์นี้มีอยู่แล้ว' }); return; }
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.get('/users', async (_req, res) => {
  try {
    const users = await prisma.users.findMany({
      orderBy: { created_at: 'asc' },
      select: {
        id: true, full_name: true, email: true, role: true, is_active: true, created_at: true,
        user_brands: { select: { brands: { select: { id: true, name: true } } } },
      },
    });
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.post('/users', async (req, res) => {
  const { email, full_name, role, password, brand_ids } = req.body as {
    email: string; full_name: string; role: string; password: string; brand_ids?: number[];
  };

  if (!email || !full_name || !role || !password) {
    res.status(400).json({ error: 'email, full_name, role, password จำเป็นทั้งหมด' });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });
    return;
  }

  const { error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { must_change_password: true, full_name },
  });

  if (authError) {
    res.status(400).json({ error: authError.message });
    return;
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

    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.patch('/users/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { role, is_active, brand_ids } = req.body as { role?: string; is_active?: boolean; brand_ids?: number[] };

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
      res.json(refreshed);
      return;
    }

    if (is_active === false) invalidateAuthCache(id);
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.post('/users/:id/reset-password', async (req, res) => {
  const id = Number(req.params.id);
  const { password } = req.body as { password: string };

  if (!password || password.length < 6) {
    res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });
    return;
  }

  const dbUser = await prisma.users.findUnique({ where: { id }, select: { email: true } });
  if (!dbUser?.email) {
    res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    return;
  }

  const { data, error: listError } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
  if (listError) {
    res.status(500).json({ error: listError.message });
    return;
  }

  const supaUser = data.users.find(u => u.email === dbUser.email);
  if (!supaUser) {
    res.status(404).json({ error: 'ไม่พบ auth user สำหรับอีเมลนี้' });
    return;
  }

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(supaUser.id, {
    password,
    user_metadata: { ...supaUser.user_metadata, must_change_password: true },
  });

  if (updateError) {
    res.status(400).json({ error: updateError.message });
    return;
  }

  res.json({ ok: true });
});

export default router;
