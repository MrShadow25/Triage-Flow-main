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
      const n = S.user && S.user.name, a = P.active();
      return S.role === 'Doctor' ? a.filter((p) => p.doc === n) : S.role === 'Nurse' ? a.filter((p) => p.nu === n) : a;
    },
  });

  /* ---------- staff ---------- */
  const ST = (TF.staff = {
    list: (role) => S.staff.filter((s) => s.role === role),
    docs: () => ST.list('Doctor'),
    nurses: () => ST.list('Nurse'),
    load: (s) => P.active().filter((p) => (s.role === 'Doctor' ? p.doc : p.nu) === s.name).length,
    me: () => S.user && S.staff.find((s) => s.name === S.user.name && s.role === S.role),
    pick: (role) => ST.list(role).filter((s) => s.st === 'available' && ST.load(s) < C.MAX_LOAD)
      .sort((a, b) => ST.load(a) - ST.load(b))[0], // fewest patients first
  });

  /* ---------- notifications ---------- */
  TF.notify = (role, title, detail, hot, to) => {
    const l = S.NT[role]; l.unshift([title, Date.now(), detail, !!hot, to || null]); if (l.length > 40) l.length = 40;
  };
  TF.notifs = (role) => S.NT[role].filter((n) => !n[4] || (S.user && n[4] === S.user.name));
  TF.hasHot = (role) => TF.notifs(role).some((n) => n[3] && Date.now() - n[1] < 10 * MIN);

  /* ---------- tasks & auto-assignment ---------- */
  const addRecheck = (p) => { if (p.nu) S.tasks.push({ id: S.tid++, pid: p.id, nurse: p.nu, title: 'Re-check', due: Date.now() + C.RECHECK_MIN[p.p] * MIN }); };
  const freeRoom = () => [1, 2, 3, 4, 5, 6].find((r) => !P.active().some((p) => p.room === r));
  const rl = (r) => 'Room ' + String(r).padStart(2, '0');

  // Fills a missing doctor / nurse / room for waiting patients, most urgent first. P1–P3 get rooms automatically.
  function autoAssign() {
    S.P.filter((p) => ['waiting', 'in_care'].includes(p.st) && (!p.doc || !p.nu || !p.room))
      .sort((a, b) => a.p - b.p || a.t0 - b.t0).forEach((p) => {
        const hot = p.p === 1;
        if (!p.doc) { const d = ST.pick('Doctor'); if (d) { p.doc = d.name; TF.notify('Doctor', 'New patient assigned', `${p.n} · ${p.c}`, hot, d.name); } }
        if (!p.nu) { const n = ST.pick('Nurse'); if (n) { p.nu = n.name; addRecheck(p); TF.notify('Nurse', 'New patient assigned', `${p.n} · ${p.c}`, hot, n.name); } }
        if (!p.room && p.p <= 3) { const r = freeRoom(); if (r) { p.room = r; TF.notify('Receptionist', 'Patient queue update', `${p.n} moved to ${rl(r)}`); } }
      });
  }

  /* ---------- actions ---------- */
  TF.engine = {
    autoAssign,
    register(f, pri, syms) {
      const p = { id: S.nid++, n: f.n.trim(), age: f.a === '' ? null : +f.a, p: pri, c: f.c.trim(), dx: f.dx.trim() || 'Pending', sym: syms, room: null, doc: null, nu: null, t0: Date.now(), st: 'waiting' };
      S.P.push(p);
      TF.notify('Receptionist', 'Patient priority set', `${p.n} queued as P${pri}`, pri === 1);
      autoAssign();
      return p;
    },
    remove(p) { S.P.splice(S.P.indexOf(p), 1); S.tasks = S.tasks.filter((t) => t.pid !== p.id); autoAssign(); },
    reassign(p, doc, nu) {
      if (doc && doc !== p.doc) { p.doc = doc; TF.notify('Doctor', 'Patient reassigned to you', `${p.n} · ${p.c}`, p.p === 1, doc); }
      if (nu && nu !== p.nu) {
        p.nu = nu; S.tasks.forEach((t) => { if (t.pid === p.id) t.nurse = nu; });
        if (!S.tasks.some((t) => t.pid === p.id)) addRecheck(p);
        TF.notify('Nurse', 'Patient reassigned to you', `${p.n} · ${p.c}`, p.p === 1, nu);
      }
      TF.notify('Receptionist', 'Staff reassigned', `${p.n} · ${p.doc} · ${p.nu}`);
    },
    setRoom(p, r) { p.room = r; if (r) TF.notify('Receptionist', 'Patient queue update', `${p.n} moved to ${rl(r)}`); },
    saveDx(p, dx) { p.dx = dx.trim() || 'Pending'; },
    status(p, st) {
      if (st === 'seen') { p.st = 'in_care'; p.tSeen = p.tSeen || Date.now(); }
      else if (st === 'admitted') { p.st = 'admitted'; p.tSeen = p.tSeen || Date.now(); }
      else if (st === 'out') { p.st = 'out'; p.tSeen = p.tSeen || Date.now(); p.room = null; S.tasks = S.tasks.filter((t) => t.pid !== p.id); autoAssign(); }
      TF.notify('Receptionist', 'Patient ' + ({ in_care: 'seen', admitted: 'admitted', out: 'discharged' })[p.st], p.n);
    },
    setStaffStatus(s, st) { s.st = st; if (st === 'available') autoAssign(); },
    completeTask(id) {
      const t = S.tasks.find((x) => x.id === id); if (!t) return;
      S.tasks = S.tasks.filter((x) => x.id !== id);
      const p = P.byId(t.pid); if (p && p.st !== 'out') addRecheck(p); // schedule the next re-check
    },
    summary() {
      const n = S.P.length, h = new Date().getHours();
      const avg = n ? Math.round(S.P.reduce((a, p) => a + P.wait(p), 0) / n / 60) : 0;
      return { total: n, avg, admitted: S.P.filter((p) => p.st === 'admitted').length, out: S.P.filter((p) => p.st === 'out').length,
        shift: h >= 6 && h < 14 ? '6:00 AM - 2:00 PM' : h >= 14 && h < 22 ? '2:00 PM - 10:00 PM' : '10:00 PM - 6:00 AM' };
    },
  };

  /* ---------- time helpers ---------- */
  TF.utils.rel = (ts) => { const s = (Date.now() - ts) / 1000; return s < 60 ? 'NOW' : s < 3600 ? Math.floor(s / 60) + 'm' : Math.floor(s / 3600) + 'h'; };
  TF.utils.duePhrase = (due) => { const s = Math.round((due - Date.now()) / 1000); return s <= 0 ? 'overdue by ' + TF.utils.fmt(-s) : 'due in ' + TF.utils.fmt(s); };
})();
