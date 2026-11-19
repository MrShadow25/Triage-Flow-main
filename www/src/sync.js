/* sync.js — loads the shared hospital data from Supabase into the in-memory state the screens read,
   and keeps it live (realtime push + a 15 s safety refresh). */
(function () {
  'use strict';
  const TF = window.TF, S = TF.state, B = TF.backend;
  const ms = (t) => (t ? new Date(t).getTime() : null);
  let chan = null, poll = null, deb = null, lastTs = 0, first = true;

  async function load() {
    if (!B.ready || !S.user) return { error: true };
    const since = new Date(Date.now() - 3 * 864e5).toISOString();
    const [pr, pa, ta, no] = await Promise.all([
      B.sb.from('profiles').select('staff_id,full_name,role,specialty,status,is_active'),
      B.sb.from('patients').select('*').or(`st.neq.out,t0.gte.${since}`),
      B.sb.from('tasks').select('*'),
      B.sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(30),
    ]);
    const err = pr.error || pa.error || ta.error || no.error;
    if (err) return { error: err };
    const nm = Object.fromEntries(pr.data.map((x) => [x.staff_id, x.full_name]));
    S.staff = pr.data.filter((x) => x.role !== 'Receptionist' && x.is_active !== false).map((x) => ({
      sid: x.staff_id, name: x.full_name, role: x.role, st: x.status, active: x.is_active !== false,
      spec: x.specialty || (x.role === 'Doctor' ? 'Physician' : 'Registered Nurse') }));
    S.P = pa.data.map((x) => ({
      id: x.id, n: x.name, age: x.age, p: x.priority, c: x.complaint, dx: x.dx, sym: x.symptoms || [], room: x.room,
      doc: nm[x.doc_sid] || null, nu: nm[x.nu_sid] || null, t0: ms(x.t0), tSeen: ms(x.t_seen), tAdm: ms(x.t_adm), tClosed: ms(x.t_closed), st: x.st }));
    S.tasks = ta.data.map((x) => ({ id: x.id, pid: x.patient_id, nurse: nm[x.nurse_sid] || '', title: x.title, due: ms(x.due) }));
    S.NT = { Receptionist: [], Nurse: [], Doctor: [] };
    no.data.forEach((n) => S.NT[n.role].push([n.title, ms(n.created_at), n.detail || '', n.hot, n.to_sid ? nm[n.to_sid] || null : null]));
    const mine = TF.notifs(S.role), top = mine.length ? Math.max(...mine.map((n) => n[1])) : 0;
    const fresh = first ? [] : mine.filter((n) => n[1] > lastTs);
    lastTs = Math.max(lastTs, top); first = false;
    return { fresh };
  }

  function start(onUpdate) {
    stop();
    const bump = () => { clearTimeout(deb); deb = setTimeout(async () => { const r = await load(); if (r && !r.error) onUpdate(r.fresh); }, 300); };
    chan = B.sb.channel('tf-live');
    ['patients', 'tasks', 'notifications', 'profiles'].forEach((t) => chan.on('postgres_changes', { event: '*', schema: 'public', table: t }, bump));
    chan.subscribe();
    poll = setInterval(bump, 15000);                              // safety net if realtime is blocked
  }
  function stop() {
    if (chan) B.sb.removeChannel(chan); chan = null; clearInterval(poll); clearTimeout(deb); first = true; lastTs = 0;
    S.P = []; S.tasks = []; S.staff = []; S.NT = { Receptionist: [], Nurse: [], Doctor: [] };
  }

  TF.sync = { load, start, stop };
})();
