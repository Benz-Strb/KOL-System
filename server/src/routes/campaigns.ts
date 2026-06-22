import { Router } from 'express';
import { prisma } from '../prisma.js';

const router = Router();

router.post('/', async (req, res) => {
  try {
    const { code, label, year, start_date, end_date } = req.body;
    if (!code?.trim()) return res.status(400).json({ error: 'code required' });
    if (!year) return res.status(400).json({ error: 'year required' });

    const campaign = await prisma.campaigns.create({
      data: {
        code: code.trim().toUpperCase(),
        label: label?.trim() || null,
        year: Number(year),
        start_date: start_date ? new Date(start_date) : null,
        end_date: end_date ? new Date(end_date) : null,
      },
    });
    res.status(201).json(campaign);
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === 'P2002') return res.status(409).json({ error: 'แคมเปญนี้มีอยู่แล้ว' });
    console.error(err);
    res.status(500).json({ error: 'failed to create campaign' });
  }
});

export default router;
