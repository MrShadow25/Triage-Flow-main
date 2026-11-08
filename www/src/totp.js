/* totp.js — authenticator-app two-factor (RFC 6238 TOTP). Free, works offline, no SMS or server.
   Pure JS (own SHA-1/HMAC) so it also works when the page is opened as a plain file. */
(function () {
  'use strict';
  const TF = window.TF, B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

  function b32enc(b) { let bits = '', out = ''; b.forEach((x) => (bits += x.toString(2).padStart(8, '0'))); for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]; return out; }
  function b32dec(s) { let bits = ''; s.replace(/=+$/, '').toUpperCase().split('').forEach((c) => (bits += B32.indexOf(c).toString(2).padStart(5, '0'))); const o = []; for (let i = 0; i + 8 <= bits.length; i += 8) o.push(parseInt(bits.slice(i, i + 8), 2)); return Uint8Array.from(o); }

  function sha1(m) {
    const l = m.length, nb = ((l + 9 + 63) >> 6) << 6, buf = new Uint8Array(nb); buf.set(m); buf[l] = 0x80;
    const dv = new DataView(buf.buffer); dv.setUint32(nb - 4, (l * 8) >>> 0); dv.setUint32(nb - 8, Math.floor((l * 8) / 4294967296));
    let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0; const w = new Uint32Array(80);
    for (let o = 0; o < nb; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 80; i++) { const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]; w[i] = (x << 1) | (x >>> 31); }
      let a = h0, b = h1, c = h2, d = h3, e = h4;
      for (let i = 0; i < 80; i++) {
        let f, k;
        if (i < 20) { f = (b & c) | (~b & d); k = 0x5A827999; } else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
        else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; } else { f = b ^ c ^ d; k = 0xCA62C1D6; }
        const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0; e = d; d = c; c = ((b << 30) | (b >>> 2)) >>> 0; b = a; a = t;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
    }
    const out = new Uint8Array(20), od = new DataView(out.buffer); [h0, h1, h2, h3, h4].forEach((h, i) => od.setUint32(i * 4, h)); return out;
  }
  function hmac(key, msg) {
    if (key.length > 64) key = sha1(key);
    const k = new Uint8Array(64); k.set(key);
    const ip = k.map((x) => x ^ 0x36), op = k.map((x) => x ^ 0x5c);
    const inner = sha1(Uint8Array.from([...ip, ...msg])); return sha1(Uint8Array.from([...op, ...inner]));
  }
  function hotp(secret, counter, digits = 6) {
    const msg = new Uint8Array(8), dv = new DataView(msg.buffer); dv.setUint32(0, Math.floor(counter / 4294967296)); dv.setUint32(4, counter >>> 0);
    const h = hmac(b32dec(secret), msg), o = h[19] & 15;
    const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
    return String(bin % Math.pow(10, digits)).padStart(digits, '0');
  }

  TF.totp = {
    _b32enc: b32enc, _hotp: hotp,
    newSecret() { const r = new Uint8Array(20); (window.crypto || window.msCrypto).getRandomValues(r); return b32enc(r); },
    code(secret, t = Date.now()) { return hotp(secret, Math.floor(t / 30000)); },
    check(secret, entered, t = Date.now()) { const c = Math.floor(t / 30000); return [0, -1, 1].some((d) => hotp(secret, c + d) === entered); }, // ±30s for clock drift
    uri(id, secret) { return `otpauth://totp/TriageFlow:${encodeURIComponent(id)}?secret=${secret}&issuer=TriageFlow&algorithm=SHA1&digits=6&period=30`; },
  };
})();
