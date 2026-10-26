begin;

do $$
declare
  v_count integer;
  v_revenue numeric;
  v_commission numeric;
  v_stock_rows integer;
  v_booking_rows integer;
begin
  select count(*), coalesce(sum(treatment_price), 0), coalesce(sum(commission_amount), 0)
    into v_count, v_revenue, v_commission
    from public.bookings
   where id in (
     'ec68295a-e16a-4d9b-bb6c-278d54559cef',
     '6af62b7d-9935-4ee8-b5a0-65fb7b4f1d81',
     'a0a4752d-b4f9-4587-ba49-0262c94a1d3b',
     'c5f3f33c-c300-4a4d-b6e5-4fa777147504',
     '82468ba9-5004-409a-b16d-99e3c9bfa7ab'
   )
     and therapist_name = 'Ron'
     and outlet_id = 'D1'
     and status = 'batal'
     and paid = true
     and end_at is not null
     and created_at >= '2026-10-01 16:00:00+00'::timestamptz
     and created_at <  '2026-10-02 16:00:00+00'::timestamptz;

  if v_count <> 5 or v_revenue <> 900000 or v_commission <> 90000 then
    raise exception 'Precondition mismatch; no rows restored (count %, revenue %, commission %)', v_count, v_revenue, v_commission;
  end if;

  update public.oil_inventory i
     set stock = i.stock - needed.qty
    from (
      select outlet_id, oil_type, oil_size as size, count(*)::integer as qty
        from public.bookings
       where id in (
         'ec68295a-e16a-4d9b-bb6c-278d54559cef',
         '6af62b7d-9935-4ee8-b5a0-65fb7b4f1d81',
         'a0a4752d-b4f9-4587-ba49-0262c94a1d3b',
         'c5f3f33c-c300-4a4d-b6e5-4fa777147504',
         '82468ba9-5004-409a-b16d-99e3c9bfa7ab'
       )
         and uses_oil and oil_type is not null and oil_size is not null
       group by outlet_id, oil_type, oil_size
    ) needed
   where i.outlet_id = needed.outlet_id
     and i.oil_type = needed.oil_type
     and i.size = needed.size
     and i.stock >= needed.qty;
  get diagnostics v_stock_rows = row_count;
  if v_stock_rows <> 4 then
    raise exception 'Expected to adjust 4 oil variants, adjusted %; transaction rolled back', v_stock_rows;
  end if;

  update public.bookings
     set status = 'selesai',
         cancelled_at = null,
         completed_at = to_timestamp(end_at::numeric / 1000)
   where id in (
     'ec68295a-e16a-4d9b-bb6c-278d54559cef',
     '6af62b7d-9935-4ee8-b5a0-65fb7b4f1d81',
     'a0a4752d-b4f9-4587-ba49-0262c94a1d3b',
     'c5f3f33c-c300-4a4d-b6e5-4fa777147504',
     '82468ba9-5004-409a-b16d-99e3c9bfa7ab'
   )
     and status = 'batal'
     and paid = true;
  get diagnostics v_booking_rows = row_count;
  if v_booking_rows <> 5 then
    raise exception 'Expected to restore 5 bookings, restored %; transaction rolled back', v_booking_rows;
  end if;

  insert into public.audit_logs (actor, actor_name, action, table_name, record_id, outlet_id, detail)
  select null, 'Data correction', 'edit', 'bookings', id, outlet_id,
         jsonb_build_object('reason', 'Restore Ron commission to confirmed total for 2026-10-02', 'previous_status', 'batal', 'restored_status', 'selesai', 'stock_adjusted', true)
    from public.bookings
   where id in (
     'ec68295a-e16a-4d9b-bb6c-278d54559cef',
     '6af62b7d-9935-4ee8-b5a0-65fb7b4f1d81',
     'a0a4752d-b4f9-4587-ba49-0262c94a1d3b',
     'c5f3f33c-c300-4a4d-b6e5-4fa777147504',
     '82468ba9-5004-409a-b16d-99e3c9bfa7ab'
   );
end;
$$;

commit;

select jsonb_build_object(
  'date_wita', '2026-10-02',
  'therapist', 'Ron',
  'outlet', 'D1',
  'valid_revenue', sum(treatment_price),
  'commission', sum(commission_amount),
  'valid_bookings', count(*)
)::text as restored_totals
from public.bookings
where therapist_name = 'Ron'
  and outlet_id = 'D1'
  and status <> 'batal'
  and created_at >= '2026-10-01 16:00:00+00'::timestamptz
  and created_at <  '2026-10-02 16:00:00+00'::timestamptz;
