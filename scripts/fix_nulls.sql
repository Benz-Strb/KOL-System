-- Fix verified NULL / wrong values from merge-aware Excel audit (2026-06-12)
-- Each fix verified: DB campaign == Excel source campaign
--
-- NOT fixed (cross-campaign data, cannot use):
--   follower: ids 932, 933, 940, 958, 960  (Excel row from different campaign)
--   pay_amount: ids 192, 851               (Excel row final_price doesn't match DB)
-- NOT fixed (legitimately NULL in Excel):
--   ids 416, 417 (storybearcat)
--   ids 527, 530, 534, 544-546, 554 (various, follower blank in Excel)
--   ids 830-833 (Crew Journey)
--   ids 896-907, 928-960 (campaign 5.5 late entries, unfilled)

BEGIN;

-- ============================================================
-- 1. follower_at_time — 4 rows, same-campaign source confirmed
-- ============================================================
-- id=444 ป้ายยาของแต่งบ้าน / Facebook / 3.3   ← Excel row 454 (campaign 3.3, follower=1.2M)
UPDATE placements SET follower_at_time = 1200000 WHERE id = 444;

-- id=576 jsee236 / TikTok / 4.4               ← Excel row 594 (campaign 4.4, follower=418K)
UPDATE placements SET follower_at_time = 418000  WHERE id = 576;

-- id=719 ชีวิตติดโปร Promotion / Facebook / 5.5 ← Excel row 735 (campaign 5.5, follower=7,000,000)
UPDATE placements SET follower_at_time = 7000000 WHERE id = 719;

-- id=837 supanutmakpramool / TikTok / 5.5     ← Excel row 816 (campaign 5.5, follower=198,100)
UPDATE placements SET follower_at_time = 198100  WHERE id = 837;

-- ============================================================
-- 2. final_price — 1 row
-- ============================================================
-- id=837 supanutmakpramool / TikTok / 5.5     ← same Excel row 816 (final_price=15,000)
UPDATE placements SET final_price = 15000 WHERE id = 837;

-- ============================================================
-- 3. payment_type — 4 Kit placements imported as 'paid' but Excel = Barter
--    Pattern: base version (514/516/518/520) already has correct barter
--             Kit version (515/517/519/521) incorrectly imported as paid
-- ============================================================
-- id=515 เบื้องหลังสมาร์ทโฮม-Kit   ← Excel row 532 (fp=Barter)
UPDATE placements SET payment_type = 'barter' WHERE id = 515;

-- id=517 ติ่งไอที-Kit               ← Excel row 534 (fp=Barter)
UPDATE placements SET payment_type = 'barter' WHERE id = 517;

-- id=519 ผมชอบแต่งบ้าน-Photo-Kit    ← Excel row 536 (fp=Barter)
UPDATE placements SET payment_type = 'barter' WHERE id = 519;

-- id=521 ผมชอบแต่งบ้าน-VDO-Kit      ← Excel row 538 (fp=Barter)
UPDATE placements SET payment_type = 'barter' WHERE id = 521;

COMMIT;
