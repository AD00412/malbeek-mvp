-- تنظيفٌ ختاميٌّ لـ ٤ سياساتٍ متبقّيةٍ على {public}

-- ─── feedback admin update → authenticated ───
drop policy if exists "feedback admin update" on public.feedback;
create policy "feedback update" on public.feedback for update to authenticated
  using (my_role() = 'admin'::user_role)
  with check (my_role() = 'admin'::user_role);

-- ─── public_messages: admin فقط، authenticated ───
drop policy if exists "pmsg admin read"   on public.public_messages;
drop policy if exists "pmsg admin update" on public.public_messages;
create policy "public_messages select" on public.public_messages for select to authenticated
  using (my_role() = 'admin'::user_role);
create policy "public_messages update" on public.public_messages for update to authenticated
  using (my_role() = 'admin'::user_role)
  with check (my_role() = 'admin'::user_role);

-- ─── subscriber_members: دمجُ SELECT (members + owner + admin) ───
drop policy if exists "members read"           on public.subscriber_members;
drop policy if exists "subscriber_members all" on public.subscriber_members;
create policy "subscriber_members select" on public.subscriber_members for select to authenticated using (
  my_role() = 'admin'::user_role
  or subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
  or can_manage_sub(subscriber_id)
);
create policy "subscriber_members insert" on public.subscriber_members for insert to authenticated with check (
  subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
  or my_role() = 'admin'::user_role
);
create policy "subscriber_members update" on public.subscriber_members for update to authenticated
  using (
    subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
    or my_role() = 'admin'::user_role
  ) with check (
    subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
    or my_role() = 'admin'::user_role
  );
create policy "subscriber_members delete" on public.subscriber_members for delete to authenticated using (
  subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
  or my_role() = 'admin'::user_role
);
