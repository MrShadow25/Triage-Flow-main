/* engine.js — the hospital prototype's PHP/MySQL logic, rewritten as plain browser JS (data lives in state.js / localStorage). */
(function () {
  'use strict';
  const TF = window.TF, S = TF.state, C = TF.config, MIN = 60000;

  /* ---------- patients ---------- */
  const P = (TF.patients = {
    byId: (id) => S.P.find((p) => p.id == id),
    active: () => S.P.filter((p) => p.st !== 'out'),
    wait: (p) => Math.max(0, Math.floor(((p.tSeen || Date.now()) - p.t0) / 1000)), // seconds; stops once seen
    // Doctors and nurses only see their own patients; receptionists see everyone.
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
    pick: (role) => ST.list(role).filter((s) => s.st === 'available' && ST.load(s) < C.MAX_LOAD[role])
      .sort((a, b) => ST.load(a) - ST.load(b))[0], // fewest patients first
  });

  /* ---------- notifications ---------- */
  const dxOf = (p) => (p.dx && p.dx !== 'Pending' ? p.dx : 'Not yet diagnosed');
  TF.patients.dx = dxOf;
  TF.staff.spec = (name) => { const s = S.staff.find((x) => x.name === name); return s ? s.spec : 'Not assigned'; };
  TF.notify = (role, title, detail, hot, to) => {
    const l = S.NT[role]; l.unshift([title, Date.now(), detail, !!hot, to || null]); if (l.length > 30) l.length = 30;
  };
  TF.notifs = (role) => S.NT[role].filter((n) => !n[4] || (S.user && n[4] === S.user.name));
  // Unread = newer than the last time this person opened the bell. Drives the red dot.
  TF.unread = (role) => TF.notifs(role).filter((n) => n[1] > ((S.seen || {})[S.user.id] || 0)).length;

  /* ---------- tasks & auto-assignment ---------- */
  const addRecheck = (p) => { if (p.nu) S.tasks.push({ id: S.tid++, pid: p.id, nurse: p.nu, title: 'Re-check', due: Date.now() + C.RECHECK_MIN[p.p] * MIN }); };
  const freeRoom = () => [1, 2, 3, 4, 5, 6].find((r) => !P.active().some((p) => p.room === r));
  const releaseRoom = (r) => { if (r) TF.notify('Receptionist', 'Room Availability', rl(r) + ' is available'); };
  const rl = (r) => 'Room ' + String(r).padStart(2, '0');

  // Fills a missing doctor / nurse / room for waiting patients, most urgent first. P1–P3 get rooms automatically.
  function autoAssign() {
    S.P.filter((p) => ['waiting', 'in_care'].includes(p.st) && (!p.doc || !p.nu || !p.room))
      .sort((a, b) => a.p - b.p || a.t0 - b.t0).forEach((p) => {
        const hot = p.p === 1;
        if (!p.doc) { const d = ST.pick('Doctor'); if (d) { p.doc = d.name; TF.notify('Doctor', 'New Patient Assigned', `Patient ${p.n} — Complaint: ${p.c}`, hot, d.name); } }
        if (!p.nu) { const n = ST.pick('Nurse'); if (n) { p.nu = n.name; addRecheck(p); TF.notify('Nurse', 'New Patient Assigned', `Patient ${p.n} — Complaint: ${p.c}`, hot, n.name); } }
        if (!p.room && p.p <= 3) { const r = freeRoom(); if (r) { p.room = r; TF.notify('Receptionist', 'Patient Queue Update', `Patient ${p.n} was moved to ${rl(r)}`); } }
      });
  }

  /* ---------- actions ---------- */
  TF.engine = {
    autoAssign,
    register(f, pri, syms) {
      const p = { id: S.nid++, n: f.n.trim(), age: +f.a, p: pri, c: f.c.trim(), dx: f.dx.trim(), sym: syms, room: null, doc: null, nu: null, t0: Date.now(), st: 'waiting' };
      S.P.push(p);
      TF.notify('Receptionist', 'Patient Priority Set', `Patient ${p.n} was added to the queue with Priority P${pri}`, pri === 1);
      autoAssign();
      return p;
    },
    // Deleting a wrongly entered registration tells everyone involved and frees the room.
    remove(p) {
      S.P.splice(S.P.indexOf(p), 1); S.tasks = S.tasks.filter((t) => t.pid !== p.id);
      TF.notify('Receptionist', 'Patient Removed', `Incorrect registration for ${p.n} was deleted.`);
      const msg = `${p.n} was removed from your list (registration entered in error).`;
      if (p.doc) TF.notify('Doctor', 'Patient Removed', msg, false, p.doc);
      if (p.nu) TF.notify('Nurse', 'Patient Removed', msg, false, p.nu);
      releaseRoom(p.room); autoAssign();
    },
    reassign(p, doc, nu) {
      const hot = p.p === 1, job = `Patient ${p.n} — Complaint: ${p.c}`;
      if (doc && doc !== p.doc) {
        if (p.doc) TF.notify('Doctor', 'Patient Reassigned', `${p.n} was reassigned to ${doc}.`, false, p.doc);
        p.doc = doc; TF.notify('Doctor', 'New Patient Assigned', job, hot, doc);
      }
      if (nu && nu !== p.nu) {
        if (p.nu) TF.notify('Nurse', 'Patient Reassigned', `${p.n} was reassigned to ${nu}.`, false, p.nu);
        p.nu = nu; S.tasks.forEach((t) => { if (t.pid === p.id) t.nurse = nu; });
        if (!S.tasks.some((t) => t.pid === p.id)) addRecheck(p);
        TF.notify('Nurse', 'New Patient Assigned', job, hot, nu);
      }
    },
    setRoom(p, r) {
      const old = p.room; p.room = r;
      if (r) TF.notify('Receptionist', 'Patient Queue Update', `Patient ${p.n} was moved to ${rl(r)}`);
      if (old && old !== r) releaseRoom(old);
    },
    saveDx(p, dx) { p.dx = dx.trim().slice(0, 255); },
    status(p, st) {
      const now = Date.now();
      if (st === 'seen') { p.tSeen = p.tSeen || now; if (p.st === 'waiting') p.st = 'in_care'; }
      else if (st === 'admitted') { p.tSeen = p.tSeen || now; p.tAdm = p.tAdm || now; p.st = 'admitted'; }
      else if (st === 'out') {
        p.tSeen = p.tSeen || now; p.tClosed = now; p.st = 'out';
        const r = p.room; p.room = null; S.tasks = S.tasks.filter((t) => t.pid !== p.id); releaseRoom(r); autoAssign();
      }
    },
    setStaffStatus(s, st) { s.st = st; if (st === 'available') autoAssign(); },
    completeTask(id) {
      const t = S.tasks.find((x) => x.id === id); if (!t) return;
      S.tasks = S.tasks.filter((x) => x.id !== id);
      const p = P.byId(t.pid); if (p && p.st !== 'out') addRecheck(p); // schedule the next re-check
    },
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
