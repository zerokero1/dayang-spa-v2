-- ============================================================
-- KOREKSI BOOKING — PINDAH OUTLET
--
-- Menambahkan parameter p_new_outlet_id ke RPC edit_booking_correction
-- supaya akun office (office.op@dayang.com) bisa memindahkan booking
-- ke outlet lain (mis. kasir salah pilih outlet saat input).
--
-- Yang terjadi otomatis saat booking dipindah outlet:
--   1. bookings.outlet_id berubah ke outlet tujuan.
--   2. Stok minyak (bila booking pakai minyak) dikembalikan ke outlet
--      lama dan diambil dari outlet tujuan. Booking tetap gagal total
--      (rollback) bila minyak belum terdaftar / stok habis di outlet tujuan.
--   3. Session terapis di-refresh supaya current_outlet_id ikut berubah.
--   4. Audit log tercatat (outlet_dari / outlet_ke).
--
-- Catatan: laporan, omzet, dan komisi ikut pindah mengikuti outlet baru,
-- karena semuanya dihitung dari bookings.outlet_id.
--
-- Jalankan file ini di Supabase SQL Editor (production).
-- ============================================================

-- Buang signature lama supaya tidak jadi overload ambigu.
-- (9 argumen = versi lama sebelum ada diskon; 11 argumen = versi dengan diskon)
drop function if exists public.edit_booking_correction(
  uuid, uuid, text, numeric, numeric, uuid, boolean, text, text
);
drop function if exists public.edit_booking_correction(
  uuid, uuid, text, numeric, numeric, uuid, boolean, text, text, numeric, text
);

create or replace function edit_booking_correction(
  p_booking_id uuid,
  p_treatment_id uuid default null,
  p_treatment_name text default null,
  p_treatment_price numeric default null,
  p_commission_percent numeric default null,
  p_new_therapist_id uuid default null,
  p_uses_oil boolean default null,
  p_oil_type text default null,
  p_oil_size text default null,
  p_discount_pct numeric default null,
  p_discount_reason text default null,
  p_new_outlet_id text default null
) returns void
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_outlet text;
  v_old_therapist uuid;
  v_orig_uses_oil boolean;
  v_old_oil_type text;
  v_old_oil_size text;
  v_old_oil text;
  v_new_oil text;
  v_new_price numeric;
  v_new_commission numeric;
  v_base numeric;
  v_old_original numeric;
  v_status text;
  v_move_outlet boolean := false;
  v_fin_uses_oil boolean;
  v_fin_oil_type text;
  v_fin_oil_size text;
