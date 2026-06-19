-- ============================================================
-- منعُ سَردِ محتوى الـ bucket العام (org-assets) من قِبَل anon
-- ============================================================
-- الـ bucket مُعَلَّمٌ public:true → الملفات تُخدَّم عبر CDN العامّ
-- مباشرةً (URL يحوي الـ path)، فلا حاجة لـ SELECT على metadata
-- لاستخدام الصور في <img>. تقييدُ السرد يمنع scanning الـ bucket.
-- ============================================================

drop policy if exists "org-assets public read" on storage.objects;
create policy "org-assets owner read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'org-assets'
    and (
      (storage.foldername(name))[1] in (
        select id::text from public.subscribers where can_manage_sub(id)
      )
      or my_role() = 'admin'::user_role
    )
  );
