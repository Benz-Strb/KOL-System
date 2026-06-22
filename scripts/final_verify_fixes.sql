-- Verify fixes: field-by-field DB vs Excel audit
-- 2026-06-13

-- final_price = 0.00 บน paid rows → ควรเป็น NULL (import bug)
UPDATE placements SET final_price = NULL WHERE id IN (343, 403, 429, 472, 533);

-- follower_at_time ต่างกัน 1 (Excel=32299, DB=32300)
UPDATE placements SET follower_at_time = 32299 WHERE id = 318;