begin
  -- ---- KEAMANAN: wajib office ----
  if not is_office_op() then
    raise exception 'Anda tidak berhak melakukan koreksi booking.';
  end if;

  -- ---- Ambil data lama ----
  select outlet_id, therapist_id, uses_oil, oil_type, oil_size,
         treatment_price, commission_percent, status, original_price
    into v_outlet, v_old_therapist, v_orig_uses_oil, v_old_oil_type, v_old_oil_size,
         v_new_price, v_new_commission, v_status, v_old_original
    from bookings where id = p_booking_id;

  if not found then raise exception 'Booking tidak ditemukan'; end if;

  if v_status in ('batal', 'batal_sebagian') then
    raise exception 'Booking sudah dibatalkan dan tidak bisa dikoreksi.';
  end if;

  v_move_outlet := p_new_outlet_id is not null
                   and btrim(p_new_outlet_id) <> ''
                   and p_new_outlet_id <> v_outlet;

  -- ---- Tentukan nilai baru (fallback ke lama) ----
  v_new_price := coalesce(p_treatment_price, v_new_price);
  v_new_commission := coalesce(p_commission_percent, v_new_commission);

  -- ---- Terapkan diskon baru (bila dikirim) ----
  if p_discount_pct is not null then
    if p_discount_pct < 0 or p_discount_pct > 100 then
      raise exception 'Diskon harus antara 0 dan 100%%.';
    end if;
    if p_discount_pct > 0 and coalesce(p_discount_reason, '') = '' then
      raise exception 'Alasan diskon wajib diisi.';
    end if;
    v_base := coalesce(p_treatment_price, v_old_original, v_new_price);
    if p_discount_pct > 0 then
      v_new_price := round(v_base * (1 - p_discount_pct / 100.0));
    else
      v_new_price := v_base;
    end if;
  end if;

  -- Stok: bandingkan minyak LAMA (asal dari DB) vs minyak BARU (hasil koreksi)
  v_old_oil := case when v_orig_uses_oil then (coalesce(v_old_oil_type,'')||'_'||coalesce(v_old_oil_size,'')) end;
  v_new_oil := case when coalesce(p_uses_oil, v_orig_uses_oil) then (coalesce(p_oil_type,'')||'_'||coalesce(p_oil_size,'')) end;

  if v_old_oil is distinct from v_new_oil then
    if v_orig_uses_oil and v_old_oil_type is not null and v_old_oil_size is not null then
      update oil_inventory set stock = stock + 1
       where outlet_id = v_outlet and oil_type = v_old_oil_type and size = v_old_oil_size;
    end if;
    if coalesce(p_uses_oil, v_orig_uses_oil) and p_oil_type is not null and p_oil_size is not null then
      if (select stock from oil_inventory
           where outlet_id = v_outlet and oil_type = p_oil_type and size = p_oil_size) <= 0 then
        raise exception 'Stok minyak habis';
      end if;
      update oil_inventory set stock = stock - 1
       where outlet_id = v_outlet and oil_type = p_oil_type and size = p_oil_size;
    end if;
  end if;

  -- ---- Update booking (termasuk pindah outlet bila diminta) ----
  update bookings set
    treatment_id = coalesce(p_treatment_id, treatment_id),
    treatment_name = coalesce(p_treatment_name, treatment_name),
    treatment_price = v_new_price,
    commission_percent = v_new_commission,
    commission_amount = round(v_new_commission / 100.0 * v_new_price),
    uses_oil = coalesce(p_uses_oil, uses_oil),
    oil_type = case when coalesce(p_uses_oil, uses_oil) then coalesce(p_oil_type, oil_type) else null end,
    oil_size = case when coalesce(p_uses_oil, uses_oil) then coalesce(p_oil_size, oil_size) else null end,
    therapist_id = coalesce(p_new_therapist_id, therapist_id),
    therapist_name = case
      when p_new_therapist_id is not null
        then (select name from therapists where id = p_new_therapist_id)
      else therapist_name
    end,
    outlet_id = case when v_move_outlet then p_new_outlet_id else outlet_id end,
    original_price = case
      when p_discount_pct is not null and p_discount_pct > 0 then v_base
      when p_discount_pct is not null and p_discount_pct = 0 then null
      else original_price
    end,
    discount_pct = case
      when p_discount_pct is not null then p_discount_pct
      else discount_pct
    end,
    discount_reason = case
      when p_discount_pct is not null and p_discount_pct > 0 then p_discount_reason
      when p_discount_pct is not null and p_discount_pct = 0 then null
      else discount_reason
    end
  where id = p_booking_id;

  -- ---- Pindah stok minyak dari outlet lama ke outlet tujuan ----
  if v_move_outlet then
    select uses_oil, oil_type, oil_size
      into v_fin_uses_oil, v_fin_oil_type, v_fin_oil_size
      from bookings where id = p_booking_id;

    if coalesce(v_fin_uses_oil, false)
       and v_fin_oil_type is not null and v_fin_oil_size is not null then
      if not exists (select 1 from oil_inventory
                      where outlet_id = p_new_outlet_id
                        and oil_type = v_fin_oil_type
                        and size = v_fin_oil_size) then
        raise exception 'Minyak % (%) belum terdaftar di outlet %. Tambah stoknya dulu sebelum pindah outlet.',
          v_fin_oil_type, v_fin_oil_size, p_new_outlet_id;
      end if;

      if coalesce((select stock from oil_inventory
                    where outlet_id = p_new_outlet_id
                      and oil_type = v_fin_oil_type
                      and size = v_fin_oil_size), 0) <= 0 then
        raise exception 'Stok minyak % (%) habis di outlet tujuan (%).',
          v_fin_oil_type, v_fin_oil_size, p_new_outlet_id;
      end if;

      update oil_inventory set stock = stock + 1
       where outlet_id = v_outlet and oil_type = v_fin_oil_type and size = v_fin_oil_size;
      update oil_inventory set stock = stock - 1
       where outlet_id = p_new_outlet_id and oil_type = v_fin_oil_type and size = v_fin_oil_size;
    end if;

    perform log_audit('edit', p_booking_id, p_new_outlet_id,
      jsonb_build_object(
        'action', 'pindah_outlet',
        'outlet_dari', v_outlet,
        'outlet_ke', p_new_outlet_id,
        'oil_type', v_fin_oil_type,
        'oil_size', v_fin_oil_size
      ));
  end if;

  -- ---- Perbarui session terapis bila terapis diganti / outlet dipindah / aktif ----
  if v_old_therapist is not null
     and ((p_new_therapist_id is not null and p_new_therapist_id <> v_old_therapist)
          or v_move_outlet
          or v_status = 'berjalan') then
    perform refresh_therapist_session(v_old_therapist);
  end if;
  if p_new_therapist_id is not null and p_new_therapist_id <> v_old_therapist then
    perform refresh_therapist_session(p_new_therapist_id);
  end if;

  -- ---- Audit ----
  perform log_audit('edit', p_booking_id,
    case when v_move_outlet then p_new_outlet_id else v_outlet end,
    jsonb_build_object(
      'treatment_id', p_treatment_id,
      'treatment_name', p_treatment_name,
      'treatment_price', p_treatment_price,
      'commission_percent', p_commission_percent,
      'therapist_id', p_new_therapist_id,
      'uses_oil', p_uses_oil,
      'oil_type', p_oil_type,
      'oil_size', p_oil_size,
      'discount_pct', p_discount_pct,
      'discount_reason', p_discount_reason,
      'outlet_dari', case when v_move_outlet then v_outlet else null end,
      'outlet_ke', case when v_move_outlet then p_new_outlet_id else null end
    ));
end;
$fn$;

grant execute on function public.edit_booking_correction(
  uuid, uuid, text, numeric, numeric, uuid, boolean, text, text, numeric, text, text
) to authenticated;