const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {promisify} = require('node:util');
const {DatabaseSync} = require('node:sqlite');

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const scrypt = promisify(crypto.scrypt);
const passwordHash = async (password, salt) => (await scrypt(password, salt, 64)).toString('hex');
const validUsername = value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_]{2,23}$/.test(value);
const validPassword = value => typeof value === 'string' && value.length >= 12 && value.length <= 128;

class Accounts {
  constructor(filename = path.join(__dirname, 'data', 'accounts.sqlite')) {
    fs.mkdirSync(path.dirname(filename), {recursive:true, mode:0o700});
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS account (
        id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
        salt TEXT NOT NULL, role TEXT NOT NULL, storage_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS invite (
        code_hash TEXT PRIMARY KEY, role TEXT NOT NULL, expires_at INTEGER NOT NULL,
        used_by TEXT REFERENCES account(id), created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS session (
        token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
        csrf_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS daily_model_usage (
        account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
        day TEXT NOT NULL, calls INTEGER NOT NULL, PRIMARY KEY(account_id,day)
      );
      CREATE TABLE IF NOT EXISTS global_model_usage (day TEXT PRIMARY KEY, calls INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_rate_limit (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS session_expiry_idx ON session(expires_at);
      CREATE INDEX IF NOT EXISTS auth_rate_expiry_idx ON auth_rate_limit(expires_at);
    `);
  }

  close() { this.db.close(); }

  createInvite(role='member', lifetimeHours=72) {
    if (!['owner','member'].includes(role)) throw new Error('邀请角色无效。');
    if (role==='owner' && this.db.prepare("SELECT id FROM account WHERE role='owner'").get()) throw new Error('站长账号已存在。');
    if (role==='member' && !this.db.prepare("SELECT id FROM account WHERE role='owner'").get()) throw new Error('请先创建站长账号。');
    const code=crypto.randomBytes(24).toString('base64url');
    this.db.prepare('INSERT INTO invite(code_hash,role,expires_at,created_at) VALUES(?,?,?,?)')
      .run(digest(code),role,Date.now()+lifetimeHours*3600_000,new Date().toISOString());
    return code;
  }

  async register({inviteCode,username,password}, registration='invite') {
    if (!validUsername(username)) throw new Error('用户名需以字母开头，使用 3–24 位字母、数字或下划线。');
    if (!validPassword(password)) throw new Error('密码需要 12–128 个字符。');
    if (inviteCode !== undefined && (typeof inviteCode!=='string' || !inviteCode || inviteCode.length>100)) throw new Error('邀请码无效或已过期。');
    if (!inviteCode && registration!=='open') throw new Error(registration==='closed'?'当前暂未开放注册。':'请输入有效的邀请码。');
    const normalized=username.toLowerCase();
    const salt=crypto.randomBytes(24).toString('hex');
    const hash=await passwordHash(password,salt);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const invite=inviteCode?this.db.prepare('SELECT role,expires_at,used_by FROM invite WHERE code_hash=?').get(digest(inviteCode)):null;
      if (inviteCode && (!invite || invite.used_by || invite.expires_at<Date.now())) throw new Error('邀请码无效或已过期。');
      const role=invite?.role||'member';
      if (registration==='closed' && role!=='owner') throw new Error('当前暂未开放注册。');
      if (role==='owner' && this.db.prepare("SELECT id FROM account WHERE role='owner'").get()) throw new Error('站长账号已存在。');
      if (this.db.prepare('SELECT id FROM account WHERE username=?').get(normalized)) throw new Error('用户名已被使用。');
      const id=crypto.randomUUID();
      const storageKey=role==='owner'?'legacy':id;
      this.db.prepare('INSERT INTO account(id,username,password_hash,salt,role,storage_key,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(id,normalized,hash,salt,role,storageKey,new Date().toISOString());
      if (inviteCode) this.db.prepare('UPDATE invite SET used_by=? WHERE code_hash=?').run(id,digest(inviteCode));
      this.db.exec('COMMIT');
      return {id,username:normalized,role,storageKey};
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }

  async verify(username,password) {
    if (typeof username!=='string'||typeof password!=='string'||password.length>128) return null;
    const row=this.db.prepare('SELECT * FROM account WHERE username=?').get(username.toLowerCase());
    if (!row) {
      await passwordHash('invalid-password', 'fixed-salt-for-unknown-user');
      return null;
    }
    const expected=Buffer.from(row.password_hash,'hex');
    const actual=Buffer.from(await passwordHash(password,row.salt),'hex');
    if (!crypto.timingSafeEqual(expected,actual)) return null;
    return {id:row.id,username:row.username,role:row.role,storageKey:row.storage_key};
  }

  createSession(account) {
    const token=crypto.randomBytes(32).toString('base64url');
    const csrf=Accounts.csrfForToken(token);
    const expiresAt=Date.now()+30*24*3600_000;
    this.db.prepare('INSERT INTO session(token_hash,account_id,csrf_hash,expires_at,created_at) VALUES(?,?,?,?,?)')
      .run(digest(token),account.id,digest(csrf),expiresAt,new Date().toISOString());
    return {token,csrf,expiresAt};
  }

  static csrfForToken(token) { return digest(`boji-csrf:${token}`); }

  session(token) {
    if (typeof token!=='string'||token.length>100) return null;
    const row=this.db.prepare(`SELECT a.id,a.username,a.role,a.storage_key AS storageKey,s.csrf_hash AS csrfHash
      FROM session s JOIN account a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>?`)
      .get(digest(token),Date.now());
    return row||null;
  }

  validCsrf(session,token) {
    if (!session||typeof token!=='string'||token.length>100) return false;
    return crypto.timingSafeEqual(Buffer.from(session.csrfHash,'hex'),Buffer.from(digest(token),'hex'));
  }

  revokeSession(token) {
    if (typeof token==='string' && token.length<=100) this.db.prepare('DELETE FROM session WHERE token_hash=?').run(digest(token));
  }

  rateAllowed(key, limit, windowMs) {
    const hashed=digest(key), now=Date.now();
    this.db.prepare(`INSERT INTO auth_rate_limit(key,attempts,expires_at) VALUES(?,1,?)
      ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END,
      expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END`).run(hashed,now+windowMs,now,now);
    return this.db.prepare('SELECT attempts FROM auth_rate_limit WHERE key=?').get(hashed).attempts<=limit;
  }
  clearRate(key) { this.db.prepare('DELETE FROM auth_rate_limit WHERE key=?').run(digest(key)); }
  cleanup() {
    const now=Date.now(), cutoff=new Date(now-90*86400_000).toISOString().slice(0,10);
    this.db.prepare('DELETE FROM session WHERE expires_at<=?').run(now);
    this.db.prepare('DELETE FROM invite WHERE expires_at<=?').run(now);
    this.db.prepare('DELETE FROM auth_rate_limit WHERE expires_at<=?').run(now);
    this.db.prepare('DELETE FROM daily_model_usage WHERE day<?').run(cutoff);
    this.db.prepare('DELETE FROM global_model_usage WHERE day<?').run(cutoff);
  }

  reserveModelCall(accountId, limit, globalLimit) {
    const day=new Date().toISOString().slice(0,10);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const calls=this.db.prepare('SELECT calls FROM daily_model_usage WHERE account_id=? AND day=?').get(accountId,day)?.calls||0;
      const globalCalls=this.db.prepare('SELECT calls FROM global_model_usage WHERE day=?').get(day)?.calls||0;
      if (calls>=limit||globalCalls>=globalLimit) {this.db.exec('ROLLBACK');return false;}
      this.db.prepare('INSERT INTO daily_model_usage(account_id,day,calls) VALUES(?,?,1) ON CONFLICT(account_id,day) DO UPDATE SET calls=calls+1').run(accountId,day);
      this.db.prepare('INSERT INTO global_model_usage(day,calls) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET calls=calls+1').run(day);
      this.db.exec('COMMIT');
      return true;
    } catch(error) {this.db.exec('ROLLBACK');throw error;}
  }
}

module.exports={Accounts};
