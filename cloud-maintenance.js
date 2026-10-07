const {CloudAccounts}=require('./cloud-accounts.js');
const {CloudStore}=require('./cloud-store.js');

async function maintainCloud(database,media) {
  await new CloudAccounts(database).cleanup();
  const {rows}=await database.pool.query("SELECT DISTINCT account_id FROM boji_media WHERE status='deleting' OR (status='pending' AND created_at<clock_timestamp()-interval '15 minutes') LIMIT 100");
  for (const row of rows) await new CloudStore(database,row.account_id,media).flushMediaGarbage(10);
  return {processedAccounts:rows.length};
}
module.exports={maintainCloud};
