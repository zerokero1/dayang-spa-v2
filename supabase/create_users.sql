-- ============================================================
-- DAYANG SPA v2 - Buat 8 User Login + Role/Outlet sekaligus
-- Cara pakai:
--   1. Tempel seluruh isi file ini di SQL Editor -> Run.
--   2. Untuk menambah user lain, salin baris select create_app_user LALU GANTI.
-- ============================================================

-- Fungsi pembantu: buat user auth + isi tabel users (role, outlet)
create or replace function create_app_user(
  p_email text,
  p_password text,
  p_role text,
  p_outlet_id text,
  p_name text
) returns void
language plpgsql
as $fn$
declare
  v_user_id uuid;
begin
  select id into v_user_id
    from auth.users
    where email = p_email
    limit 1;

  if v_user_id is null then
    v_user_id := (
      select u.id
      from supabase_auth.admin.create_user(
        jsonb_build_object(
          'email', p_email,
          'password', p_password,
          'email_confirm', true,
          'user_metadata', jsonb_build_object('name', p_name)
        )
      ) u(id uuid)
    );
  end if;

  insert into users (id, role, outlet_id, name)
  values (v_user_id, p_role, p_outlet_id, p_name)
  on conflict (id) do update
    set role = excluded.role,
        outlet_id = excluded.outlet_id,
        name = excluded.name;
end;
$fn$;

-- ============ 6 KASIR (masing-masing 1 outlet) ============
select create_app_user('kasir1@dayang.com',        'dr12345',     'kasir', 'DR', 'Kasir Dream');
select create_app_user('kasir2@dayang.com',        'rr12345',     'kasir', 'RR', 'Kasir Rere');
select create_app_user('kasir3@dayang.com',        'dp12345',     'kasir', 'DP', 'Kasir Dayang Putri');
select create_app_user('kasir4@dayang.com',        'd112345',     'kasir', 'D1', 'Kasir Dayang 1');
select create_app_user('kasir5@dayang.com',        'd212345',     'kasir', 'D2', 'Kasir Dayang 2');
select create_app_user('kasir6@dayang.com',        'y12345',      'kasir', 'Y',  'Kasir Yulis');

-- ============ OPERATOR (akses semua outlet) ============
select create_app_user('operator.office@dayang.com', 'operator12345', 'admin_pusat', null, 'Operator');

-- ============ BOS (akses semua outlet) ============
select create_app_user('bos@dayang.com',             'bos12345',      'admin_pusat', null, 'Bos');

-- Hapus fungsi pembantu (tidak lagi diperlukan)
drop function if exists create_app_user;
