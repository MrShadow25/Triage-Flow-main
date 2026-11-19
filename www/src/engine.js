/* engine.js — hospital actions. Reads come from the in-memory copy (sync.js); every change is written to Supabase.
   Assignment, discharge and task rules that must not race between phones run inside the database. */
(function () {
  'use strict';
  const TF = window.TF, S = TF.state, C = TF.config, MIN = 60000;
  const db = () => TF.backend.sb;
  const ok = (r) => { if (r.error) throw r.error; return r; };

  /* ---------- patients ---------- */
  const P = (TF.patients = {
    byId: (id) => S.P.find((p) => p.id == id),
    active: () => S.P.filter((p) => p.st !== 'out'),
    wait: (p) => Math.max(0, Math.floor(((p.tSeen || Date.now()) - p.t0) / 1000)), // seconds; stops once seen
    // Doctors and nurses only see their own patients (the database enforces it too); receptionists see everyone.
    mine() {
      const m = ST.me(), n = m && m.name, a = P.active();
      return S.role === 'Doctor' ? a.filter((p) => p.doc === n) : S.role === 'Nurse' ? a.filter((p) => p.nu === n) : a;
    },
  });

  /* ---------- staff ---------- */
  const ST = (TF.staff = {
    list: (role) => S.staff.filter((s) => s.role === role),
    docs: () => ST.list('Doctor'),
    nurses: () => ST.list('Nurse'),
    load: (s) => P.active().filter((p) => (s.role === 'Doctor' ? p.doc : p.nu) === s.name).length,
    me: () => S.user && S.staff.find((s) => s.sid === S.user.id),
    sid: (name) => (S.staff.find((s) => s.name === name) || {}).sid || null,
  });

  const dxOf = (p) => (p.dx && p.dx !== 'Pending' ? p.dx : 'Not yet diagnosed');
  TF.patients.dx = dxOf;
  TF.staff.spec = (name) => { const s = S.staff.find((x) => x.name === name); return s ? s.spec : 'Not assigned'; };

  /* ---------- notifications ---------- */
  const rl = (r) => 'Room ' + String(r).padStart(2, '0');
  const eventKey = () => crypto.randomUUID();
  const notify = (role, toName, title, detail, hot) =>
    db().from('notifications').insert({ role, to_sid: toName ? ST.sid(toName) : null, title, detail, hot: !!hot, event_key: eventKey() }).then(ok);
  const releaseRoom = (r) => (r ? notify('Receptionist', null, 'Room Availability', rl(r) + ' is available') : null);
  TF.notifs = (role) => (S.NT[role] || []).filter((n) => !n[4] || (S.user && n[4] === S.user.name));
  // Unread = newer than the last time this person opened the bell. Drives the red dot.
  TF.unread = (role) => TF.notifs(role).filter((n) => n[1] > ((S.seen || {})[S.user.id] || 0)).length;

  const autoAssign = () => db().rpc('auto_assign').then(ok);
  const addRecheck = (p, nurseSid) => db().from('tasks').insert({ patient_id: p.id, nurse_sid: nurseSid, due: new Date(Date.now() + C.RECHECK_MIN[p.p] * MIN).toISOString() }).then(ok);

  /* ---------- actions (all async; they throw on failure) ---------- */
  TF.engine = {
    autoAssign,
    async register(f, pri, syms) {
      const r = ok(await db().from('patients').insert({ name: f.n.trim(), age: +f.a, priority: pri, complaint: f.c.trim(), symptoms: syms }).select().single());
      await notify('Receptionist', null, 'Patient Priority Set', `Patient ${r.data.name} was added to the queue with Priority P${pri}`, pri === 1);
      await autoAssign();
      await TF.sync.load();
      return P.byId(r.data.id) || { n: r.data.name, doc: null };
    },
    // Deleting a wrongly entered registration tells everyone involved and frees the room.
    async remove(p) {
      ok(await db().from('patients').delete().eq('id', p.id));          // the database only allows waiting / in-care patients
      await notify('Receptionist', null, 'Patient Removed', `Incorrect registration for ${p.n} was deleted.`);
      const msg = `${p.n} was removed from your list (registration entered in error).`;
      if (p.doc) await notify('Doctor', p.doc, 'Patient Removed', msg);
      if (p.nu) await notify('Nurse', p.nu, 'Patient Removed', msg);
      await releaseRoom(p.room); await autoAssign();
    },
    async reassign(p, doc, nu) {
      const docSid = ST.sid(doc), nurseSid = ST.sid(nu);
      if (!docSid || !nurseSid) throw new Error('Choose an active Doctor and Nurse.');
      ok(await db().rpc('reassign_patient', { p_id: p.id, p_doc_sid: docSid, p_nu_sid: nurseSid, p_event_key: eventKey() }));
      await TF.sync.load();
    },
    async setRoom(p, r) {
      const old = p.room, u = await db().from('patients').update({ room: r }).eq('id', p.id);
      if (u.error) throw u.error.code === '23505' ? new Error('That room is occupied.') : u.error;
      if (r) await notify('Receptionist', null, 'Patient Queue Update', `Patient ${p.n} was moved to ${rl(r)}`);
      if (old && old !== r) await releaseRoom(old);
    },
    async saveDx(p, dx) { ok(await db().rpc('set_patient_diagnosis', { p_id: p.id, p_dx: dx.trim().slice(0, 255), p_event_key: eventKey() })); },
    async status(p, st) { ok(await db().rpc('set_patient_status', { p_id: p.id, p_st: st, p_event_key: eventKey() })); },
    async setStaffStatus(s, st) {
      ok(await db().from('profiles').update({ status: st }).eq('staff_id', s.sid));
      if (st === 'available') await autoAssign();
    },
    async completeTask(id) { ok(await db().rpc('complete_task', { p_id: id, p_event_key: eventKey() })); },
    // Current 8-hour shift (6-14, 14-22, 22-6), the same window the hospital prototype reports on.
    summary() {
      const n = new Date(), h = n.getHours(), at = (d, hh) => { const x = new Date(n); x.setDate(x.getDate() + d); x.setHours(hh, 0, 0, 0); return +x; };
      const [s, e] = h >= 6 && h < 14 ? [at(0, 6), at(0, 14)] : h >= 14 && h < 22 ? [at(0, 14), at(0, 22)] : h >= 22 ? [at(0, 22), at(1, 6)] : [at(-1, 22), at(0, 6)];
      const inW = (t) => t >= s && t < e, reg = S.P.filter((p) => inW(p.t0));
      const fmtH = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      return {
        total: reg.length, avg: reg.length ? Math.round(reg.reduce((a, p) => a + P.wait(p), 0) / reg.length / 60) : 0,
        admitted: S.P.filter((p) => p.tAdm && inW(p.tAdm)).length, out: S.P.filter((p) => p.st === 'out' && p.tClosed && inW(p.tClosed)).length,
        shift: fmtH(s) + ' - ' + fmtH(e),
      };
    },
  };

  /* ---------- time helpers ---------- */
  TF.utils.rel = (ts) => { const s = (Date.now() - ts) / 1000; return s < 60 ? 'NOW' : s < 3600 ? Math.floor(s / 60) + 'm' : Math.floor(s / 3600) + 'h'; };
  TF.utils.duePhrase = (due) => { const s = Math.round((due - Date.now()) / 1000); return s <= 0 ? 'overdue by ' + TF.utils.fmt(-s) : 'due in ' + TF.utils.fmt(s); };
})();
