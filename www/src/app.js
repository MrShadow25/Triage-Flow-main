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
      return;
    }
    const r = S.role;
    const home = !S.sub && !S.notif && S.tab === TABS[r][0][0];
    const back = !!(S.sub || S.notif || (!home && r !== 'Receptionist'));
    const title = S.notif ? 'Notifications' : S.sub === 'detail' ? 'Patient Detail' : S.sub === 'priority' ? 'Set Priority' : TITLES[S.tab];
    const body = S.notif ? ui.notifications(r) : ui[r.toLowerCase()](S.tab, S.sub);
    app.className = r[0];
    app.innerHTML = appHeader({ title, back, dot: TF.unread(r) > 0 }) + `<div class="who">Welcome, <b>${esc(S.user.name)}</b> <span>${esc(S.user.id)} · ${esc(S.user.role)}</span></div><main>${body}</main>` + ui.nav(r, S.tab, S.notif);
  }

  function renderModal() {
    const open = !!S.tf;
    modalRoot.innerHTML = open ? ui.auth.modal(S.tf) : '';
    app.inert = open;               // keeps keyboard focus and screen readers inside the popup
    if (open && S.tf.stage === 'code') focusOtp(0);
  }

  const focusOtp = (i) => setTimeout(() => { const el = document.querySelector(`[data-otp="${i}"]`); if (el) el.focus(); }, 0);

  /* =====================  2FA  ===================== */
  const B = TF.backend, blank6 = () => ['', '', '', '', '', ''];
  const NET_MSG = 'Could not reach the server. Check your internet connection and try again.';
  let busy = false;

  function openTf(o) {
    S.tf = Object.assign({ stage: 'code', enroll: false, digits: blank6(), attempts: C.MAX_ATTEMPTS, error: '', busy: false, showKey: false, ack: false }, o);
    renderModal();
  }
  function closeTf(signOut) { S.tf = null; renderModal(); if (signOut) B.signOut(); }
  function backToLogin(msg) { S.tf = null; S.scr = 'login'; S.err = msg || ''; renderModal(); render(); }

  function setTfError(msg) {
    S.tf.error = msg;
    document.querySelectorAll('.otp').forEach((el) => { el.classList.add('err'); el.setAttribute('aria-invalid', 'true'); });
    const e = $('#otp-err'); if (e) e.textContent = msg;
    focusOtp(0);
  }

  async function verify() {
    const tf = S.tf; if (!tf || tf.stage !== 'code' || tf.busy) return;
    const code = tf.digits.join('');
    if (code.length < 6) return setTfError('Enter all 6 digits.');
    tf.busy = true;
    const r = await B.verify(tf.factorId, code);
    tf.busy = false;
    if (S.tf !== tf) return;                                   // cancelled while waiting
    if (r.error) {
      if (B.net(r.error)) return setTfError(NET_MSG);
      tf.attempts--;
      if (tf.attempts <= 0) { B.lock.trip(tf.sid); await B.signOut(); return backToLogin('Too many incorrect codes. Try again in 5 minutes.'); }
      return setTfError(`Incorrect code. ${tf.attempts} attempt${tf.attempts === 1 ? '' : 's'} left.`);
    }
    if (tf.enroll) {                                           // first link: create and store the recovery codes
      tf.codes = B.genCodes();
      const saved = await B.saveCodes(tf.codes);
      if (saved.error) return setTfError('Could not save recovery codes: ' + saved.error.message);
      tf.stage = 'codes'; renderModal();
    } else await finishLogin();
  }

  async function finishLogin() {
    const tf = S.tf, pr = await B.profile();
    if (!pr.data) { await B.signOut(); return backToLogin(B.net(pr.error) ? NET_MSG : 'Could not load your profile. Please sign in again.'); }
    const p = pr.data;
    if (tf && tf.expectRole && p.role !== tf.expectRole) { await B.signOut(); return backToLogin('Staff ID, password or role is incorrect.'); }
    S.tf = null; S.err = '';
    S.user = { id: p.staff_id, name: p.full_name, role: p.role };
    S.role = p.role; S.sel = null; S.tab = TABS[p.role][0][0]; S.sub = ''; S.notif = false; S.lf.pw = '';
    B.lock.clear(p.staff_id);
    try { await TF.engine.autoAssign(); } catch (e) { /* nothing to assign */ }
    await TF.sync.load();
    TF.sync.start(onSync);
    renderModal(); render(); toast('Signed in as ' + p.full_name);
  }

  /* =====================  LIVE DATA  ===================== */
  function onSync(fresh) {
    if (fresh && fresh[0]) toast(fresh[0][0] + (fresh[0][2] ? ' · ' + fresh[0][2] : ''));
    const a = document.activeElement;
    if (!S.user || (a && /INPUT|SELECT|TEXTAREA/.test(a.tagName))) return;   // don't interrupt typing; data is already updated
    syncing = true; render(); syncing = false;
  }
  // Runs a database action, refreshes the shared data, redraws, and shows a message.
  async function act(fn, okMsg) {
    let msg = '';
    try { const r = await fn(); msg = typeof okMsg === 'function' ? okMsg(r) : okMsg; }
    catch (e) { msg = (e && e.message) || 'Something went wrong. Please try again.'; if (B.net(e)) msg = NET_MSG; }
    await TF.sync.load(); render(); if (msg) toast(msg);
  }

  /* =====================  ACTIONS  ===================== */
  const fail = (msg) => { S.err = msg; render(); };
  const roleCode = () => (S.role === 'Doctor' ? 'doctor' : 'x');

  const A = {
    /* --- auth navigation & forms --- */
    role(d) { S.role = d.v; S.err = ''; render(); },
    goto(d) { S.scr = d.v; S.err = ''; render(); },

    async signin() {
      if (busy) return;
      const id = S.lf.id.trim().toUpperCase(), pw = S.lf.pw;
      if (!id || !pw) return fail('Enter your Staff ID and password.');
      const left = B.lock.left(id);
      if (left > 0) return fail(`Too many failed attempts. Try again in ${Math.ceil(left / 60000)} minute${left > 60000 ? 's' : ''}.`);
      busy = true; toast('Signing in…');
      try {
        const r = await B.signIn(id, pw);
        if (r.error) { if (B.net(r.error)) return fail(NET_MSG); B.lock.fail(id); return fail('Staff ID, password or role is incorrect.'); }
        const fl = await B.verifiedFactors();
        S.err = '';
        if (fl.length) openTf({ purpose: 'login', sid: id, expectRole: S.role, factorId: fl[0].id });
        else {                                                  // password OK but no authenticator linked yet (set-up was interrupted)
          const e = await B.enroll();
          if (e.error) { await B.signOut(); return fail(e.error.message); }
          openTf({ purpose: 'login', sid: id, expectRole: S.role, enroll: true, factorId: e.factorId, secret: e.secret, uri: e.uri });
        }
      } finally { busy = false; }
    },

    async 'create-account'() {
      if (busy) return;
      const a = S.ca, id = a.id.trim().toUpperCase(), phone = a.phone.trim() ? normalizePhone(a.phone) : '';
      if (a.name.trim().length < 2) return fail('Enter your full name.');
      const pre = TF.data.ID_PREFIX[a.role];
      if (!new RegExp('^' + pre + '-\\d{3,6}$').test(id)) return fail(`A ${a.role} Staff ID looks like ${TF.data.ID_EXAMPLE[a.role]} (${pre}- followed by numbers).`);
      const bad = B.pw.problems(a.pw, id);
      if (bad.length) return fail('Password needs: ' + bad.join(', ') + '.');
      if (!a.code) return fail('Enter the hospital code.');
      if (a.phone.trim() && !phone) return fail('Enter a valid Philippine mobile number, e.g. +63 917 123 4567, or leave it empty.');
      busy = true; toast('Creating account…');
      try {
        const r = await B.signUp({ ...a, id, phone: phone || '' });
        if (r.error) {
          if (B.net(r.error)) return fail(NET_MSG);
          if (/already registered/i.test(r.error.message)) return fail('That Staff ID is already registered.');
          if (/invalid/i.test(r.error.message) && /email/i.test(r.error.message)) return fail('Supabase rejected the generated login address. Set emailDomain in supabase-config.js to a real domain.');
          return fail('Could not create the account. Check the hospital code, and that the Staff ID matches your role and is not already registered.');
        }
        if (!r.data.session) return fail('Account created but email confirmation is still ON in Supabase. Turn it off (Authentication → Sign In / Providers → Email).');
        const e = await B.enroll();
        if (e.error) { await B.signOut(); return fail(e.error.message); }
        S.err = '';
        openTf({ purpose: 'verify', sid: id, expectRole: a.role, enroll: true, factorId: e.factorId, secret: e.secret, uri: e.uri });
      } finally { busy = false; }
    },

    async 'change-password'() {
      if (busy) return;
      const c = S.cp, id = c.id.trim().toUpperCase();
      if (!id || !c.code || !c.rc) return fail('Enter your Staff ID, hospital code and a recovery code.');
      const bad = B.pw.problems(c.pw, id);
      if (bad.length) return fail('Password needs: ' + bad.join(', ') + '.');
      if (c.pw !== c.pw2) return fail('Passwords must match.');
      busy = true; toast('Resetting password…');
      try {
        const r = await TF.backend.resetPassword(id, c.code, c.rc, c.pw);
        if (r.error) return fail(B.net(r.error) ? NET_MSG : 'Could not reset the password. Please try again.');
        if (!r.data.ok) return fail(r.data.error);
        S.lf = { id, pw: '' }; S.cp = { id: '', pw: '', pw2: '', code: '', rc: '' }; S.scr = 'login'; S.err = '';
        render(); toast('Password changed. Sign in with your new password.');
      } finally { busy = false; }
    },

    'toggle-pw'(d) { const i = document.getElementById(d.v); if (i) i.type = i.type === 'password' ? 'text' : 'password'; },

    /* --- 2FA --- */
    verify,
    cancel2fa() { closeTf(true); },
    'toggle-key'() { S.tf.showKey = !S.tf.showKey; renderModal(); },
    'copy-key'() {
      const k = S.tf && S.tf.secret; if (!k) return;
      (navigator.clipboard ? navigator.clipboard.writeText(k) : Promise.reject()).then(() => toast('Key copied'), () => toast('Select the key and copy it by hand'));
    },
    'lost-auth'() { S.rc.code = ''; S.tf.stage = 'recovery'; S.tf.error = ''; renderModal(); },
    'back-to-code'() { S.tf.stage = 'code'; S.tf.error = ''; renderModal(); },
    async 'use-recovery'() {
      const tf = S.tf; if (!tf || busy) return;
      if (S.rc.code.replace(/[^a-z0-9]/gi, '').length < 10) { tf.error = 'Enter the full recovery code.'; return renderModal(); }
      busy = true;
      try {
        const r = await B.useRecovery(S.rc.code);
        if (r.error) { tf.error = B.net(r.error) ? NET_MSG : 'Could not check the code.'; return renderModal(); }
        if (!r.data.ok) { tf.error = r.data.error; return renderModal(); }
        const e = await B.enroll();                              // the old authenticator was removed: link a new one
        if (e.error) { tf.error = e.error.message; return renderModal(); }
        openTf({ purpose: 'login', sid: tf.sid, expectRole: tf.expectRole, enroll: true, factorId: e.factorId, secret: e.secret, uri: e.uri });
        toast('Recovery code accepted. Link your new authenticator.');
      } finally { busy = false; }
    },
    'copy-codes'() {
      const t = S.tf && S.tf.codes; if (!t) return;
      (navigator.clipboard ? navigator.clipboard.writeText(t.join('\n')) : Promise.reject()).then(() => toast('Codes copied'), () => toast('Select the codes and copy them by hand'));
    },
    'ack-codes'() { S.tf.ack = !S.tf.ack; renderModal(); },
    async 'codes-done'() { if (!S.tf.ack) return toast('Tick the box once your codes are saved.'); await finishLogin(); },

    /* --- session / navigation --- */
    async logout() { TF.sync.stop(); await B.signOut(); S.user = null; S.scr = 'login'; S.err = ''; render(); },
    bell() { S.notif = true; S.seen = S.seen || {}; S.seen[S.user.id] = Date.now(); render(); },
    tab(d) { S.tab = d.v; S.sub = ''; S.notif = false; S.err = ''; render(); },
    back() { if (S.notif) S.notif = false; else if (S.sub) S.sub = ''; else S.tab = TABS[S.role][0][0]; render(); },

    /* --- receptionist --- */
    'reg-next'() {
      const f = S.f, age = Number(f.a);
      if (f.n.trim().length < 2) return fail('Enter the patient’s full name.');
      if (f.a === '' || !Number.isInteger(age) || age < 0 || age > 120) return fail('Enter a valid age (0–120).');
      if (f.c.trim().length < 2) return fail('Enter the patient’s complaint.');
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
      return act(async () => {
        const p = await TF.engine.register(S.f, S.pri, S.syms.filter((x, i) => S.chk.includes(i)));
        S.f = TF.blank.reg(); S.syms = [...TF.data.SYM]; S.chk = [0, 1, 2, 3, 4]; S.pri = 1; S.sub = ''; S.tab = 'queue';
        return p;
      }, (p) => `${p.n} added${p.doc ? ' · assigned to ' + p.doc : ' · waiting for a doctor'}`);
    },
    'delete-patient'(d) {
      const p = TF.patients.byId(d.id);
      if (!p) return;
      if (!['waiting', 'in_care'].includes(p.st)) return toast('Only waiting or in-care patients can be deleted.');
      if (!confirm(`Permanently delete ${p.n}'s queue registration?`)) return;
      return act(() => TF.engine.remove(p), 'Patient registration deleted.');
    },
    'reassign-patient'(d) { const p = TF.patients.byId(d.id); S.sel = +d.id; S.rd = p.doc; S.rn = p.nu; A.tab({ v: 'reassign' }); },
    room(d) { S.room = +d.v; render(); },
    'room-assign'() {
      const p = TF.patients.byId(S.rp);
      if (!p) return toast('Select a patient first');
      if (!S.room) return toast('Select an available room first');
      if (TF.patients.active().some((x) => x.room == S.room)) return toast('That room is occupied');
      return act(async () => { await TF.engine.setRoom(p, S.room); S.room = null; }, p.n + ' placed in the room');
    },
    'room-clear'() {
      const p = TF.patients.byId(S.rp);
      if (!p) return toast('Select a patient first');
      return act(() => TF.engine.setRoom(p, null), p.n + ' removed from room');
    },
    pick(d) { S[d.k] = d.v; render(); },
    'confirm-reassign'() {
      const p = TF.patients.byId(S.sel); if (!p) return;
      if (!S.rd || !S.rn) return toast('Choose both a doctor and a nurse.');
      return act(async () => { await TF.engine.reassign(p, S.rd, S.rn); S.rd = S.rn = null; S.tab = 'queue'; S.sub = ''; S.notif = false; S.err = ''; }, 'Reassignment confirmed');
    },
    async export() {
      const s = TF.engine.summary();
      const rows = [
        ['Shift', s.shift],
        ['Patients', s.total],
        ['Average wait (minutes)', s.avg],
        ['Admitted', s.admitted],
        ['Discharged', s.out]
      ];

      const csv = '\uFEFF' + rows.map((r) =>
        r.map((v) => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')
      ).join('\r\n');

      const filename = 'shift-summary-' +
        new Date().toISOString().slice(0, 10) + '.csv';

      if (window.Capacitor?.isNativePlatform()) {
        try {
          const plugins = window.TFNativePlugins;

          if (!plugins?.Filesystem || !plugins?.Share) {
            throw new Error('Capacitor plugins unavailable');
          }

          const saved = await plugins.Filesystem.writeFile({
            path: filename,
            data: csv,
            directory: plugins.Directory.Cache,
            encoding: 'utf8'
          });

          await plugins.Share.share({
            title: 'TriageFlow Shift Summary',
            text: 'TriageFlow Shift Summary',
            files: [saved.uri],
            dialogTitle: 'Share Shift Summary'
          });

          toast('Summary ready to share');
        } catch (error) {
          console.error('Summary export failed:', error);
          if (error.name !== 'AbortError') {
            toast('Unable to export summary');
          }
        }

        return;
      }

      const blob = new Blob([csv], {
        type: 'text/csv;charset=utf-8'
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');

      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();

      setTimeout(() => URL.revokeObjectURL(url), 1000);

      toast('Summary exported');
    },
    /* --- nurse + doctor shared --- */
    'my-status'(d) { const me = TF.staff.me(); if (!me) return toast('No staff profile for this account'); return act(() => TF.engine.setStaffStatus(me, d.v), 'Status updated'); },
    'task-done'(d) { return act(() => TF.engine.completeTask(+d.id), 'Task marked done — next re-check scheduled'); },

    /* --- doctor --- */
    'open-patient'(d) { S.sel = +d.id; S.dxv = TF.patients.byId(S.sel).dx === 'Pending' ? '' : TF.patients.byId(S.sel).dx; S.sub = 'detail'; S.notif = false; render(); },
    'save-dx'() { const p = TF.patients.byId(S.sel); if (!p) return; return act(() => TF.engine.saveDx(p, S.dxv), 'Diagnosis saved'); },
    'patient-status'(d) {
      const p = TF.patients.byId(S.sel); if (!p) return;
      return act(async () => { await TF.engine.status(p, d.v); if (d.v === 'out') S.sub = ''; },
        d.v === 'out' ? p.n + ' discharged — room and staff freed' : d.v === 'admitted' ? 'Patient admitted' : 'Marked as seen');
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
    if (!S.tf) { const again = $(sel); if (again && document.activeElement !== again && !app.inert) again.focus(); }
  });

  // Two-way binding: <input data-model="lf.id"> writes straight into state.
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.model) {
      setPath(S, t.dataset.model, t.value);
      if (t.dataset.model === 'ca.pw' || t.dataset.model === 'cp.pw') {      // live password hint
        const h = $('#pw-hint'), id = t.dataset.model === 'ca.pw' ? S.ca.id : S.cp.id, bad = TF.backend.pw.problems(t.value, id);
        if (h) { h.className = 'mu pwhint ' + (t.value ? (bad.length ? 'bad' : 'good') : ''); h.textContent = !t.value ? `At least ${C.MIN_PASSWORD} characters with upper case, lower case and a number.` : bad.length ? 'Still needs: ' + bad.join(', ') : 'Password looks good.'; }
      }
      return;
    }
    if (t.dataset.otp === undefined || !S.tf) return;
    const i = +t.dataset.otp, v = t.value.replace(/\D/g, '').slice(-1);
    t.value = v; S.tf.digits[i] = v;
    if (S.tf.error) {            // typing clears the red error state
      S.tf.error = ''; const oe = $('#otp-err'); if (oe) oe.textContent = '';
      document.querySelectorAll('.otp').forEach((el) => { el.classList.remove('err'); el.removeAttribute('aria-invalid'); });
    }
    if (v && i < 5) focusOtp(i + 1);
  });

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (e.key === 'Escape' && S.tf && S.tf.stage !== 'codes') { closeTf(true); return; }
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
      const box = t.closest('.card, .modal'), btn = box && box.querySelector('.btn[data-action]');
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
  }, 1000);

  window.addEventListener('beforeunload', () => TF.store.save());

  /* =====================  START  ===================== */
  TF.store.load();
  render();
  if (B.ready) B.restore().then((ok) => { if (ok) return finishLogin(); }).catch(() => {});   // reopen straight into the app if 2FA was already done
})();
