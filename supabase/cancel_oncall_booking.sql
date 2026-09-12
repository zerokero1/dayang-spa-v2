-- ============================================================
-- BATALKAN / HAPUS TRANSAKSI ONCALL
-- Menandai booking oncall sebagai 'batal' (paik=false) dan
-- membebaskan terapis yang diblok untuk transaksi tersebut,
-- TAPI hanya bila terapis tidak punya booking oncall lain.
-- Data tidak dihapus permanen (konsisten dengan pembatalan biasa).
--
-- JALANKAN sekali di Supabase SQL Editor.
-- ============================================================

create or replace function public.cancel_oncall_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_tid uuid;
  v_other integer := 0;
begin
  if not exists (
    select 1 from bookings
    where id = p_booking_id and booking_source = 'oncall' and status <> 'batal'
  ) then
    raise exception 'Transaksi oncall tidak ditemukan atau sudah dibatalkan';
  end if;

  select therapist_id into v_tid from bookings where id = p_booking_id;

  update bookings
     set status = 'batal',
         paid = false,
         cancelled_at = now()
   where id = p_booking_id and booking_source = 'oncall';

  select count(*) into v_other
    from bookings
   where booking_source = 'oncall'
     and status <> 'batal'
     and id <> p_booking_id
     and therapist_id = v_tid;

  if v_other = 0 then
    update therapists
       set status = 'free',
           current_outlet_id = null,
           current_booking_id = null,
           current_booking_ids = '[]'::jsonb,
           current_treatment_names = '[]'::jsonb,
           current_treatment_name = null,
           current_paid = false,
           current_payment_method = null,
           current_price = null,
           current_group_id = null,
           start_at = null,
           end_at = null
     where current_group_id = 'oncall:' || p_booking_id::text;
  end if;
end;
$function$;

grant execute on function public.cancel_oncall_booking(uuid) to authenticated;
grant execute on function public.cancel_oncall_booking(uuid) to anon;