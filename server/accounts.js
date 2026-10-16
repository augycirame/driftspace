// Real accounts: name + password (scrypt-hashed), with long-lived session tokens so a browser
// stays signed in. Only token hashes are stored, never tokens or passwords.

import crypto from 'node:crypto';

const NAME_RE = /^[A-Za-z0-9_\-]{3,16}$/;
const SESSION_TTL = 60 * 24 * 3600 * 1000;

const scrypt = (password, salt) => new Promise((resolve, reject) => {
  crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key)));
});
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

export class Accounts {
  constructor(data) {
    this.data = data;          // { accounts: {}, sessions: {} } inside the world save
    data.accounts ||= {};
    data.sessions ||= {};
  }

  async register(name, password) {
    if (typeof name !== 'string' || !NAME_RE.test(name)) throw new Error('Names are 3-16 letters, numbers, _ or -.');
    if (typeof password !== 'string' || password.length < 6 || password.length > 128) throw new Error('Passwords need at least 6 characters.');
    const key = name.toLowerCase();
    if (this.data.accounts[key]) throw new Error('That name is taken.');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = (await scrypt(password, salt)).toString('hex');
    if (this.data.accounts[key]) throw new Error('That name is taken.');
    this.data.accounts[key] = { name, salt, hash, created: Date.now() };
    return this.issue(key);
  }

  async login(name, password) {
    const key = typeof name === 'string' ? name.toLowerCase() : '';
    const acct = this.data.accounts[key];
    // Hash even for unknown names so timing doesn't reveal which names exist.
    const salt = acct ? acct.salt : 'x'.repeat(32);
    const hash = await scrypt(typeof password === 'string' ? password.slice(0, 128) : '', salt);
    if (!acct || !crypto.timingSafeEqual(hash, Buffer.from(acct.hash, 'hex'))) throw new Error('Wrong name or password.');
    return this.issue(key);
  }

  resume(token) {
    if (typeof token !== 'string' || token.length > 200) return null;
    const s = this.data.sessions[sha(token)];
    if (!s || Date.now() - s.at > SESSION_TTL || !this.data.accounts[s.key]) return null;
    s.at = Date.now();
    return { key: s.key, name: this.data.accounts[s.key].name, token };
  }

  logout(token) {
    delete this.data.sessions[sha(token)];
  }

  issue(key) {
    const token = crypto.randomBytes(32).toString('hex');
    this.data.sessions[sha(token)] = { key, at: Date.now() };
    const now = Date.now();
    for (const [h, s] of Object.entries(this.data.sessions)) if (now - s.at > SESSION_TTL) delete this.data.sessions[h];
    return { key, name: this.data.accounts[key].name, token };
  }
}
