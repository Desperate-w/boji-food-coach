const {CloudAccounts}=require('./cloud-accounts.js');
const {CloudStore}=require('./cloud-store.js');

async function maintainCloud(database,media) {
  const deadline=Date.now()+240000;
  await new CloudAccounts(database).cleanup();
  const {rows}=await database.pool.query("SELECT DISTINCT account_id FROM boji_media WHERE status='deleting' OR (status='pending' AND created_at<clock_timestamp()-interval '15 minutes') LIMIT 100");
  let processedAccounts=0;
  for (const row of rows) {
    if (Date.now()>=deadline) break;
    await new CloudStore(database,row.account_id,media).flushMediaGarbage(10);
    processedAccounts++;
  }
  return {processedAccounts};
}
module.exports={maintainCloud};
