/* state.js — config, constants, the single app state object and persistence. */
(function () {
  'use strict';
  const TF = window.TF;

  TF.config = {
    DEMO_MODE: true, MAX_ATTEMPTS: 3, RESEND_SECONDS: 30, CODE_TTL_MS: 5 * 60 * 1000, MIN_PASSWORD: 8,
    STORE_KEY: 'triageflow-v3',
    RECHECK_MIN: { 1: 15, 2: 30, 3: 60, 4: 120, 5: 240 }, // nurse re-check interval per priority
    MAX_LOAD: { Doctor: 3, Nurse: 2 },                    // max active patients per doctor / nurse (from hospital config.php)
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

  const blankReg = () => ({ n: '', a: '', c: '' });
  const blankAccount = () => ({ name: '', id: '', role: 'Nurse', pw: '', code: '', phone: '', spec: '' });

  // NOTE: prototype only. Passwords are plain text in localStorage. A real build must hash them server-side.
  const S = (TF.state = {
    user: null, role: 'Receptionist', scr: 'login', tab: '', sub: '', notif: false,
    err: '', tf: null,
    lf: { id: '', pw: '' }, ca: blankAccount(), cp: { id: '', pw: '', pw2: '', code: '', rc: '' }, rc: { code: '' },
    // working data (memory only)
    sel: null, room: null, rp: '', dxv: '', newSym: '', rd: null, rn: null,
    f: blankReg(), syms: [...TF.data.SYM], chk: [0, 1, 2, 3, 4], pri: 1,
    // shared data (persisted + synced between tabs)
    seen: {},   // per user: when they last opened the bell
    nid: 5, tid: 5,
    // shared data: loaded from Supabase by sync.js (never stored on the phone)
    staff: [], P: [], tasks: [],
    NT: { Receptionist: [], Nurse: [], Doctor: [] },   // notification: [title, timestamp, detail, hot, onlyForName|null]
  });
  TF.state.tid = 5;
  TF.blank = { reg: blankReg, account: blankAccount };

  // Staff ID format, same as the hospital prototype: REC-#### receptionist, RN-#### nurse, DR-#### doctor.
  TF.data.ID_PREFIX = { Receptionist: 'REC', Nurse: 'RN', Doctor: 'DR' };
  TF.data.ID_EXAMPLE = { Receptionist: 'REC-1001', Nurse: 'RN-3001', Doctor: 'DR-2001' };

  const PERSIST = ['seen'];
  TF.store = {
    save() { try { const o = {}; PERSIST.forEach((k) => (o[k] = S[k])); localStorage.setItem(TF.config.STORE_KEY, JSON.stringify(o)); } catch (e) { /* in-memory only */ } },
    load() { try { const d = JSON.parse(localStorage.getItem(TF.config.STORE_KEY) || 'null'); if (d) PERSIST.forEach((k) => { if (d[k] !== undefined) S[k] = d[k]; }); } catch (e) { /* ignore */ } },
    reset() { try { localStorage.removeItem(TF.config.STORE_KEY); } catch (e) { /* ignore */ } },
  };
})();
