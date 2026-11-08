/* state.js — config, constants, the single app state object and persistence. */
(function () {
  'use strict';
  const TF = window.TF;
  const ago = (s) => Date.now() - s * 1000;

  TF.config = {
    DEMO_MODE: true, MAX_ATTEMPTS: 3, RESEND_SECONDS: 30, CODE_TTL_MS: 5 * 60 * 1000, MIN_PASSWORD: 8,
    TWO_FACTOR: 'demo',   // 'demo' = code shown on screen (nothing to install) | 'authenticator' = real TOTP app codes
    STORE_KEY: 'triageflow-v3',
    RECHECK_MIN: { 1: 15, 2: 30, 3: 60, 4: 120, 5: 240 }, // nurse re-check interval per priority
    MAX_LOAD: { Doctor: 3, Nurse: 2 },                    // max active patients per doctor / nurse (from hospital config.php)
    HOSPITAL_CODE: '12345678',                            // required to create an account (change it!)
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
    nid: 5, tid: 5,
    // Demo logins (password demo1234). Other staff claim their profile via Create account (hospital code 12345678).
    accounts: [
      { id: 'REC-1001', name: 'Ana Reyes', role: 'Receptionist', pw: 'demo1234', phone: '+639171234567' },
      { id: 'DR-2001', name: 'Dr. Alexander Reyes, MD', role: 'Doctor', pw: 'demo1234', phone: '+639191234569' },
      { id: 'RN-3001', name: 'Maria Panitan, RN', role: 'Nurse', pw: 'demo1234', phone: '+639181234568' },
    ],
    // Staff directory from hospital_queue_db.sql. st: available | busy | off
    staff: [
      { sid: 'DR-2001', name: 'Dr. Alexander Reyes, MD', role: 'Doctor', spec: 'Emergency Medicine Physician', st: 'available' },
      { sid: 'DR-2002', name: 'Dr. Luis Ocampo, MD', role: 'Doctor', spec: 'Internal Medicine Physician', st: 'busy' },
      { sid: 'DR-2003', name: 'Dr. Bianca Jimenez, MD', role: 'Doctor', spec: 'Family Medicine Physician', st: 'available' },
      { sid: 'DR-2004', name: 'Dr. Manuel Griego, MD', role: 'Doctor', spec: 'Dermatologist', st: 'busy' },
      { sid: 'RN-3001', name: 'Maria Panitan, RN', role: 'Nurse', spec: 'Registered Nurse', st: 'available' },
      { sid: 'RN-3002', name: 'Sofia Panitan, RN', role: 'Nurse', spec: 'Registered Nurse', st: 'busy' },
      { sid: 'RN-3003', name: 'Jose Morillo, RN', role: 'Nurse', spec: 'Triage Nurse', st: 'available' },
    ],
    // st: waiting | in_care | admitted | out.  t0 = registered (ms); tSeen = seen (stops the wait clock)
    P: [
      { id: 1, n: 'Patrick Jackson', age: 58, p: 1, c: 'Chest pain', dx: 'Angina', room: 1, doc: 'Dr. Luis Ocampo, MD', nu: 'Maria Panitan, RN', t0: ago(84), tSeen: ago(60), st: 'in_care' },
      { id: 2, n: 'Angela Cruz', age: 34, p: 2, c: 'High fever', dx: 'Viral infection', room: 2, doc: 'Dr. Alexander Reyes, MD', nu: 'Sofia Panitan, RN', t0: ago(939), tSeen: ago(600), st: 'in_care' },
      { id: 3, n: 'Miguel Mapili', age: 27, p: 3, c: 'Ankle sprain', dx: 'Ankle sprain', room: 3, doc: 'Dr. Bianca Jimenez, MD', nu: 'Jose Morillo, RN', t0: ago(2657), st: 'waiting' },
      { id: 4, n: 'Joshua Villas', age: 19, p: 4, c: 'Minor rash', dx: 'Contact dermatitis', room: 4, doc: 'Dr. Manuel Griego, MD', nu: 'Maria Panitan, RN', t0: ago(3423), st: 'waiting' },
    ],
    tasks: [
      { id: 1, pid: 1, nurse: 'Maria Panitan, RN', title: 'Re-check', due: Date.now() - 60000 },
      { id: 2, pid: 2, nurse: 'Sofia Panitan, RN', title: 'Re-check', due: Date.now() + 20 * 60000 },
      { id: 3, pid: 3, nurse: 'Jose Morillo, RN', title: 'Re-check', due: Date.now() + 45 * 60000 },
      { id: 4, pid: 4, nurse: 'Maria Panitan, RN', title: 'Re-check', due: Date.now() + 15 * 60000 },
    ],
    // notification: [title, timestamp, detail, hot, onlyForName|null]
    NT: { Receptionist: [], Nurse: [], Doctor: [] },
  });
  TF.state.tid = 5;
  TF.blank = { reg: blankReg, account: blankAccount };

  // Staff ID format, same as the hospital prototype: REC-#### receptionist, RN-#### nurse, DR-#### doctor.
  TF.data.ID_PREFIX = { Receptionist: 'REC', Nurse: 'RN', Doctor: 'DR' };
  TF.data.ID_EXAMPLE = { Receptionist: 'REC-1001', Nurse: 'RN-3001', Doctor: 'DR-2001' };

  // Brings in accounts exported from the old PHP/MySQL `users` table (see src/accounts-import.js).
  // Passwords were PHP hashes and can't be read here, so each imported person sets a new one via "Forgot password?".
  TF.importAccounts = () => {
    const phone = (v) => { const d = String(v || '').replace(/\D/g, ''); return d.startsWith('0') ? '+63' + d.slice(1) : d.startsWith('63') ? '+' + d : d ? '+' + d : ''; };
    let n = 0;
    (window.TF_IMPORT || []).forEach((u) => {
      const id = String(u.staff_id || u.id || '').trim().toUpperCase(), name = u.full_name || u.name;
      const role = { rec: 'Receptionist', nurse: 'Nurse', doc: 'Doctor' }[u.role] || u.role;
      if (!id || !name) return;
      const old = S.accounts.find((a) => a.id === id);
      if (old && old.imp) { if (old.pw === null && u.pw) old.pw = u.pw; return; } // already imported; keep any password set since
      const acc = { id, name, role, pw: u.password || null, phone: phone(u.mobile || u.phone), imp: true };
      if (old) Object.assign(old, acc); else S.accounts.push(acc);  // a real account replaces a demo one with the same ID
      n++;
      const prof = S.staff.find((x) => x.sid === id);
      if (prof) { prof.name = name; if (u.status) prof.st = u.status; }
      else if (role !== 'Receptionist') S.staff.push({ sid: id, name, role, spec: u.specialty || u.spec || (role === 'Doctor' ? 'Physician' : 'Registered Nurse'), st: u.status || 'available' });
    });
    return n;
  };

  const PERSIST = ['P', 'NT', 'nid', 'tid', 'accounts', 'staff', 'tasks'];
  TF.store = {
    save() { try { const o = {}; PERSIST.forEach((k) => (o[k] = S[k])); localStorage.setItem(TF.config.STORE_KEY, JSON.stringify(o)); } catch (e) { /* in-memory only */ } },
    load() { try { const d = JSON.parse(localStorage.getItem(TF.config.STORE_KEY) || 'null'); if (d) PERSIST.forEach((k) => { if (d[k] !== undefined) S[k] = d[k]; }); } catch (e) { /* ignore */ } },
    reset() { try { localStorage.removeItem(TF.config.STORE_KEY); } catch (e) { /* ignore */ } },
  };
})();
