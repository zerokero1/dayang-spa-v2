-- ============================================================================
-- PEMBAYARAN KAMU DI-KETUK DUA KALI
--
-- TEMUAN: dalam 30 hari, 135 booking punya lebih dari satu catatan "tandai
-- lunas". 125 di antaranya jaraknya kurang dari 10 detik. Itu bukan kasir
-- sengaja membayar dua kali, itu tombol yang ditekan dua kali.
--
-- FUNGSI mark_booking_paid yang lama tidak punya pemeriksaan apakah booking
-- ini sudah lunas. Jadi permintaan kedua happily menjalankan UPDATE lagi dan
-- menulis satu baris log_audit baru. Akibatnya:
--   - log aktivitas penuh dengan "Tandai lunas" ganda
--   - Indonesianya "Lunas" dan "Cardless" kadang perlu diisi dua kali,
--     karena kasir merasa jawabannya tidak masuk
--
-- Perbaikannya di server, bukan hanya di tombol. Tombol bisa saja diklik
-- ganda, atau ada dua device yang menekan bersamaan, atau jaringan retry.
-- Kalau servernya yang mengunci, semua kemungkinan itu tertutup.
-- ============================================================================

-- Setiap pembayaran ganda dicatat di sini supaya bisa dilihat tanpa rummage
-- di antara log aktivitas yang sah.
create table if not exists pembayaran_ganda (
  id            bigserial primary key,
  booking_id    uuid not null,
  outlet_id     text,
  metode_baru   text,
  metode_lama   text,
  oleh          uuid,
  alasan        text,
  dicatat_pada  timestamptz default now()
);

create index if not exists idx_pembayaran_ganda_booking
  on pembayaran_ganda (booking_id, dicatat_pada desc);


create or replace function public.mark_booking_paid(
  p_outlet_id text,
  p_booking_id uuid,
  p_therapist_id uuid,
  p_payment_method text,
  p_discount_pct numeric default null::numeric,
  p_discount_reason text default null::text
)
returns void
language plpgsql
as $$
declare
  v_current_price numeric;
  v_new_price numeric;
  v_uid uuid := auth.uid();
  v_sudah_lunas boolean := false;
  v_metode_lama text;
  v_ada_diskon boolean := (p_discount_pct is not null and p_discount_pct > 0);
  v_baru_baru boolean := false;
begin
  select treatment_price,
         coalesce(original_price, treatment_price),
         paid,
         coalesce(payment_method, '')
    into v_current_price, v_new_price, v_sudah_lunas, v_metode_lama
    from bookings
   where id = p_booking_id and outlet_id = p_outlet_id;

  if not found then
    raise exception 'Booking tidak ditemukan';
  end if;

  ---------------------------------------------------------------------------
  -- KUNCI PENTING: sudah lunas?
  --
  -- Kalau sudah lunas dan tidak ada diskon yang sengaja diberikan,
  -- ini permintaan kedua untuk booking yang sama. Permintaan pertama sudah
  -- berhasil, jadi yang kedua diabaikan.
  --
  -- Kalau ada diskon, itu koreksi yang disengaja: kasir baru saja memilih
  -- diskon saat menekan Lunas. Itu boleh jalan.
  ---------------------------------------------------------------------------
  if v_sudah_lunas and not v_ada_diskon then
    insert into pembayaran_ganda
      (booking_id, outlet_id, metode_baru, metode_lama, oleh, alasan)
    values
      (p_booking_id, p_outlet_id, coalesce(p_payment_method, ''), v_metode_lama,
       v_uid,
       case
         when p_payment_method is not null and v_metode_lama <> ''
              and p_payment_method <> v_metode_lama
           then 'metode bayar beda: ' || v_metode_lama || ' lalu ' || p_payment_method
         else 'booking sudah lunas, permintaan kedua diabaikan'
       end);

    -- Diberi tahu supaya kasir tahu jawabannya sudah masuk, bukan error.
    raise notice 'Booking ini sudah lunas dengan metode %. Tidak ada perubahan.', v_metode_lama;
    return;
  end if;

  if v_ada_diskon and coalesce(p_discount_reason, '') = '' then
    raise exception 'Alasan diskon wajib diisi';
  end if;

  if v_ada_diskon then
    v_new_price := round(v_current_price * (1 - p_discount_pct / 100.0));
  end if;

  update bookings
     set paid = true,
         payment_method = coalesce(p_payment_method, payment_method),
         paid_by = v_uid,
         original_price = case
            when v_ada_diskon then coalesce(original_price, v_current_price)
            else original_price
         end,
         treatment_price = case
            when v_ada_diskon then v_new_price
            else treatment_price
         end,
         discount_pct = coalesce(p_discount_pct, 0),
         discount_reason = coalesce(p_discount_reason, discount_reason),
         commission_amount = case
            when v_ada_diskon then round(commission_percent / 100.0 * v_new_price)
            else commission_amount
         end
   where id = p_booking_id and outlet_id = p_outlet_id;

  if p_therapist_id is not null then
    update therapists
       set current_paid = true,
           current_payment_method = coalesce(p_payment_method, current_payment_method),
           current_price = (
             select coalesce(sum(coalesce(treatment_price, 0)), 0)
               from bookings
              where therapist_id = p_therapist_id
                and outlet_id = p_outlet_id
                and status = 'berjalan'
           )
     where id = p_therapist_id
       and exists (
         select 1 from bookings b
          where b.id = p_booking_id and b.outlet_id = p_outlet_id
            and b.therapist_id = p_therapist_id
       );
  end if;

  perform log_audit(
    'pay', p_booking_id, p_outlet_id,
    jsonb_build_object(
      'method', p_payment_method,
      'discount_pct', p_discount_pct,
      'reason', p_discount_reason,
      'new_price', case when v_ada_diskon then v_new_price end,
      'catatan', case when v_sudah_lunas
                      then 'perbaikan: lunas ulang dengan diskon'
                      else null end
    )
  );
end;
$$;


-- Overload lama 4 parameter (tanpa diskon) DIHAPUS, bukan dibuat ulang.
--
-- Alasannya: versi 6 parameter punya nilai default untuk dua parameter
-- terakhir, jadi panggilan 4 argumen cocok ke KEDUA overload dan PostgreSQL
-- tidak bisa memilih yang mana ("function is not unique").-APlikasi selalu
-- mengirim enam parameter bernama, jadi yang 4 parameter tidak pernah dipakai.
-- Menghapusnya membuat pemanggilan tidak ambigu.
--
-- Catatan: ini juga memperbaiki kemungkinan bug yang lebih buruk di
-- belakang layar, yaitu pemanggilan tanpa nama yang tidak sengaja mendarat
-- ke overload yang salah dan tidak menulis log.
drop function if exists public.mark_booking_paid(text, uuid, uuid, text);
