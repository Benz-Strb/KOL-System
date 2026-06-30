import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

const app = new Hono<AppEnv>();
app.use('*', requireAuth);

export type CalendarEvent = {
  id: number;
  date: string;
  date_source: 'target' | 'actual';
  status: string;
  placement_type: string;
  kol_id: number;
  kol_name: string;
  handle: string;
  avatar_url: string | null;
  platform: string | null;
  product_name: string | null;
  store_name: string | null;
  campaign_code: string | null;
  post_url: string | null;
};

app.get('/', async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const q = c.req.query();
    const { from, to, brand_id, kol_id, status, placement_type } = q;

    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
      return c.json({ error: 'from and to must be YYYY-MM-DD' }, 400);
    }

    const VALID_STATUS = new Set(['planned', 'posted', 'cancelled']);
    const VALID_TYPE = new Set(['online', 'offline_shop']);

    const isAdmin = user.role === 'admin';
    const bid = brand_id ? Number(brand_id) : null;
    const kolId = kol_id ? Number(kol_id) : null;

    // Resolve which brand IDs the caller may see (null = admin sees all)
    let allowedBrandIds: number[] | null = null;
    if (!isAdmin) {
      allowedBrandIds = bid && user.brandIds.includes(bid) ? [bid] : user.brandIds;
    } else if (bid) {
      allowedBrandIds = [bid];
    }

    // Display date = the field the calendar drag edits, chosen by status:
    //   posted  → publication_date (actual post day; fallback target if null)
    //   else    → target_pub_date  (planned/cancelled keep the intended day)
    // so "what you see = what you drag" (see spec §3.2). Kept as a SQL snippet
    // so WHERE / ORDER BY / SELECT all stay in sync.
    const EVENT_DATE_SQL = `CASE
        WHEN p.status = 'posted' THEN COALESCE(p.publication_date, p.target_pub_date)
        ELSE COALESCE(p.target_pub_date, p.publication_date)
      END`;

    // from/to: regex-validated YYYY-MM-DD; brandIds/kolId: integers from session/parseInt
    // status/placement_type: allowlisted — no user-controlled strings reach the query
    const conds: string[] = [
      `${EVENT_DATE_SQL} BETWEEN '${from}'::date AND '${to}'::date`,
    ];
    if (allowedBrandIds) conds.push(`p.brand_id IN (${allowedBrandIds.join(',')})`);
    if (status && VALID_STATUS.has(status)) conds.push(`p.status = '${status}'`);
    if (placement_type && VALID_TYPE.has(placement_type)) conds.push(`p.placement_type = '${placement_type}'`);
    if (kolId) conds.push(`p.kol_id = ${kolId}`);

    const where = conds.join(' AND ');

    const rows = await prisma.$queryRawUnsafe<{
      id: number;
      event_date: string;
      date_source: string;
      status: string;
      placement_type: string;
      kol_id: number;
      kol_name: string | null;
      handle: string;
      avatar_url: string | null;
      platform: string | null;
      product_name: string | null;
      store_name: string | null;
      campaign_code: string | null;
      post_url: string | null;
    }[]>(`
      SELECT
        p.id::int,
        TO_CHAR(${EVENT_DATE_SQL}, 'YYYY-MM-DD') AS event_date,
        CASE
          WHEN p.status = 'posted' AND p.publication_date IS NOT NULL THEN 'actual'
          WHEN p.target_pub_date IS NOT NULL THEN 'target'
          ELSE 'actual'
        END AS date_source,
        p.status,
        p.placement_type,
        k.id::int AS kol_id,
        k.gen_name AS kol_name,
        kp.handle,
        kp.avatar_url,
        pl.name AS platform,
        pr.model_code AS product_name,
        s.name AS store_name,
        cam.code AS campaign_code,
        p.post_url
      FROM placements p
      JOIN kols k ON p.kol_id = k.id
      JOIN kol_platforms kp ON kp.kol_id = k.id AND kp.is_primary = true
      LEFT JOIN platforms pl ON kp.platform_id = pl.id
      LEFT JOIN products pr ON p.product_id = pr.id
      LEFT JOIN stores s ON p.store_id = s.id
      LEFT JOIN campaigns cam ON p.campaign_id = cam.id
      WHERE ${where}
      ORDER BY ${EVENT_DATE_SQL}, p.id
    `);

    // Count placements with NO date at all (same filters minus date range)
    const noDateConds: string[] = [`p.target_pub_date IS NULL AND p.publication_date IS NULL`];
    if (allowedBrandIds) noDateConds.push(`p.brand_id IN (${allowedBrandIds.join(',')})`);
    if (status && VALID_STATUS.has(status)) noDateConds.push(`p.status = '${status}'`);
    if (placement_type && VALID_TYPE.has(placement_type)) noDateConds.push(`p.placement_type = '${placement_type}'`);
    if (kolId) noDateConds.push(`p.kol_id = ${kolId}`);

    const noDateRows = await prisma.$queryRawUnsafe<{ cnt: number }[]>(
      `SELECT COUNT(*)::int AS cnt FROM placements p WHERE ${noDateConds.join(' AND ')}`
    );
    const no_date_count = Number(noDateRows[0]?.cnt ?? 0);

    const events: CalendarEvent[] = rows.map(r => ({
      id: Number(r.id),
      date: r.event_date,
      date_source: r.date_source as 'target' | 'actual',
      status: r.status,
      placement_type: r.placement_type,
      kol_id: Number(r.kol_id),
      kol_name: r.kol_name ?? r.handle,
      handle: r.handle,
      avatar_url: r.avatar_url,
      platform: r.platform,
      product_name: r.product_name,
      store_name: r.store_name,
      campaign_code: r.campaign_code,
      post_url: r.post_url,
    }));

    return c.json({ events, meta: { no_date_count } });
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to load calendar' }, 500);
  }
});

