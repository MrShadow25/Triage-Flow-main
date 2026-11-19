/* auth.js — sign in, create account, forgot password and the two-factor popup. */
(function () {
  'use strict';
  const TF = window.TF, S = TF.state, C = TF.config;
  const { esc, getPath } = TF.utils;
  const { authHeader } = TF.components.header;

  const field = (label, id, model, o = {}) => {
    const input = `<input id="${id}" data-model="${model}" value="${esc(getPath(S, model))}" ${o.type ? `type="${o.type}"` : ''}
      ${o.ph ? `placeholder="${esc(o.ph)}"` : ''} ${o.auto ? `autocomplete="${o.auto}"` : 'autocomplete="off"'}>`;
    return `<label for="${id}">${label}</label>` + (o.eye
      ? `<div class="pwrow">${input}<button type="button" class="eye" data-action="toggle-pw" data-v="${id}" aria-label="Show or hide password">👁</button></div>` : input);
  };
  const errLine = () => (S.err ? `<p class="form-err" role="alert">${esc(S.err)}</p>` : '');
  const groups = (k) => k.match(/.{1,4}/g).join(' ');

  function otpBoxes(tf) {
    return `<div class="otp-row" role="group" aria-label="6-digit code">${[0, 1, 2, 3, 4, 5].map((i) =>
      `<input class="otp ${tf.error ? 'err' : ''}" inputmode="numeric" pattern="[0-9]*" maxlength="1" data-otp="${i}"
        autocomplete="${i === 0 ? 'one-time-code' : 'off'}" aria-label="Digit ${i + 1} of 6" ${tf.error ? 'aria-invalid="true"' : ''} value="${esc(tf.digits[i])}">`).join('')}</div>
      <p class="otp-err" id="otp-err" role="alert">${esc(tf.error)}</p>`;
  }

  // First time only: how to link the authenticator app. The key stays hidden until asked for.
  const setupPanel = (tf) => {
    if (!tf.enroll) return `<p class="mu" id="tf-d">Open your authenticator app and enter the 6-digit code shown for <b>TriageFlow</b>.</p>`;
    return `<p class="mu" id="tf-d">Set up your authenticator app (one time):<br>1. Install Google Authenticator or Microsoft Authenticator.<br>2. Tap the button below, or choose "Enter a setup key" in the app.<br>3. Type the 6-digit code it shows.</p>
      <a class="btn" style="display:block;text-decoration:none;text-align:center" href="${esc(tf.uri)}">Add to authenticator app</a>
      <p class="mu" style="word-break:break-all;margin-top:10px">${tf.showKey ? `Setup key: <b>${groups(tf.secret)}</b><br><button class="lk" data-action="copy-key">Copy key</button> ` : ''}<button class="lk" data-action="toggle-key">${tf.showKey ? 'Hide' : 'Show'} setup key</button></p>`;
  };

  function modal(tf) {
    if (tf.stage === 'recovery') return `<div class="scrim"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="tf-h">
      <div class="badge2fa" aria-hidden="true">2FA</div><h2 id="tf-h">Use a recovery code</h2>
      <p class="mu">Enter one of the recovery codes you saved. It works once, then you will link a new authenticator.</p>
      <input id="rc1" data-model="rc.code" placeholder="XXXXX-XXXXX" autocomplete="off" autocapitalize="characters" style="text-align:center">
      <p class="otp-err" role="alert">${esc(tf.error)}</p>
      <button class="btn" data-action="use-recovery">Use code</button>
      <button class="lk" data-action="back-to-code">Back</button></div></div>`;
    if (tf.stage === 'codes') return `<div class="scrim"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="tf-h">
      <div class="badge2fa" aria-hidden="true">2FA</div><h2 id="tf-h">Save your recovery codes</h2>
      <p class="mu">Each code works once. If you lose your phone, a code lets you set up a new authenticator or reset your password. They will not be shown again.</p>
      <div class="codes">${tf.codes.map((c) => `<span>${c}</span>`).join('')}</div>
      <button class="lk" data-action="copy-codes">Copy codes</button>
      <label class="ack"><input type="checkbox" data-action="ack-codes" ${tf.ack ? 'checked' : ''}> I have saved my recovery codes</label>
      <button class="btn" data-action="codes-done">Continue</button></div></div>`;
    return `<div class="scrim"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="tf-h" aria-describedby="tf-d">
      <div class="badge2fa" aria-hidden="true">2FA</div><h2 id="tf-h">Two-Factor Authentication</h2>
      ${setupPanel(tf)}${otpBoxes(tf)}
      <button class="btn" data-action="verify">${tf.busy ? 'Checking…' : 'Verify'}</button>
      ${!tf.enroll ? '<button class="lk" data-action="lost-auth">Lost your phone? Use a recovery code</button>' : ''}
      <button class="lk" data-action="cancel2fa">Cancel</button></div></div>`;
  }

  /* ---------- screens ---------- */
  function signIn() {
    return `<div class="card" style="width:100%">
      <label id="role-l">I am a</label>
      <div class="sw" role="group" aria-labelledby="role-l">${TF.data.ROLES.map((r) =>
        `<button class="${r === S.role ? 'on' : ''}" data-action="role" data-v="${r}" aria-pressed="${r === S.role}">${r}</button>`).join('')}</div>
      ${field('Staff ID', 'l1', 'lf.id', { ph: TF.data.ID_EXAMPLE[S.role], auto: 'username' })}
      ${field('Password', 'l2', 'lf.pw', { type: 'password', auto: 'current-password', eye: true })}
      ${errLine()}
      <button class="btn" data-action="signin">Sign In</button>
      <div class="row"><button class="lk" data-action="goto" data-v="cp">Forgot password?</button><button class="lk" data-action="goto" data-v="ca">Create account</button></div>
      <details class="demo"><summary>First time here?</summary><p>Tap "Create account" and use the hospital code from your administrator. You will link an authenticator app and get recovery codes.</p></details></div>`;
  }

  function createAccount() {
    const roleOpts = TF.data.ROLES.map((r) => `<option ${S.ca.role === r ? 'selected' : ''}>${r}</option>`).join('');
    return `<div class="card" style="width:100%"><h2 style="margin:0;font-size:20px">Create your Account</h2>
      <p class="mu">Enter your details to create a secure account for hospital access.</p>
      ${field('Full Name', 'a1', 'ca.name', { ph: 'Ana Reyes', auto: 'name' })}
      ${field('Staff ID', 'a2', 'ca.id', { ph: TF.data.ID_EXAMPLE[S.ca.role] })}
      <label for="a3">Role</label><select id="a3" data-model="ca.role">${roleOpts}</select>
      ${field('Password', 'a4', 'ca.pw', { type: 'password', auto: 'new-password', eye: true })}
      <p class="mu pwhint" id="pw-hint">At least ${C.MIN_PASSWORD} characters with upper case, lower case and a number.</p>
      ${field('Hospital Code', 'a5', 'ca.code', { type: 'password' })}
      ${field('Specialty / Title (doctors and nurses, optional)', 'a7', 'ca.spec', { ph: 'e.g. Emergency Medicine Physician' })}
      ${field('Mobile Number (optional)', 'a6', 'ca.phone', { type: 'tel', ph: '+63 9XX XXX XXXX', auto: 'tel' })}
      ${errLine()}
      <button class="btn" data-action="create-account">Create</button>
      <button class="lk" data-action="goto" data-v="login">Back to sign in</button></div>`;
  }

  function changePassword() {
    return `<div class="card" style="width:100%"><h2 style="margin:0;font-size:20px">Reset Password</h2>
      <p class="mu">Enter your Staff ID, the hospital code and one of your saved recovery codes. Each recovery code works once.</p>
      ${field('Staff ID', 'b0', 'cp.id', { ph: TF.data.ID_EXAMPLE[S.role], auto: 'username' })}
      ${field('Hospital Code', 'b3', 'cp.code', { type: 'password' })}
      ${field('Recovery Code', 'b4', 'cp.rc', { ph: 'XXXXX-XXXXX' })}
      ${field('New Password', 'b1', 'cp.pw', { type: 'password', auto: 'new-password', eye: true })}
      <p class="mu pwhint" id="pw-hint">At least ${C.MIN_PASSWORD} characters with upper case, lower case and a number.</p>
      ${field('Confirm Password', 'b2', 'cp.pw2', { type: 'password', auto: 'new-password', eye: true })}
      ${errLine()}
      <button class="btn" data-action="change-password">Reset password</button>
      <p class="mu">No recovery codes left? Ask your administrator to remove your account so you can register again.</p>
      <button class="lk" data-action="goto" data-v="login">Back to sign in</button></div>`;
  }

  const SCREENS = { login: ['Sign In', signIn], ca: ['Create Account', createAccount], cp: ['Reset Password', changePassword] };

  function screen() {
    if (!TF.backend.ready) return authHeader('Setup needed') + `<main class="mid"><div class="card" style="width:100%"><h2 style="margin:0;font-size:20px">Not connected</h2>
      <p class="mu">The Supabase address or key is missing. Fill in <b>www/src/supabase-config.js</b> and rebuild.</p></div></main>`;
    const [title, body] = SCREENS[S.scr] || SCREENS.login;
    return authHeader(title) + `<main class="mid">${body()}</main>`;
  }

  TF.components.auth = { screen, modal };
})();
