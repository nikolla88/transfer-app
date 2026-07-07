-- ═══════════════════════════════════════════════════════════════
--  Dodati kolone za naziv dodjeljenog vozila/suplaera iz rasporeda
--  Popunjava se automatski pri saveSchedule() u DailySchedule
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE rooming_list
  ADD COLUMN IF NOT EXISTS dep_assigned_vehicle TEXT,
  ADD COLUMN IF NOT EXISTS arr_assigned_vehicle TEXT;
