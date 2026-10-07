const path=require('node:path');
const {Accounts}=require('./accounts.js');

const role=process.argv[2];
if (!['owner','member'].includes(role)) {
  console.error('用法：node admin.js owner 生成站长邀请码；node admin.js member 生成朋友邀请码。');
  process.exitCode=1;
} else {
  const accounts=new Accounts(path.join(__dirname,'data','accounts.sqlite'));
  try {
    const code=accounts.createInvite(role);
    console.log(`一次性${role==='owner'?'站长':'朋友'}邀请码（72 小时有效）：${code}`);
  } catch(error) {console.error(error.message);process.exitCode=1;}
  finally {accounts.close();}
}