app.get('/kol-latest', async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const q = c.req.query();
    const kolId = q.kol_id ? Number(q.kol_id) : null;
    const bid = q.brand_id ? Number(q.brand_id) : null;
    if (!kolId || !Number.isInteger(kolId)) return c.json({ error: 'kol_id required' }, 400);

    const isAdmin = user.role === 'admin';
    let allowedBrandIds: number[] | null = null;
    if (!isAdmin) {
      allowedBrandIds = bid && user.brandIds.includes(bid) ? [bid] : user.brandIds;
    } else if (bid) {
      allowedBrandIds = [bid];
    }

    if (allowedBrandIds && allowedBrandIds.length === 0) return c.json({ date: null });

    // Same display-date logic as the main query (spec §3.2 / §9.8) so the
    // "jump to nearest month" lands on the same day the calendar shows.
    const EVENT_DATE_SQL = `CASE
        WHEN p.status = 'posted' THEN COALESCE(p.publication_date, p.target_pub_date)
        ELSE COALESCE(p.target_pub_date, p.publication_date)
      END`;

    const conds: string[] = [
      `p.kol_id = ${kolId}`,
      `${EVENT_DATE_SQL} IS NOT NULL`,
    ];
    if (allowedBrandIds) conds.push(`p.brand_id IN (${allowedBrandIds.join(',')})`);

    const rows = await prisma.$queryRawUnsafe<{ d: string | null }[]>(`
      SELECT TO_CHAR(d, 'YYYY-MM-DD') AS d FROM (
        SELECT ${EVENT_DATE_SQL} AS d
        FROM placements p
        WHERE ${conds.join(' AND ')}
      ) t
      ORDER BY (CASE WHEN d >= CURRENT_DATE THEN 0 ELSE 1 END), ABS(d - CURRENT_DATE)
      LIMIT 1
    `);

    return c.json({ date: rows[0]?.d ?? null });
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to load kol latest date' }, 500);
  }
});

export default app;
