const fs = require('node:fs/promises');
const path = require('node:path');
const {Pool} = require('pg');

class CloudDatabase {
  constructor(connectionString, {pool, max=5}={}) {
    if (!connectionString && !pool) throw new Error('请配置服务端 DATABASE_URL。');
    this.pool = pool || new Pool({connectionString, max, idleTimeoutMillis:5000,
      connectionTimeoutMillis:10000, statement_timeout:15000});
    this.pool.on('error', error => console.error('数据库连接异常：' + (error.code || 'CONNECTION_ERROR')));
    if (process.env.VERCEL && !pool) require('@vercel/functions').attachDatabasePool(this.pool);
  }
  async ready() {
    this.readiness ||= this.pool.query('SELECT version FROM boji_schema WHERE id=1')
      .then(({rows}) => {if (rows[0]?.version !== 1) throw new Error('数据库版本不匹配，请先执行数据库迁移。');})
      .catch(error => {this.readiness=null; const failure=new Error('云数据库尚未就绪，请先完成配置和迁移。'); failure.status=503; failure.cause=error; throw failure;});
    return this.readiness;
  }
  async transaction(work, {checkReady=true}={}) {
    if (checkReady) await this.ready();
    const client=await this.pool.connect();
    let pending=Promise.resolve(),queryFailure=null,closed=false;
    try {
      await client.query('BEGIN');
      // pg clients execute one query at a time, even when callers gather reads concurrently.
      const serial={query:(...args)=>{
        const result=pending.then(()=>{
          if (closed) throw new Error('事务已经结束，不能继续执行查询。');
          if (queryFailure) throw queryFailure;
          return client.query(...args);
        });
        pending=result.catch(error=>{queryFailure ||=error;});
        return result;
      }};
      const result=await work(serial);
      await pending;
      if (queryFailure) throw queryFailure;
      closed=true;
      await client.query('COMMIT');
      return result;
    } catch(error) {
      // Stop unsent queries and drain the active query before rollback or pool reuse.
      closed=true;
      await pending;
      try {await client.query('ROLLBACK');} catch {}
      throw error;
    } finally {closed=true;client.release();}
  }
  async migrate() {
    const schema=await fs.readFile(path.join(__dirname,'db','schema.sql'),'utf8');
    await this.transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(74863101)');
      const exists=await client.query("SELECT to_regclass('public.boji_schema') AS name");
      if (exists.rows[0].name) {
        const version=await client.query('SELECT version FROM boji_schema WHERE id=1');
        if (version.rows[0]?.version > 1) throw new Error('数据库比当前代码新，不能降级迁移。');
      }
      await client.query(schema);
    }, {checkReady:false});
    this.readiness=null;
    await this.ready();
  }
  async close() {await this.pool.end();}
}
module.exports={CloudDatabase};
