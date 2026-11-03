/* auth.js — sign in, create account, change password, and the two-factor (2FA) UI. */
(function () {
  'use strict';
  const TF = window.TF, S = TF.state, C = TF.config;
  const { esc, pad2, getPath, maskPhone } = TF.utils;
  const { authHeader } = TF.components.header;

  const field = (label, id, model, o = {}) => `<label for="${id}">${label}</label>
    <input id="${id}" data-model="${model}" value="${esc(getPath(S, model))}" ${o.type ? `type="${o.type}"` : ''}
      ${o.ph ? `placeholder="${esc(o.ph)}"` : ''} ${o.auto ? `autocomplete="${o.auto}"` : 'autocomplete="off"'}>`;
  const errLine = () => (S.err ? `<p class="form-err" role="alert">${esc(S.err)}</p>` : '');

  /* ---------- 2FA building blocks (used by the popup and the Verify Your Number screen) ---------- */
  function otpBoxes(tf) {
    return `<div class="otp-row" role="group" aria-label="6-digit code">${[0, 1, 2, 3, 4, 5].map((i) =>
      `<input class="otp ${tf.error ? 'err' : ''}" inputmode="numeric" pattern="[0-9]*" maxlength="1" data-otp="${i}"
        autocomplete="${i === 0 ? 'one-time-code' : 'off'}" aria-label="Digit ${i + 1} of 6" ${tf.error ? 'aria-invalid="true"' : ''} value="${esc(tf.digits[i])}">`).join('')}</div>
      <p class="otp-err" id="otp-err" role="alert">${esc(tf.error)}</p>`;
  }

  function resendHtml(tf) {
    const left = Math.ceil((tf.resendAt - Date.now()) / 1000);
    return left > 0
      ? `Resend code in 0:${pad2(left)}`
      : '<button class="lk" data-action="resend">Resend code</button>';
  }

  const demoCode = (tf) => (C.DEMO_MODE
    ? `<p class="demo-code">Prototype mode: no SMS is sent. Your code is <b>${tf.code}</b>.</p>` : '');

  const REASON = { login: 'to finish signing in', reset: 'to confirm your new password', verify: 'so we can use it for two-factor sign-in' };

  // Popup shown over the Sign In / Change Password screens.
  function modal(tf) {
    return `<div class="scrim"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="tf-h" aria-describedby="tf-d">
      <div class="badge2fa" aria-hidden="true">2FA</div>
      <h2 id="tf-h">Two-Factor Authentication</h2>
      <p class="mu" id="tf-d">Enter the 6-digit code we sent to ${maskPhone(tf.phone)} ${REASON[tf.purpose]}.</p>
      ${demoCode(tf)}${otpBoxes(tf)}
      <button class="btn" data-action="verify">Verify</button>
      <div class="mu" id="resend" style="margin-top:10px">${resendHtml(tf)}</div>
      <button class="lk" data-action="cancel2fa">Cancel</button></div></div>`;
  }

  /* ---------- screens ---------- */
  function signIn() {
    return `<div class="card" style="width:100%">
      <label id="role-l">I am a</label>
      <div class="sw" role="group" aria-labelledby="role-l">${TF.data.ROLES.map((r) =>
        `<button class="${r === S.role ? 'on' : ''}" data-action="role" data-v="${r}" aria-pressed="${r === S.role}">${r}</button>`).join('')}</div>
      ${field('Staff ID', 'l1', 'lf.id', { ph: 'RC-1042', auto: 'username' })}
      ${field('Password', 'l2', 'lf.pw', { type: 'password', auto: 'current-password' })}
      ${errLine()}
      <button class="btn" data-action="signin">Sign In</button>
      <div class="row"><button class="lk" data-action="goto" data-v="cp">Forgot password?</button><button class="lk" data-action="goto" data-v="ca">Create account</button></div>
      ${C.DEMO_MODE ? `<details class="demo"><summary>Demo accounts</summary><p>RC-1042 Receptionist · RC-1043 Nurse · RC-1044 Doctor<br>Password: demo1234</p></details>` : ''}</div>`;
  }

  function createAccount() {
    const roleOpts = TF.data.ROLES.map((r) => `<option ${S.ca.role === r ? 'selected' : ''}>${r}</option>`).join('');
    return `<div class="card" style="width:100%"><h2 style="margin:0;font-size:20px">Create your Account</h2>
      <p class="mu">Enter your details to create a secure account for hospital access.</p>
      ${field('Full Name', 'a1', 'ca.name', { ph: 'Ana Reyes', auto: 'name' })}
      ${field('Staff ID', 'a2', 'ca.id', { ph: 'RC-1041' })}
      <label for="a3">Role</label><select id="a3" data-model="ca.role">${roleOpts}</select>
      ${field('Password (min. ' + C.MIN_PASSWORD + ' characters)', 'a4', 'ca.pw', { type: 'password', auto: 'new-password' })}
      ${field('Hospital Code', 'a5', 'ca.code', { type: 'password' })}
      ${field('Mobile Number (for 2FA)', 'a6', 'ca.phone', { type: 'tel', ph: '+63 9XX XXX XXXX', auto: 'tel' })}
      ${errLine()}
      <button class="btn" data-action="create-account">Create</button>
      <button class="lk" data-action="goto" data-v="login">Back to sign in</button></div>`;
  }

  function changePassword() {
    return `<div class="card" style="width:100%"><h2 style="margin:0;font-size:20px">Set New Password</h2>
      <p class="mu">We will text a code to the mobile number on your account to confirm it is you.</p>
      ${field('Staff ID', 'b0', 'cp.id', { ph: 'RC-1042', auto: 'username' })}
      ${field('New Password', 'b1', 'cp.pw', { type: 'password', auto: 'new-password' })}
      ${field('Confirm Password', 'b2', 'cp.pw2', { type: 'password', auto: 'new-password' })}
      ${errLine()}
      <button class="btn" data-action="change-password">Confirm</button>
      <button class="lk" data-action="goto" data-v="login">Back to sign in</button></div>`;
  }

  function verifyNumber() {
    const tf = S.tf;
    if (!tf) return '';
    return `<div class="card vn" style="width:100%;text-align:center"><h2>Confirm your mobile number</h2>
      <p class="mu">Enter the 6-digit code we sent to ${maskPhone(tf.phone)} so we can use it for two-factor sign-in.</p>
      ${demoCode(tf)}${otpBoxes(tf)}
      <button class="btn" data-action="verify">Verify and finish</button>
      <div class="mu" id="resend" style="margin-top:10px">${resendHtml(tf)}</div>
      <button class="lk" data-action="change-number">Change number</button></div>`;
  }

  const SCREENS = {
    login: ['Sign In', signIn],
    ca: ['Create Account', createAccount],
    cp: ['Change Password', changePassword],
    vn: ['Verify Your Number', verifyNumber],
  };

  function screen() {
    const [title, body] = SCREENS[S.scr] || SCREENS.login;
    return authHeader(title) + `<main class="mid">${body()}</main>`;
  }

  TF.components.auth = { screen, modal, resendHtml };
})();
