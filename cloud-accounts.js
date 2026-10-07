const crypto = require('node:crypto');
const {Accounts,digest,passwordHash,validUsername,validPassword} = require('./accounts.js');

class CloudAccounts {
  constructor(database) {this.database=database;}
  close() {}
  async query(sql,values=[]) {await this.database.ready(); return this.database.pool.query(sql,values);}
  validCsrf(session,token) {return Accounts.prototype.validCsrf.call(this,session,token);}

  async createInvite(role='member',lifetimeHours=72) {
    if (!['owner','member'].includes(role)) throw new Error('邀请角色无效。');
    return this.database.transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(74863102)');
      const owner=await client.query("SELECT id FROM boji_account WHERE role='owner'");
      if (role==='owner' && owner.rowCount) throw new Error('站长账号已存在。');
      if (role==='member' && !owner.rowCount) throw new Error('请先创建站长账号。');
      const code=crypto.randomBytes(24).toString('base64url');
      await client.query('INSERT INTO boji_invite(code_hash,role,expires_at,created_at) VALUES($1,$2,$3,$4)',
        [digest(code),role,Date.now()+lifetimeHours*3600_000,new Date().toISOString()]);
      return code;
    });
  }
  async register({inviteCode,username,password},registration='invite') {
    if (!validUsername(username)) throw new Error('用户名需以字母开头，使用 3–24 位字母、数字或下划线。');
    if (!validPassword(password)) throw new Error('密码需要 12–128 个字符。');
    if (inviteCode!==undefined && (typeof inviteCode!=='string' || !inviteCode || inviteCode.length>100)) throw new Error('邀请码无效或已过期。');
    if (!inviteCode && registration!=='open') throw new Error(registration==='closed'?'当前暂未开放注册。':'请输入有效的邀请码。');
    const normalized=username.toLowerCase(), salt=crypto.randomBytes(24).toString('hex');
    const hash=await passwordHash(password,salt);
    try {
      return await this.database.transaction(async client => {
        const invitation=inviteCode ? (await client.query('SELECT * FROM boji_invite WHERE code_hash=$1 FOR UPDATE',[digest(inviteCode)])).rows[0] : null;
        if (inviteCode && (!invitation || invitation.used_by || Number(invitation.expires_at)<Date.now())) throw new Error('邀请码无效或已过期。');
        const role=invitation?.role || 'member';
        if (registration==='closed' && role!=='owner') throw new Error('当前暂未开放注册。');
        const id=crypto.randomUUID();
        await client.query('INSERT INTO boji_account(id,username,password_hash,salt,role,created_at) VALUES($1,$2,$3,$4,$5,$6)',
          [id,normalized,hash,salt,role,new Date().toISOString()]);
        if (invitation) await client.query('UPDATE boji_invite SET used_by=$1 WHERE code_hash=$2',[id,digest(inviteCode)]);
        return {id,username:normalized,role,storageKey:id};
      });
    } catch(error) {
      if (error.code==='23505') throw new Error(error.constraint==='boji_one_owner'?'站长账号已存在。':'用户名已被使用。');
      throw error;
    }
  }
  async verify(username,password) {
    if (typeof username!=='string'||typeof password!=='string'||password.length>128) return null;
    const row=(await this.query('SELECT * FROM boji_account WHERE username=$1',[username.toLowerCase()])).rows[0];
    if (!row) {await passwordHash('invalid-password','fixed-salt-for-unknown-user');return null;}
    const actual=Buffer.from(await passwordHash(password,row.salt),'hex');
    if (!crypto.timingSafeEqual(Buffer.from(row.password_hash,'hex'),actual)) return null;
    return {id:row.id,username:row.username,role:row.role,storageKey:row.id};
  }
  async createSession(account) {
    const token=crypto.randomBytes(32).toString('base64url'),csrf=Accounts.csrfForToken(token);
    const expiresAt=Date.now()+30*24*3600_000;
    await this.query('INSERT INTO boji_session(token_hash,account_id,csrf_hash,expires_at,created_at) VALUES($1,$2,$3,$4,$5)',
      [digest(token),account.id,digest(csrf),expiresAt,new Date().toISOString()]);
    return {token,csrf,expiresAt};
  }
  async session(token) {
    if (typeof token!=='string'||token.length>100) return null;
    return (await this.query('SELECT a.id,a.username,a.role,a.id AS "storageKey",s.csrf_hash AS "csrfHash" FROM boji_session s JOIN boji_account a ON a.id=s.account_id WHERE s.token_hash=$1 AND s.expires_at>$2',
      [digest(token),Date.now()])).rows[0] || null;
  }
  async revokeSession(token) {
    if (typeof token==='string'&&token.length<=100) await this.query('DELETE FROM boji_session WHERE token_hash=$1',[digest(token)]);
  }
  async rateAllowed(key,limit,windowMs) {
    const now=Date.now();
    const result=await this.query('INSERT INTO boji_rate(key,attempts,expires_at) VALUES($1,1,$2) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN boji_rate.expires_at<=$3 THEN 1 ELSE boji_rate.attempts+1 END, expires_at=CASE WHEN boji_rate.expires_at<=$3 THEN EXCLUDED.expires_at ELSE boji_rate.expires_at END RETURNING attempts',
      [digest(key),now+windowMs,now]);
    return result.rows[0].attempts<=limit;
  }
  async clearRate(key) {await this.query('DELETE FROM boji_rate WHERE key=$1',[digest(key)]);}
  async reserveModelCall(accountId,limit,globalLimit) {
    const day=new Date().toISOString().slice(0,10), userKey='account:'+accountId;
    return this.database.transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(74863103)');
      const rows=(await client.query('SELECT key,calls FROM boji_usage WHERE day=$1 AND key=ANY($2::text[])',[day,['global',userKey]])).rows;
      if ((rows.find(row=>row.key==='global')?.calls||0)>=globalLimit || (rows.find(row=>row.key===userKey)?.calls||0)>=limit) return false;
      await client.query('INSERT INTO boji_usage(key,day,calls) VALUES($1,$3,1),($2,$3,1) ON CONFLICT(key,day) DO UPDATE SET calls=boji_usage.calls+1',[userKey,'global',day]);
      return true;
    });
  }
  async acquireWrite(accountId) {
    const key='write:'+accountId, token=crypto.randomUUID();
    const result=await this.query("INSERT INTO boji_lease(key,kind,token,expires_at) VALUES($1,'write',$2,clock_timestamp()+interval '330 seconds') ON CONFLICT(key) DO UPDATE SET token=EXCLUDED.token,expires_at=EXCLUDED.expires_at WHERE boji_lease.expires_at<=clock_timestamp() RETURNING token",[key,token]);
    return result.rowCount ? this.releaseFunction(key,token) : null;
  }
  async acquireModel(limit) {
    const key='model:'+crypto.randomUUID(),token=crypto.randomUUID();
    const admitted=await this.database.transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(74863104)');
      await client.query("DELETE FROM boji_lease WHERE kind='model' AND expires_at<=clock_timestamp()");
      const count=Number((await client.query("SELECT count(*) FROM boji_lease WHERE kind='model'")).rows[0].count);
      if (count>=limit) return false;
      await client.query("INSERT INTO boji_lease(key,kind,token,expires_at) VALUES($1,'model',$2,clock_timestamp()+interval '330 seconds')",[key,token]);
      return true;
    });
    return admitted ? this.releaseFunction(key,token) : null;
  }
  releaseFunction(key,token) {
    const release=async()=>{await this.query('DELETE FROM boji_lease WHERE key=$1 AND token=$2',[key,token]);};
    release.key=key;release.token=token;
    return release;
  }
  async cleanup() {
    const now=Date.now(),cutoff=new Date(now-90*86400_000).toISOString().slice(0,10);
    await this.database.transaction(async client=>{
      await client.query('DELETE FROM boji_session WHERE expires_at<=$1',[now]);
      await client.query('DELETE FROM boji_invite WHERE expires_at<=$1',[now]);
      await client.query('DELETE FROM boji_rate WHERE expires_at<=$1',[now]);
      await client.query('DELETE FROM boji_usage WHERE day<$1',[cutoff]);
      await client.query('DELETE FROM boji_lease WHERE expires_at<=clock_timestamp()');
    });
  }
}
module.exports={CloudAccounts};
