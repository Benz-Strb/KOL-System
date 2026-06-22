-- publication_date สำหรับ id 695, 696 (เจอนี่เจอนั่น-Journeyjournal, camp 5.5)
-- Excel col O = '11/04/0206' (typo ปี 0206→2026) parse ไม่ผ่าน year filter
-- ค่าถูกต้องอ้างอิงจาก id=694 (top of merge range) ซึ่งมีค่าถูกแล้ว
UPDATE placements SET publication_date = '2026-04-11' WHERE id IN (695, 696);
