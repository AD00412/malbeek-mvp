-- اشتراكات Web Push لكل مستخدم (طُبِّق على الإنتاج عبر MCP).
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text, auth text,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "push own select" on public.push_subscriptions;
create policy "push own select" on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
drop policy if exists "push own insert" on public.push_subscriptions;
create policy "push own insert" on public.push_subscriptions for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "push own update" on public.push_subscriptions;
create policy "push own update" on public.push_subscriptions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "push own delete" on public.push_subscriptions;
create policy "push own delete" on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
notify pgrst, 'reload schema';
