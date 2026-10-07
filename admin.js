const path=require('node:path');
const {Accounts}=require('./accounts.js');

async function main() {
  const role=process.argv[2];
  if (!['owner','member'].includes(role)) throw new Error('用法：node admin.js owner 生成站长邀请码；node admin.js member 生成普通用户邀请码。');
  const database=process.env.DATABASE_URL?new (require('./cloud-db.js').CloudDatabase)(process.env.DATABASE_URL):null;
  const accounts=database?new (require('./cloud-accounts.js').CloudAccounts)(database):new Accounts(path.join(process.env.DATA_DIR||path.join(__dirname,'data'),'accounts.sqlite'));
  try {
    const code=await accounts.createInvite(role);
    console.log(`一次性${role==='owner'?'站长':'用户'}邀请码（72 小时有效）：${code}`);
  } finally {accounts.close();if(database) await database.close();}
}
main().catch(error=>{console.error(error.code?'暂时无法生成邀请码，请检查数据库配置。':error.message);process.exitCode=1;});
