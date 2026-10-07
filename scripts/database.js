const {CloudDatabase}=require('../cloud-db.js');
const {maintainCloud}=require('../cloud-maintenance.js');
const {BlobMedia}=require('../blob-media.js');

async function main() {
  const database=new CloudDatabase(process.env.DATABASE_URL);
  try {
    const action=process.argv[2]||'migrate';
    if (action==='migrate') {await database.migrate();console.log('云数据库迁移完成，版本 1。');}
    else if (action==='cleanup') {
      await maintainCloud(database,new BlobMedia());
      console.log('过期会话与待删除照片清理完成。');
    } else throw new Error('未知数据库命令。');
  } finally {await database.close();}
}
main().catch(error=>{console.error('数据库操作失败：'+(error.code||'请检查服务端配置和数据库版本。'));process.exitCode=1;});
