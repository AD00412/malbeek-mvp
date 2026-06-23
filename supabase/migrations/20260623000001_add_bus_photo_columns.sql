-- صور الباص (إضافيّ آمن، forward-only):
--   الباص ١ يُحفظ على trips، والباصات ٢+ على trip_buses.
-- الصورة تُرفع لـ bucket org-assets (عامّ، تحت مجلّد الحملة) عبر مكوّن ImageUpload.
alter table public.trips      add column if not exists bus_photo_url text;
alter table public.trip_buses add column if not exists photo_url     text;
