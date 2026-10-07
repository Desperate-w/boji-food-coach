const {CloudDatabase}=require('./cloud-db.js');
const {CloudAccounts}=require('./cloud-accounts.js');
const {CloudStore}=require('./cloud-store.js');
const {BlobMedia}=require('./blob-media.js');
const {positiveInteger}=require('./runtime.js');

function cloudRuntime({database,media}={}) {
  const db=database||new CloudDatabase(process.env.DATABASE_URL,{max:positiveInteger(process.env.DB_POOL_MAX,5,'DB_POOL_MAX')});
  const photos=media||new BlobMedia();
  return {database:db,media:photos,accounts:new CloudAccounts(db),stores:{
    acquire(account) {return {store:new CloudStore(db,account.id,photos),release(){}};},
    sweep(){},close(){},
  }};
}
module.exports={cloudRuntime};
