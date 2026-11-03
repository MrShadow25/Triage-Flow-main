/* state.js — config, constants, the single app state object, persistence and data helpers. */
(function () {
  'use strict';
  const TF = window.TF;

  TF.config = {
    DEMO_MODE: true,          // true: show the 2FA code on screen (no SMS gateway). Set false once a real SMS backend exists.
    MAX_ATTEMPTS: 3,          // wrong codes allowed before the user must start over
    RESEND_SECONDS: 30,
    CODE_TTL_MS: 5 * 60 * 1000,
    MIN_PASSWORD: 8,
    STORE_KEY: 'triageflow-v2',
  };

  TF.data = {
    PC: { 1: '#dc2626', 2: '#c2410c', 3: '#a16207', 4: '#15803d', 5: '#1d4ed8' },
    SYM: ['Chest pain or pressure', 'Severe headache', 'Shortness of breath', 'Severe abdominal pain', 'Sudden weakness or numbness'],
    ROLES: ['Receptionist', 'Nurse', 'Doctor'],
    // [id, label, icon]
    TABS: {
      Receptionist: [['register', 'Register', '➕'], ['queue', 'Queue', '☰'], ['staff', 'Staff', '👥'], ['rooms', 'Rooms', '🛏'], ['reassign', 'Reassign', '🔄'], ['summary', 'Summary', '📊']],
      Nurse: [['patients', 'Patients', '👥'], ['task', 'Task', '📋'], ['status', 'Status', '🙍']],
      Doctor: [['patients', 'Patients', '👥'], ['avail', 'Availability', '🕒']],
    },
    TITLES: { register: 'Register Patient', queue: 'Patient Queue', staff: 'Staff Availability', rooms: 'Room Availability', reassign: 'Reassign Patient', summary: 'Shift Summary', patients: 'Assigned Patients', task: 'My Tasks', status: 'My Status', avail: 'My Availability' },
  };

  const blankReg = () => ({ n: '', a: '', c: '', dx: '' });
  const blankAccount = () => ({ name: '', id: '', role: 'Nurse', pw: '', code: '', phone: '' });

  // NOTE: prototype only. Passwords are stored in plain text in localStorage. A real build must hash them server-side.
  const S = (TF.state = {
    // session / navigation
    user: null, role: 'Receptionist', scr: 'login', tab: '', sub: '', notif: false,
    // auth forms (memory only, never saved)
    err: '', tf: null,
    lf: { id: '', pw: '' },
    ca: blankAccount(),
    cp: { id: '', pw: '', pw2: '' },
    // working data
    sel: null, room: null, dstat: 'Available', nbusy: true,
    f: blankReg(), chk: [0, 1, 2, 3, 4], pri: 1, rd: null, rn: null,
    added: 0, adm: 0, dis: 0, nid: 5,
    accounts: [
      { id: 'RC-1042', name: 'Ana Reyes', role: 'Receptionist', pw: 'demo1234', phone: '+639171234567' },
      { id: 'RC-1043', name: 'Maria P.', role: 'Nurse', pw: 'demo1234', phone: '+639181234568' },
      { id: 'RC-1044', name: 'Dr. Alexander', role: 'Doctor', pw: 'demo1234', phone: '+639191234569' },
    ],
    P: [
      { id: 1, n: 'Jackson, P.', p: 1, c: 'Chest pain', dx: 'Angina', room: 1, doc: 'Dr. Alexander', nu: 'Maria P.', w: 84, st: 'waiting' },
      { id: 2, n: 'Cruz, A.', p: 2, c: 'High fever', dx: 'Pending', room: 2, doc: 'Dr. Ocampo', nu: 'Panitan, S.', w: 939, st: 'waiting' },
      { id: 3, n: 'Mapili, M.', p: 3, c: 'Sprain', dx: 'Pending', room: 3, doc: 'Dr. Jimenez', nu: 'Morillo, J.', w: 2657, st: 'waiting' },
      { id: 4, n: 'Villas, J.', p: 4, c: 'Minor rash', dx: 'Pending', room: 4, doc: 'Dr. Griego', nu: 'Maria P.', w: 3423, st: 'waiting' },
    ],
    NT: {
      Receptionist: [['Patient priority set', 'NOW', 'Patient P. Jackson queued'], ['Patient queue update', '2m', 'Patient A. Cruz moved to Room 02'], ['Staff availability', '9m', 'Dr. Alexander is Free'], ['Room availability', '14m', 'Room 5 and Room 6 are Available']],
      Nurse: [['Patient re-check overdue', 'NOW', 'Patient P. Jackson · Room 01'], ['Patient emergency vitals', '1:00', 'Patient P. Jackson · Room 01'], ['Patient infection check', '10:00', 'Patient J. Villas · Room 04']],
      Doctor: [['New patient assigned', 'NOW', 'Patient P. Jackson · Room 1 · Chest pain'], ['Review patient', 'P2', 'Patient A. Cruz · Room 2 · High fever'], ['Review patient', 'P3', 'Patient M. Mapili · Room 3 · Sprain']],
    },
  });

  TF.blank = { reg: blankReg, account: blankAccount };

  /* ---- persistence ---- */
  const PERSIST = ['P', 'NT', 'added', 'adm', 'dis', 'nid', 'dstat', 'nbusy', 'accounts'];
  TF.store = {
    save() {
      try {
        const out = {};
        PERSIST.forEach((k) => (out[k] = S[k]));
        localStorage.setItem(TF.config.STORE_KEY, JSON.stringify(out));
      } catch (e) { /* storage unavailable: app still works in memory */ }
    },
    load() {
      try {
        const d = JSON.parse(localStorage.getItem(TF.config.STORE_KEY) || 'null');
        if (d) PERSIST.forEach((k) => { if (d[k] !== undefined) S[k] = d[k]; });
      } catch (e) { /* ignore corrupt data */ }
    },
    reset() {
      try { localStorage.removeItem(TF.config.STORE_KEY); } catch (e) { /* ignore */ }
    },
  };

  /* ---- data helpers ---- */
  TF.patients = {
    byId: (id) => S.P.find((p) => p.id == id),
    active: () => S.P.filter((p) => p.st !== 'out'),
  };
  TF.staff = {
    docs: () => [['Dr. Alexander', 'Emergency Physician', S.dstat === 'Available'], ['Dr. Ocampo', 'Internal Medicine', false]],
    nurses: () => [['Nurse Marces', 'Triage Nurse', true], ['Nurse Panitan', 'Staff Nurse', false]],
    // Patients assigned to the signed-in nurse (matched on first name).
    mine: () => {
      const first = ((S.user && S.user.name) || '').split(/[ ,]/)[0].toLowerCase();
      return first ? TF.patients.active().filter((p) => p.nu.toLowerCase().startsWith(first)) : [];
    },
  };
  TF.notify = (role, title, time, detail) => S.NT[role].unshift([title, time, detail]);
})();
