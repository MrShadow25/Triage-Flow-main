/* backend.js — everything that talks to Supabase (sign-in, authenticator 2FA, recovery codes, password reset). */
(function () {
  'use strict';
  const TF = window.TF, cfg = window.TF_SUPABASE || {};
  const ready = !!(window.supabase && cfg.url && cfg.anonKey && !/YOUR-/.test(cfg.url + cfg.anonKey));
  const sb = ready ? window.supabase.createClient(cfg.url, cfg.anonKey) : null;
  const email = (id) => id.trim().toLowerCase() + '@' + (cfg.emailDomain || 'triageflow.app'); // Staff ID -> login "email"
  const net = (e) => !e || (!e.status && !e.code);                                              // no HTTP answer = network problem

  /* ----- password rules (the server checks the same rules) ----- */
  const pw = {
    problems(p, id) {
      const out = [];
      if (p.length < TF.config.MIN_PASSWORD) out.push(TF.config.MIN_PASSWORD + '+ characters');
      if (!/[a-z]/.test(p)) out.push('a lowercase letter');
      if (!/[A-Z]/.test(p)) out.push('an uppercase letter');
      if (!/[0-9]/.test(p)) out.push('a number');
      if (id && id.trim().length > 2 && p.toLowerCase().includes(id.trim().toLowerCase())) out.push('no Staff ID inside it');
      return out;
    },
  };

  /* ----- sign-in lockout on this device (5 wrong tries = 5 minutes). The server adds its own limits on top. ----- */
  const LK = 'triageflow-lock';
  const rd = () => { try { return JSON.parse(localStorage.getItem(LK) || '{}'); } catch (e) { return {}; } };
  const wr = (o) => { try { localStorage.setItem(LK, JSON.stringify(o)); } catch (e) { /* ignore */ } };
  const lock = {
    left(id) { const r = rd()[id.toUpperCase()]; return r && r.until > Date.now() ? r.until - Date.now() : 0; },
    fail(id) { const o = rd(), k = id.toUpperCase(), r = o[k] || { fails: 0, until: 0 }; if (r.until && r.until <= Date.now()) r.fails = 0; r.fails++; if (r.fails >= 5) { r.until = Date.now() + 5 * 60000; r.fails = 0; } o[k] = r; wr(o); },
    trip(id) { const o = rd(); o[id.toUpperCase()] = { fails: 0, until: Date.now() + 5 * 60000 }; wr(o); },
    clear(id) { const o = rd(); delete o[id.toUpperCase()]; wr(o); },
  };

  /* ----- recovery codes: 8 codes, 10 characters each (50 bits), shown once ----- */
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 symbols, no I/O/0/1, so no modulo bias
  function genCodes() {
    return Array.from({ length: 8 }, () => {
      const b = crypto.getRandomValues(new Uint8Array(10)), s = [...b].map((x) => ALPHA[x % 32]).join('');
      return s.slice(0, 5) + '-' + s.slice(5);
    });
  }

  async function enroll() {
    const fl = await sb.auth.mfa.listFactors();                      // clear half-finished set-ups from an earlier attempt
    for (const f of (fl.data && fl.data.all) || []) if (f.factor_type === 'totp' && f.status === 'unverified') await sb.auth.mfa.unenroll({ factorId: f.id });
    const r = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'TriageFlow ' + Date.now(), issuer: 'TriageFlow' });
    return r.error ? { error: r.error } : { factorId: r.data.id, secret: r.data.totp.secret, uri: r.data.totp.uri };
  }

  TF.backend = {
    ready, pw, lock, genCodes, enroll, email, net,
    signUp: (a) => sb.auth.signUp({ email: email(a.id), password: a.pw, options: { data: {
      staff_id: a.id.trim().toUpperCase(), full_name: a.name.trim(), role: a.role, specialty: (a.spec || '').trim(), phone: a.phone || '', hospital_code: a.code } } }),
    signIn: (id, p) => sb.auth.signInWithPassword({ email: email(id), password: p }),
    signOut: () => sb.auth.signOut().catch(() => {}),
    async verifiedFactors() { const r = await sb.auth.mfa.listFactors(); return (r.data && r.data.totp) || []; },
    verify: (factorId, code) => sb.auth.mfa.challengeAndVerify({ factorId, code }),
    async profile() { const u = await sb.auth.getUser(); if (u.error || !u.data.user) return { error: u.error || true }; return sb.from('profiles').select('*').eq('id', u.data.user.id).single(); },
    async restore() {                                                // reopen the app already signed in (only if 2FA was completed)
      const s = await sb.auth.getSession(); if (!s.data.session) return false;
      const a = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      if (a.data && a.data.currentLevel === 'aal2') return true;
      await sb.auth.signOut(); return false;
    },
    saveCodes: (codes) => sb.rpc('save_recovery_codes', { codes }),
    useRecovery: (code) => sb.rpc('use_recovery_code', { p_code: code }),
    resetPassword: (id, hosp, code, np) => sb.rpc('reset_password_with_recovery', { p_staff_id: id, p_hospital_code: hosp, p_recovery_code: code, p_new_password: np }),
    sb,
  };
})();
