-- publication_date fixes: bad year 02XX→20XX in Excel col O

UPDATE placements SET publication_date = '2026-04-11' WHERE id = 689;
UPDATE placements SET publication_date = '2026-04-11' WHERE id = 690;
