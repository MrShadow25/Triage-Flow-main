/* app.js — rendering, event handling (one delegated listener), 2FA logic and start-up. */
(function () {
  'use strict';
  const TF = window.TF, S = TF.state, C = TF.config;
  const { $, esc, fmt, toast, setPath, normalizePhone, randomCode } = TF.utils;
  const { TABS, TITLES } = TF.data;
  const { authHeader, appHeader } = TF.components.header;
  const ui = TF.components;

  const app = $('#app'), modalRoot = $('#modal');

  /* =====================  RENDER  ===================== */
  let syncing = false;
  function render() {
    if (!syncing) TF.store.save();
    if (!S.user) {
      app.className = 'login';
      app.innerHTML = ui.auth.screen();
      if (S.scr === 'vn') focusOtp(0);
      return;
    }
    const r = S.role;
    const home = !S.sub && !S.notif && S.tab === TABS[r][0][0];
    const back = !!(S.sub || S.notif || (!home && r !== 'Receptionist'));
    const title = S.notif ? 'Notifications' : S.sub === 'detail' ? 'Patient Detail' : S.sub === 'priority' ? 'Set Priority' : TITLES[S.tab];
    const body = S.notif ? ui.notifications(r) : ui[r.toLowerCase()](S.tab, S.sub);
    app.className = r[0];
    app.innerHTML = appHeader({ title, back, dot: TF.hasHot(r) }) + `<main>${body}</main>` + ui.nav(r, S.tab, S.notif);
  }

  function renderModal() {
    const open = !!(S.tf && S.scr !== 'vn');
    modalRoot.innerHTML = open ? ui.auth.modal(S.tf) : '';
    app.inert = open;               // keeps keyboard focus and screen readers inside the popup
    if (open) focusOtp(0);
  }

  const focusOtp = (i) => setTimeout(() => { const el = document.querySelector(`[data-otp="${i}"]`); if (el) el.focus(); }, 0);

  /* =====================  2FA  ===================== */
  function newTf(purpose, ctx, phone) {
    return {
      purpose, ctx, phone, code: randomCode(), digits: ['', '', '', '', '', ''],
      attempts: C.MAX_ATTEMPTS, error: '',
      expires: Date.now() + C.CODE_TTL_MS, resendAt: Date.now() + C.RESEND_SECONDS * 1000,
    };
  }
  function start2FA(purpose, ctx, phone) {
    S.tf = newTf(purpose, ctx, phone);
    S.scr === 'vn' ? render() : renderModal();
  }
  function closeTf() { S.tf = null; renderModal(); }

  function setTfError(msg) {
    S.tf.error = msg;
    document.querySelectorAll('.otp').forEach((el) => { el.classList.add('err'); el.setAttribute('aria-invalid', 'true'); });
    const e = $('#otp-err'); if (e) e.textContent = msg;
    focusOtp(0);
  }

  function verify() {
    const tf = S.tf; if (!tf) return;
    const entered = tf.digits.join('');
    if (entered.length < 6) return setTfError('Enter all 6 digits.');
    if (Date.now() > tf.expires) return setTfError('This code has expired. Request a new one.');
    if (entered !== tf.code) {
      tf.attempts--;
      if (tf.attempts <= 0) {
        const back = tf.purpose === 'verify' ? 'ca' : tf.purpose === 'reset' ? 'cp' : 'login';
        S.tf = null; S.scr = back; S.err = 'Too many incorrect codes. Please start again.';
        renderModal(); render(); return;
      }
      return setTfError(`Incorrect code. Please try again. ${tf.attempts} attempt${tf.attempts === 1 ? '' : 's'} left.`);
    }
    completeTf(tf);
  }

  function completeTf(tf) {
    S.tf = null; S.err = '';
    if (tf.purpose === 'login') {
      const acc = S.accounts.find((a) => a.id === tf.ctx.id);
      S.user = acc; S.role = acc.role; S.sel = null; S.tab = TABS[acc.role][0][0]; S.sub = ''; S.notif = false; S.lf.pw = '';
      toast('Signed in as ' + acc.name);
    } else if (tf.purpose === 'verify') {
      const a = S.ca;
      S.accounts.push({ id: a.id.trim().toUpperCase(), name: a.name.trim(), role: a.role, pw: a.pw, phone: a.phone });
      const nm = a.name.trim();
      if (a.role !== 'Receptionist' && !S.staff.some((x) => x.name === nm)) S.staff.push({ name: nm, role: a.role, spec: a.role === 'Doctor' ? 'Physician' : 'Staff Nurse', st: 'available' });
      TF.engine.autoAssign();
      S.lf = { id: a.id.trim().toUpperCase(), pw: '' }; S.role = a.role; S.ca = TF.blank.account(); S.scr = 'login';
      toast('Number verified. Account created. Sign in to continue.');
    } else if (tf.purpose === 'reset') {
      S.accounts.find((a) => a.id === tf.ctx.id).pw = tf.ctx.pw;
      S.cp = { id: '', pw: '', pw2: '' }; S.scr = 'login';
      toast('Password changed. Sign in with your new password.');
    }
    renderModal(); render();
  }

  /* =====================  ACTIONS  ===================== */
  const fail = (msg) => { S.err = msg; render(); };
  const roleCode = () => (S.role === 'Doctor' ? 'doctor' : 'x');

  const A = {
    /* --- auth navigation & forms --- */
    role(d) { S.role = d.v; S.err = ''; render(); },
    goto(d) { S.scr = d.v; S.err = ''; render(); },

    signin() {
      const id = S.lf.id.trim().toUpperCase();
      if (!id || !S.lf.pw) return fail('Enter your Staff ID and password.');
      const acc = S.accounts.find((a) => a.id === id);
      if (!acc || acc.pw !== S.lf.pw || acc.role !== S.role) return fail('Staff ID, password or role is incorrect.');
      S.err = '';
      start2FA('login', { id: acc.id }, acc.phone);
    },

    'create-account'() {
      const a = S.ca, id = a.id.trim().toUpperCase(), phone = normalizePhone(a.phone);
      if (a.name.trim().length < 2) return fail('Enter your full name.');
      if (!/^[A-Z0-9-]{4,12}$/.test(id)) return fail('Staff ID should be 4–12 letters, numbers or dashes, e.g. RC-1041.');
      if (S.accounts.some((x) => x.id === id)) return fail('That Staff ID already has an account.');
      if (a.pw.length < C.MIN_PASSWORD) return fail(`Password must be at least ${C.MIN_PASSWORD} characters.`);
      if (!a.code.trim()) return fail('Enter your hospital code.');
      if (!phone) return fail('Enter a valid Philippine mobile number, e.g. +63 917 123 4567.');
      a.phone = phone; S.err = ''; S.scr = 'vn';
      start2FA('verify', {}, phone);
    },

    'change-number'() { S.tf = null; S.scr = 'ca'; S.err = ''; render(); },

    'change-password'() {
      const c = S.cp, id = c.id.trim().toUpperCase(), acc = S.accounts.find((a) => a.id === id);
      if (!acc) return fail('No account found for that Staff ID.');
      if (c.pw.length < C.MIN_PASSWORD) return fail(`Password must be at least ${C.MIN_PASSWORD} characters.`);
      if (c.pw !== c.pw2) return fail('Passwords must match.');
      S.err = '';
      start2FA('reset', { id: acc.id, pw: c.pw }, acc.phone);
    },

    /* --- 2FA --- */
    verify,
    cancel2fa() { closeTf(); },
    resend() {
      const tf = S.tf; if (!tf) return;
      Object.assign(tf, { code: randomCode(), digits: ['', '', '', '', '', ''], attempts: C.MAX_ATTEMPTS, error: '',
        expires: Date.now() + C.CODE_TTL_MS, resendAt: Date.now() + C.RESEND_SECONDS * 1000 });
      S.scr === 'vn' ? render() : renderModal();
      toast('A new code was sent.');
    },

    /* --- session / navigation --- */
    logout() { S.user = null; S.scr = 'login'; S.err = ''; render(); },
    bell() { S.notif = true; render(); },
    tab(d) { S.tab = d.v; S.sub = ''; S.notif = false; S.err = ''; render(); },
    back() { if (S.notif) S.notif = false; else if (S.sub) S.sub = ''; else S.tab = TABS[S.role][0][0]; render(); },

    /* --- receptionist --- */
    'reg-next'() {
      const f = S.f, age = f.a === '' ? null : Number(f.a);
      if (!f.n.trim() || !f.c.trim()) return fail('Enter a patient name and complaint.');
      if (age !== null && (!Number.isFinite(age) || age < 0 || age > 120)) return fail('Enter an age between 0 and 120.');
      S.err = ''; S.sub = 'priority'; render();
    },
    chk(d) { const i = +d.i; S.chk = S.chk.includes(i) ? S.chk.filter((x) => x !== i) : [...S.chk, i]; render(); },
    'add-sym'() {
      const v = S.newSym.trim().slice(0, 60);
      if (!v) return;
      if (S.syms.some((x) => x.toLowerCase() === v.toLowerCase())) return toast('Symptom already exists.');
      S.syms.push(v); S.chk.push(S.syms.length - 1); S.newSym = ''; render();
    },
    'rm-sym'(d) { const i = +d.i; S.syms.splice(i, 1); S.chk = S.chk.filter((x) => x !== i).map((x) => (x > i ? x - 1 : x)); render(); },
    pri(d) { S.pri = +d.v; render(); },

    'confirm-queue'() {
      const p = TF.engine.register(S.f, S.pri, S.syms.filter((x, i) => S.chk.includes(i)));
      S.f = TF.blank.reg(); S.syms = [...TF.data.SYM]; S.chk = [0, 1, 2, 3, 4]; S.pri = 1; S.sub = ''; S.tab = 'queue';
      render(); toast(`${p.n} added${p.doc ? ' · assigned to ' + p.doc : ' · waiting for a doctor'}`);
    },
    'delete-patient'(d) {
      const p = TF.patients.byId(d.id);
      if (!p || !confirm(`Permanently delete ${p.n}'s queue registration?`)) return;
      TF.engine.remove(p); render(); toast('Patient registration deleted.');
    },
    'reassign-patient'(d) { const p = TF.patients.byId(d.id); S.sel = +d.id; S.rd = p.doc; S.rn = p.nu; A.tab({ v: 'reassign' }); },
    room(d) { S.room = +d.v; render(); },
    'room-assign'() {
      const p = TF.patients.byId(S.rp);
      if (!p) return toast('Select a patient first');
      if (!S.room) return toast('Select an available room first');
      if (TF.patients.active().some((x) => x.room == S.room)) return toast('That room is occupied');
      TF.engine.setRoom(p, S.room); S.room = null; render(); toast(p.n + ' placed in the room');
    },
    'room-clear'() {
      const p = TF.patients.byId(S.rp);
      if (!p) return toast('Select a patient first');
      TF.engine.setRoom(p, null); render(); toast(p.n + ' removed from room');
    },
    pick(d) { S[d.k] = d.v; render(); },
    'confirm-reassign'() {
      const p = TF.patients.byId(S.sel); if (!p) return;
      if (!S.rd || !S.rn) return toast('Choose both a doctor and a nurse.');
      TF.engine.reassign(p, S.rd, S.rn); S.rd = S.rn = null;
      A.tab({ v: 'queue' }); toast('Reassignment confirmed');
    },
    export() {
      const s = TF.engine.summary();
      const rows = [['Shift', s.shift], ['Patients', s.total], ['Average wait (minutes)', s.avg], ['Admitted', s.admitted], ['Discharged', s.out]];
      const csv = rows.map((r) => r.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
      const a = document.createElement('a');
      a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv); a.download = 'shift-summary-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
      toast('Summary exported');
    },
    'reset-demo'() { TF.store.reset(); location.reload(); },

    /* --- nurse + doctor shared --- */
    'my-status'(d) { const me = TF.staff.me(); if (!me) return toast('No staff profile for this account'); TF.engine.setStaffStatus(me, d.v); render(); toast('Status updated'); },
    'task-done'(d) { TF.engine.completeTask(+d.id); render(); toast('Task marked done — next re-check scheduled'); },

    /* --- doctor --- */
    'open-patient'(d) { S.sel = +d.id; S.dxv = TF.patients.byId(S.sel).dx; S.sub = 'detail'; S.notif = false; render(); },
    'save-dx'() { const p = TF.patients.byId(S.sel); if (!p) return; TF.engine.saveDx(p, S.dxv); render(); toast('Diagnosis saved'); },
    'patient-status'(d) {
      const p = TF.patients.byId(S.sel); if (!p) return;
      TF.engine.status(p, d.v);
      if (d.v === 'out') { S.sub = ''; toast(p.n + ' discharged — room and staff freed'); }
      else toast(d.v === 'admitted' ? p.n + ' admitted' : 'Marked as seen');
      render();
    },
  };

  /* =====================  EVENTS  ===================== */
  // Rebuild a selector for the clicked control so keyboard focus survives a re-render.
  function selectorFor(el) {
    return '[data-action="' + el.dataset.action + '"]' + ['v', 'id', 'i', 'k'].filter((k) => el.dataset[k] !== undefined)
      .map((k) => `[data-${k}="${CSS.escape(el.dataset[k])}"]`).join('');
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const fn = A[el.dataset.action];
    if (!fn) return;
    const sel = selectorFor(el);
    fn(el.dataset);
    if (!S.tf || S.scr === 'vn') { const again = $(sel); if (again && document.activeElement !== again && !app.inert) again.focus(); }
  });

  // Two-way binding: <input data-model="lf.id"> writes straight into state.
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.model) { setPath(S, t.dataset.model, t.value); return; }
    if (t.dataset.otp === undefined || !S.tf) return;
    const i = +t.dataset.otp, v = t.value.replace(/\D/g, '').slice(-1);
    t.value = v; S.tf.digits[i] = v;
    if (S.tf.error) {            // typing clears the red error state
      S.tf.error = ''; $('#otp-err').textContent = '';
      document.querySelectorAll('.otp').forEach((el) => { el.classList.remove('err'); el.removeAttribute('aria-invalid'); });
    }
    if (v && i < 5) focusOtp(i + 1);
  });

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (e.key === 'Escape' && S.tf && S.scr !== 'vn') { closeTf(); return; }
    if (t.dataset && t.dataset.otp !== undefined && S.tf) {
      const i = +t.dataset.otp;
      if (e.key === 'Backspace' && !t.value && i > 0) { S.tf.digits[i - 1] = ''; const p = document.querySelector(`[data-otp="${i - 1}"]`); p.value = ''; p.focus(); }
      else if (e.key === 'ArrowLeft' && i > 0) focusOtp(i - 1);
      else if (e.key === 'ArrowRight' && i < 5) focusOtp(i + 1);
      else if (e.key === 'Enter') verify();
      return;
    }
    // Enter inside a form field presses that card's main button.
    if (e.key === 'Enter' && t.matches && t.matches('input[data-model]')) {
      const btn = t.closest('.card').querySelector('.btn[data-action]');
      if (btn) btn.click();
    }
  });

  // Pasting a full code into any box fills all six.
  document.addEventListener('paste', (e) => {
    const t = e.target;
    if (!t.dataset || t.dataset.otp === undefined || !S.tf) return;
    e.preventDefault();
    const digits = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6 - +t.dataset.otp);
    [...digits].forEach((d, k) => {
      const idx = +t.dataset.otp + k;
      S.tf.digits[idx] = d; document.querySelector(`[data-otp="${idx}"]`).value = d;
    });
    focusOtp(Math.min(5, +t.dataset.otp + digits.length));
  });

  /* =====================  TIMERS  ===================== */
  setInterval(() => {
    document.querySelectorAll('[data-t]').forEach((el) => { const p = TF.patients.byId(el.dataset.t); if (p) el.textContent = fmt(TF.patients.wait(p)); });
    document.querySelectorAll('[data-due]').forEach((el) => { const t = S.tasks.find((x) => x.id == el.dataset.due); if (t) el.textContent = TF.utils.duePhrase(t.due); });
    if (S.tf) { // 2FA resend countdown
      const el = $('#resend'), html = ui.auth.resendHtml(S.tf);
      if (el && el.innerHTML !== html) el.innerHTML = html;
    }
  }, 1000);

  // Live sync: another tab/window of the app (e.g. a doctor signed in next to the receptionist) changed the data.
  window.addEventListener('storage', (e) => {
    if (e.key !== C.STORE_KEY) return;
    TF.store.load();
    const a = document.activeElement;
    if (a && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) return; // don't interrupt typing; data is already updated
    syncing = true; render(); syncing = false;
  });

  window.addEventListener('beforeunload', () => TF.store.save());

  /* =====================  START  ===================== */
  TF.store.load();
  render();
})();
