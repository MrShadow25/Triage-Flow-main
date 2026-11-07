/* state.js — config, constants, the single app state object and persistence. */
(function () {
  'use strict';
  const TF = window.TF;
  const ago = (s) => Date.now() - s * 1000;

  TF.config = {
    DEMO_MODE: true, MAX_ATTEMPTS: 3, RESEND_SECONDS: 30, CODE_TTL_MS: 5 * 60 * 1000, MIN_PASSWORD: 8,
    STORE_KEY: 'triageflow-v3',
    RECHECK_MIN: { 1: 15, 2: 30, 3: 60, 4: 120, 5: 240 }, // nurse re-check interval per priority
    MAX_LOAD: 5,                                          // max active patients per doctor / nurse
  };

  TF.data = {
    PC: { 1: '#dc2626', 2: '#c2410c', 3: '#a16207', 4: '#15803d', 5: '#1d4ed8' },
    PL: { 1: 'Critical', 2: 'High', 3: 'Moderate', 4: 'Low', 5: 'Non-urgent' },
    SYM: ['Chest pain or pressure', 'Severe headache', 'Shortness of breath', 'Severe abdominal pain', 'Sudden weakness or numbness'],
    ROLES: ['Receptionist', 'Nurse', 'Doctor'],
    TABS: {
      Receptionist: [['register', 'Register', '➕'], ['queue', 'Queue', '☰'], ['staff', 'Staff', '👥'], ['rooms', 'Rooms', '🛏'], ['reassign', 'Reassign', '🔄'], ['summary', 'Summary', '📊']],
      Nurse: [['patients', 'Patients', '👥'], ['task', 'Task', '📋'], ['status', 'Status', '🙍']],
      Doctor: [['patients', 'Patients', '👥'], ['avail', 'Availability', '🕒']],
    },
    TITLES: { register: 'Register Patient', queue: 'Patient Queue', staff: 'Staff Availability', rooms: 'Room Availability', reassign: 'Reassign Patient', summary: 'Shift Summary', patients: 'Assigned Patients', task: 'My Tasks', status: 'My Status', avail: 'My Availability' },
  };

  const blankReg = () => ({ n: '', a: '', c: '', dx: '' });
  const blankAccount = () => ({ name: '', id: '', role: 'Nurse', pw: '', code: '', phone: '' });

  // NOTE: prototype only. Passwords are plain text in localStorage. A real build must hash them server-side.
  const S = (TF.state = {
    user: null, role: 'Receptionist', scr: 'login', tab: '', sub: '', notif: false,
    err: '', tf: null,
    lf: { id: '', pw: '' }, ca: blankAccount(), cp: { id: '', pw: '', pw2: '' },
    // working data (memory only)
    sel: null, room: null, rp: '', dxv: '', newSym: '', rd: null, rn: null,
    f: blankReg(), syms: [...TF.data.SYM], chk: [0, 1, 2, 3, 4], pri: 1,
    // shared data (persisted + synced between tabs)
    nid: 5, tid: 1,
    accounts: [
      { id: 'RC-1042', name: 'Ana Reyes', role: 'Receptionist', pw: 'demo1234', phone: '+639171234567' },
      { id: 'RC-1043', name: 'Maria P.', role: 'Nurse', pw: 'demo1234', phone: '+639181234568' },
      { id: 'RC-1044', name: 'Dr. Alexander', role: 'Doctor', pw: 'demo1234', phone: '+639191234569' },
    ],
    staff: [
      { name: 'Dr. Alexander', role: 'Doctor', spec: 'Emergency Physician', st: 'available' },
      { name: 'Dr. Ocampo', role: 'Doctor', spec: 'Internal Medicine', st: 'busy' },
      { name: 'Dr. Jimenez', role: 'Doctor', spec: 'Orthopedics', st: 'available' },
      { name: 'Dr. Griego', role: 'Doctor', spec: 'Dermatology', st: 'off' },
      { name: 'Maria P.', role: 'Nurse', spec: 'Triage Nurse', st: 'available' },
      { name: 'Panitan, S.', role: 'Nurse', spec: 'Staff Nurse', st: 'busy' },
      { name: 'Morillo, J.', role: 'Nurse', spec: 'Staff Nurse', st: 'available' },
    ],
    // st: waiting | in_care | admitted | out.  t0 = registration time (ms); tSeen = first seen (stops the wait clock)
    P: [
      { id: 1, n: 'Jackson, P.', age: 54, p: 1, c: 'Chest pain', dx: 'Angina', room: 1, doc: 'Dr. Alexander', nu: 'Maria P.', t0: ago(84), st: 'waiting' },
      { id: 2, n: 'Cruz, A.', age: 31, p: 2, c: 'High fever', dx: 'Pending', room: 2, doc: 'Dr. Ocampo', nu: 'Panitan, S.', t0: ago(939), st: 'waiting' },
      { id: 3, n: 'Mapili, M.', age: 27, p: 3, c: 'Sprain', dx: 'Pending', room: 3, doc: 'Dr. Jimenez', nu: 'Morillo, J.', t0: ago(2657), st: 'waiting' },
      { id: 4, n: 'Villas, J.', age: 19, p: 4, c: 'Minor rash', dx: 'Pending', room: 4, doc: 'Dr. Griego', nu: 'Maria P.', t0: ago(3423), st: 'waiting' },
    ],
    tasks: [
      { id: 100, pid: 1, nurse: 'Maria P.', title: 'Re-check', due: Date.now() - 60000 },
      { id: 101, pid: 2, nurse: 'Panitan, S.', title: 'Re-check', due: Date.now() + 12 * 60000 },
      { id: 102, pid: 3, nurse: 'Morillo, J.', title: 'Re-check', due: Date.now() + 40 * 60000 },
      { id: 103, pid: 4, nurse: 'Maria P.', title: 'Re-check', due: Date.now() + 95 * 60000 },
    ],
    // notification: [title, timestamp, detail, hot, onlyForName|null]
    NT: {
      Receptionist: [['Patient priority set', ago(5), 'Jackson, P. queued as P1', true, null]],
      Nurse: [['Patient re-check overdue', ago(60), 'Jackson, P. · Room 01', true, 'Maria P.']],
      Doctor: [['New patient assigned', ago(120), 'Jackson, P. · Chest pain', true, 'Dr. Alexander']],
    },
  });
  TF.state.tid = 200;
  TF.blank = { reg: blankReg, account: blankAccount };

  const PERSIST = ['P', 'NT', 'nid', 'tid', 'accounts', 'staff', 'tasks'];
  TF.store = {
    save() { try { const o = {}; PERSIST.forEach((k) => (o[k] = S[k])); localStorage.setItem(TF.config.STORE_KEY, JSON.stringify(o)); } catch (e) { /* in-memory only */ } },
    load() { try { const d = JSON.parse(localStorage.getItem(TF.config.STORE_KEY) || 'null'); if (d) PERSIST.forEach((k) => { if (d[k] !== undefined) S[k] = d[k]; }); } catch (e) { /* ignore */ } },
    reset() { try { localStorage.removeItem(TF.config.STORE_KEY); } catch (e) { /* ignore */ } },
  };
})();
