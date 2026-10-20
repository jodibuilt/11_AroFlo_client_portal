// Authenticator-app codes for admin sign-in (RFC 6238 TOTP: SHA-1, 6 digits, 30 seconds),
// the format Microsoft, Google and other authenticator apps use.
import crypto from 'node:crypto';
import { renderSVG } from 'uqr';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;
const ISSUER = 'TTS Built Portal';

export function newSecret() {
  let bits = '';
  for (const byte of crypto.randomBytes(20)) bits += byte.toString(2).padStart(8, '0');
  return bits.match(/.{5}/g).map((b) => ALPHABET[parseInt(b, 2)]).join('');
}

function fromBase32(secret) {
  const bits = [...String(secret).toUpperCase().replace(/[^A-Z2-7]/g, '')]
    .map((c) => ALPHABET.indexOf(c).toString(2).padStart(5, '0')).join('');
  return Buffer.from((bits.match(/.{8}/g) || []).map((b) => parseInt(b, 2)));
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

export function codeAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = crypto.createHmac('sha1', fromBase32(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0xf;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS).padStart(DIGITS, '0');
}

// Returns the time step the code belongs to, or null. One step either side is accepted
// for phone clock drift; steps at or before `lastStep` were already used and are refused.
export function verify(secret, code, lastStep = 0, now = Date.now()) {
  const given = String(code ?? '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(given)) return null;
  const step = currentStep(now);
  let match = null;
  for (const s of [step - 1, step, step + 1]) {
    if (s > lastStep && crypto.timingSafeEqual(Buffer.from(codeAt(secret, s)), Buffer.from(given))) match = s;
  }
  return match;
}

export function otpauthUrl(secret, account) {
  const label = encodeURIComponent(`${ISSUER}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

// QR code for the authenticator app to scan, as an image the page can show directly.
export function qrDataUrl(text) {
  const svg = renderSVG(text, { border: 2, pixelSize: 6 });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
