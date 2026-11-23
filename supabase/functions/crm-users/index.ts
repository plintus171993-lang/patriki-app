// Патрики Офис — учётки управляющих. Вызывает только владелец (JWT из панели, crm_me().owner).
// body.action:
//   list                          — управляющие: имя, email, заведение, права, последний вход
//   save {user_id?, email, password?, name, venue, perms[]} — создать или изменить управляющего
//   remove {user_id}              — закрыть доступ (учётка остаётся, строка в admins и права удаляются)
// Владельца (admins.venue_id is null) функция не трогает. Деплой: verify_jwt = false.
import { createClient } from 'npm:@supabase/supabase-js@2';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(URL_, SERVICE_KEY, { auth: { persistSession: false } });
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });
const PERMS = ['revenue.view', 'cash.view', 'cash.add', 'cash.transfer', 'staff.edit'];

async function isOwner(req: Request) {
  const auth = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!auth) return false;
  const u = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: 'Bearer ' + auth } }, auth: { persistSession: false } });
  const { data } = await u.rpc('crm_me');
  return !!(data && (data as any).owner);
}
const fail = (m: string) => { throw new Error(m); };

async function list() {
  const { data: admins, error } = await db.from('admins').select('user_id,venue_id,name');
  if (error) fail(error.message);
  const { data: perms } = await db.from('crm_manager_perms').select('user_id,perm');
  const out = [];
  for (const a of admins || []) {
    const { data: u } = await db.auth.admin.getUserById(a.user_id);
    out.push({ user_id: a.user_id, venue: a.venue_id, name: a.name, owner: a.venue_id === null,
      email: u?.user?.email || null, last_sign_in: u?.user?.last_sign_in_at || null,
      perms: (perms || []).filter((p) => p.user_id === a.user_id).map((p) => p.perm) });
  }
  return { users: out };
}

async function save(b: any) {
  const name = String(b.name || '').trim(), venue = String(b.venue || '').trim();
  const email = String(b.email || '').trim().toLowerCase(), password = String(b.password || '');
  if (!name) fail('Укажите имя');
  if (!venue) fail('Выберите заведение');
  const { data: v } = await db.from('venues').select('id').eq('id', venue).maybeSingle();
  if (!v) fail('Нет такого заведения');
  if (password && password.length < 8) fail('Пароль — минимум 8 символов');
  let uid: string = b.user_id || '';
  if (uid) {
    const { data: cur } = await db.from('admins').select('venue_id').eq('user_id', uid).maybeSingle();
    if (!cur) fail('Управляющий не найден');
    if (cur.venue_id === null) fail('Учётку владельца здесь менять нельзя');
    if (password) { const { error } = await db.auth.admin.updateUserById(uid, { password }); if (error) fail(error.message); }
  } else {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('Укажите email');
    if (!password) fail('Задайте пароль');
    const { data: ex } = await db.rpc('crm_user_id_by_email', { p_email: email });
    if (ex) {
      const { data: a } = await db.from('admins').select('venue_id').eq('user_id', ex).maybeSingle();
      if (a && a.venue_id === null) fail('Это учётка владельца');
      if (a) fail('Этот email уже управляющий — откройте его в списке');
      uid = ex as string;
      const { error } = await db.auth.admin.updateUserById(uid, { password, email_confirm: true });
      if (error) fail(error.message);
    } else {
      const { data: c, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
      if (error) fail(error.message);
      uid = c.user!.id;
    }
  }
  const { error: e1 } = await db.from('admins').upsert({ user_id: uid, venue_id: venue, name }, { onConflict: 'user_id' });
  if (e1) fail(e1.message);
  const perms = [...new Set((b.perms || []).filter((p: string) => PERMS.includes(p)))] as string[];
  if ((perms.includes('cash.add') || perms.includes('cash.transfer')) && !perms.includes('cash.view')) perms.push('cash.view');
  await db.from('crm_manager_perms').delete().eq('user_id', uid);
  if (perms.length) { const { error } = await db.from('crm_manager_perms').insert(perms.map((perm) => ({ user_id: uid, perm }))); if (error) fail(error.message); }
  return { ok: true, user_id: uid };
}

async function remove(b: any) {
  const uid = String(b.user_id || '');
  const { data: cur } = await db.from('admins').select('venue_id').eq('user_id', uid).maybeSingle();
  if (!cur) fail('Управляющий не найден');
  if (cur.venue_id === null) fail('Учётку владельца здесь менять нельзя');
  await db.from('crm_manager_perms').delete().eq('user_id', uid);
  await db.from('admins').delete().eq('user_id', uid);
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (!(await isOwner(req))) return json({ error: 'Нет доступа' }, 403);
    const b = await req.json().catch(() => ({}));
    switch (b.action) {
      case 'list': return json(await list());
      case 'save': return json(await save(b));
      case 'remove': return json(await remove(b));
      default: return json({ error: 'unknown action' }, 400);
    }
  } catch (e) { return json({ error: (e as Error).message }, 400); }
});
