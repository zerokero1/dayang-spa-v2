import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = {};
readFileSync(".env", "utf8").split(/\r?\n/).forEach((l) => {
  const m = l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
});
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
await sb.auth.signInWithPassword({ email: env.DYANG_EMAIL, password: env.DYANG_PASSWORD });
const BACKUP = "D:/androidbuild/temp/opencode/backup-therapist-duplikat.json";

// Cari id langsung dari database - jangan diketik manual, salah 1 karakter
// akan berarti update ke id yang tidak ada.
async function cariKembar(nama) {
  const { data } = await sb.from("therapists").select("*").ilike("name", nama);
  if (!data || data.length < 2) return null;
  const hitung = [];
  for (const t of data) {
    const { count } = await sb.from("bookings").select("id", { count: "exact", head: true }).eq("therapist_id", t.id);
    hitung.push({ ...t, jml: count || 0 });
  }
  hitung.sort((a, b) => b.jml - a.jml);
  return { keep: hitung[0], hapus: hitung.slice(1) };
}

console.log("=== KONDISI SEKARANG ===");
const plans = [];
for (const nama of ["Sumi", "Rizal"]) {
  const g = await cariKembar(nama);
  if (!g) { console.log("  " + nama + ": tidak kembar (sudah bersih)"); continue; }
  console.log("  " + nama + ":");
  console.log("     PERTAHANKAN " + g.keep.id + "  booking=" + g.keep.jml + " shift=" + (g.keep.shift ?? "-"));
  for (const h of g.hapus) console.log("     hapus        " + h.id + "  booking=" + h.jml + " shift=" + (h.shift ?? "-"));
  plans.push({ nama, keep: g.keep, hapus: g.hapus });
}
console.log("");

console.log("=== BACKUP ===");
let backup = { dibuat: new Date().toISOString(), therapist: [], bookings: [], reservations: [] };
if (readFileSync(BACKUP, "utf8")) { try { backup = JSON.parse(readFileSync(BACKUP, "utf8")); } catch (e) { /* pakai yang baru */ } }
for (const p of plans) {
  const { data: bk } = await sb.from("bookings").select("id, therapist_id, therapist_name").eq("therapist_id", p.hapus[0].id).limit(3000);
  backup.therapist.push(p.hapus[0]);
  backup.bookings.push(...(bk || []));
  writeFileSync(BACKUP, JSON.stringify(backup, null, 2), "utf8");
  console.log("  " + p.nama + ": " + (bk || []).length + " booking dibackup");
}
writeFileSync(BACKUP, JSON.stringify(backup, null, 2), "utf8");
console.log("  file: " + BACKUP);
console.log("");

console.log("=== PINDAHKAN booking -> id yang dipertahankan ===");
for (const p of plans) {
  for (const h of p.hapus) {
    const { data: bk } = await sb.from("bookings").select("id").eq("therapist_id", h.id).limit(3000);
    const ids = (bk || []).map((b) => b.id);
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await sb.from("bookings").update({ therapist_id: p.keep.id }).in("id", ids.slice(i, i + 200));
      if (error) throw new Error(p.nama + ": " + error.message);
    }
    const { data: rs } = await sb.from("reservations").select("id").eq("therapist_id", h.id).limit(1000);
    if ((rs || []).length) {
      const { error } = await sb.from("reservations").update({ therapist_id: p.keep.id }).in("id", rs.map((r) => r.id));
      if (error) throw new Error(p.nama + " reservasi: " + error.message);
    }
    console.log("  " + p.nama + ": " + ids.length + " booking + " + (rs || []).length + " reservasi -> " + p.keep.id.slice(0, 8));
  }
}
console.log("");

console.log("=== HAPUS baris kembar ===");
for (const p of plans) {
  for (const h of p.hapus) {
    const { count } = await sb.from("bookings").select("id", { count: "exact", head: true }).eq("therapist_id", h.id);
    const { count: rc } = await sb.from("reservations").select("id", { count: "exact", head: true }).eq("therapist_id", h.id);
    if ((count || 0) > 0 || (rc || 0) > 0) { console.log("  " + p.nama + " " + h.id.slice(0, 8) + ": LEWATI, masih " + count + "/" + rc); continue; }
    const { error } = await sb.from("therapists").delete().eq("id", h.id);
    console.log("  " + p.nama + " " + h.id.slice(0, 8) + ": " + (error ? "GAGAL " + error.message : "dihapus"));
  }
}
console.log("");

console.log("=== VERIFIKASI ===");
const { data: th } = await sb.from("therapists").select("id, name, shift, home_outlet_id, status").order("name");
const per = {};
th.forEach((x) => { (per[x.name] = per[x.name] || []).push(x); });
const kembar = Object.entries(per).filter(([, v]) => v.length > 1);
console.log("  total therapist    : " + th.length);
console.log("  nama masih kembar  : " + (kembar.length ? kembar.map(([k]) => k).join(", ") : "TIDAK ADA"));
for (const p of plans) {
  const { count: a } = await sb.from("bookings").select("id", { count: "exact", head: true }).eq("therapist_id", p.keep.id);
  const { data: kom } = await sb.from("bookings").select("commission_amount").eq("therapist_id", p.keep.id).limit(3000);
  console.log("  " + p.nama.padEnd(6) + " -> 1 baris, booking=" + String(a).padStart(4) +
    "  komisi=Rp" + (kom || []).reduce((s, x) => s + Number(x.commission_amount || 0), 0).toLocaleString("id-ID"));
}

console.log("");
console.log("=== BERSIHKAN TERAPIS TERKUNCI DI SESI ONCALL ===");
const { data: stuck } = await sb.from("therapists")
  .select("id, name, status, current_group_id").like("current_group_id", "oncall:%");
if (!(stuck || []).length) console.log("  tidak ada");
for (const t of stuck || []) {
  const gid = String(t.current_group_id).replace("oncall:", "");
  const { data: b } = await sb.from("bookings").select("status").eq("id", gid).limit(1);
  const { data: aktif } = await sb.from("bookings").select("id")
    .eq("therapist_id", t.id).eq("status", "berjalan").gt("end_at", Date.now());
  const ada = (aktif || []).filter((x) => x.id !== gid);
  if (ada.length) { console.log("  " + t.name + ": dilewati, masih ada " + ada.length + " sesi berjalan"); continue; }
  const { error } = await sb.from("therapists").update({
    status: "free", current_outlet_id: null, current_booking_ids: null, current_booking_id: null,
    current_treatment_names: null, current_treatment_name: null, current_paid: null,
    current_payment_method: null, current_price: null, current_group_id: null,
    start_at: null, end_at: null
  }).eq("id", t.id);
  console.log("  " + t.name + ": booking " + gid.slice(0, 8) + " status=" + ((b || [])[0]?.status ?? "-") +
    " -> " + (error ? "GAGAL " + error.message : "dibebaskan"));
}