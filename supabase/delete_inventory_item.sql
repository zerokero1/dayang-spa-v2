-- Hapus satu item inventory beserta log-nya (supaya tidak menyisakan log yatim).
-- Jalankan sekali di Supabase SQL Editor (tombol New query) lalu tekan Run.

create or replace function delete_inventory_item(
  p_outlet_id text, p_item_id uuid
) returns void
language plpgsql as $fn$
begin
  delete from inventory_logs where outlet_id = p_outlet_id and item_id = p_item_id;
  delete from inventory where id = p_item_id and outlet_id = p_outlet_id;
end;
$fn$;