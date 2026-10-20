// Encrypted tokens. The browser only ever sees these in place of AroFlo record ids and
// database ids, so URLs reveal nothing and can't be edited to reach another record.
// Also seals secrets kept at rest (2FA keys) and short-lived sign-in tickets.
import crypto from 'node:crypto';

const TOKEN = /^[A-Za-z0-9_-]{38,4000}$/;

// `previous` secrets are still accepted for reading (not for new tokens), so moving from
// the database-generated key to an APP_SECRET App Setting keeps links and 2FA working.
export function createTokens(appSecret, { previous = [] } = {}) {
  const keySets = [appSecret, ...previous].map((secret) => {
    if (String(secret || '').length < 32) throw new Error('APP_SECRET must be at least 32 characters.');
    const key = (purpose) => Buffer.from(crypto.hkdfSync('sha256', secret, '', `client-portal ${purpose}`, 32));
    return { id: key('id encryption'), iv: key('id iv'), seal: key('seal') };
  });
  const { id: idKey, iv: ivKey, seal: sealKey } = keySets[0];
  const decryptAny = (purpose, token) => {
    for (const keys of keySets) {
      const plain = decrypt(keys[purpose], token);
      if (plain) return plain;
    }
    return null;
  };

  function encrypt(k, iv, plain) {
    const cipher = crypto.createCipheriv('aes-256-gcm', k, iv);
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64url');
  }

  // Returns the plaintext, or null for anything forged, edited or malformed.
  function decrypt(k, token) {
    if (typeof token !== 'string' || !TOKEN.test(token)) return null;
    const buf = Buffer.from(token, 'base64url');
    if (buf.length < 29) return null;
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', k, buf.subarray(0, 12));
      decipher.setAuthTag(buf.subarray(-16));
      return Buffer.concat([decipher.update(buf.subarray(12, -16)), decipher.final()]);
    } catch {
      return null;
    }
  }

  return {
    // Record references. The IV is derived from the content, so a record always gets the
    // same token (links and the browser's photo cache keep working). The kind is part of
    // what's encrypted, so a photo token can't be used as a job token.
    encode(kind, ...parts) {
      const fields = [kind, ...parts.map(String)];
      if (fields.some((f) => f.includes('\n'))) throw new Error('Token fields cannot contain line breaks');
      const plain = Buffer.from(fields.join('\n'));
      const iv = crypto.createHmac('sha256', ivKey).update(plain).digest().subarray(0, 12);
      return encrypt(idKey, iv, plain);
    },
    // The parts given to encode(), or null if the token isn't a valid `kind` token.
    decode(kind, token) {
      const plain = decryptAny('id', token);
      if (!plain) return null;
      const [k, ...parts] = plain.toString('utf8').split('\n');
      return k === kind ? parts : null;
    },

    // Random IV each time: for secrets at rest and one-off tickets.
    seal: (value) => encrypt(sealKey, crypto.randomBytes(12), Buffer.from(JSON.stringify(value))),
    open(token) {
      const plain = decryptAny('seal', token);
      if (!plain) return null;
      try {
        return JSON.parse(plain.toString('utf8'));
      } catch {
        return null;
      }
    },
  };
}
