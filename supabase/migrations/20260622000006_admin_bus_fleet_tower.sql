-- برج تحكّم الباصات للأدمن: تجميعٌ عبر كلّ الحملات (للأدمن فقط).
-- طُبِّق على الإنتاج عبر MCP apply_migration (admin_bus_fleet_tower).
create or replace function public.admin_bus_fleet()
returns table(
  unit_key text, org_name text, trip_id uuid, trip_title text,
  depart_at timestamptz, trip_status text, bus_label text, bus_plate text,
  capacity int, has_driver boolean, pax int, seated int, boarded int, checked_in int
)
language sql stable security definer set search_path = public as $$
  with units as (
    select tb.id::text as unit_key, tb.trip_id, tb.subscriber_id,
           coalesce(tb.label, 'باص '||tb.bus_number) as bus_label, tb.plate as bus_plate,
           (coalesce(tb.bus_rows,0)*4 + coalesce(tb.bus_back_row,0)) as capacity, tb.id as bus_id
    from public.trip_buses tb
    union all
    select ('t:'||t.id), t.id, t.subscriber_id,
           coalesce(t.bus_label,'الباص'), t.bus_plate,
           (coalesce(t.bus_rows,0)*4 + coalesce(t.bus_back_row,0)), null::uuid
    from public.trips t
    where not exists (select 1 from public.trip_buses tb where tb.trip_id = t.id)
  )
  select u.unit_key, s.org_name, t.id, t.title, t.depart_at, t.status::text,
         u.bus_label, u.bus_plate, u.capacity,
         (t.driver_name is not null and length(trim(t.driver_name)) > 0) as has_driver,
         count(p.id)::int as pax,
         count(p.id) filter (where p.seat_no is not null)::int as seated,
         count(p.id) filter (where p.status = 'boarded')::int as boarded,
         count(p.id) filter (where p.status = 'checked_in')::int as checked_in
  from units u
  join public.trips t on t.id = u.trip_id
  join public.subscribers s on s.id = u.subscriber_id
  left join public.passengers p on p.trip_id = u.trip_id and (u.bus_id is null or p.bus_id = u.bus_id)
  where public.my_role() = 'admin'::user_role and t.status <> 'done'
  group by u.unit_key, s.org_name, t.id, t.title, t.depart_at, t.status, u.bus_label, u.bus_plate, u.capacity, t.driver_name
  order by t.depart_at nulls last;
$$;
revoke all on function public.admin_bus_fleet() from public, anon;
grant  execute on function public.admin_bus_fleet() to authenticated;
notify pgrst, 'reload schema';
