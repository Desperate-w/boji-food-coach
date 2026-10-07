const {waitUntil,ipAddress}=require('@vercel/functions');
const {createAppServer}=require('../server.js');
let app;

module.exports=async function handler(req,res) {
  try {
    if (!process.env.DATABASE_URL) throw new Error('云数据库配置缺失。');
    if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) throw new Error('私有照片存储配置缺失。');
    app ||= createAppServer({platformVercel:true});
    const headers=new Headers();
    for (const [key,value] of Object.entries(req.headers)) if (value!==undefined) headers.set(key,Array.isArray(value)?value.join(','):value);
    req.platformAddress=ipAddress(headers);
    // Keep lease release and queued photo cleanup alive after the HTTP stream ends.
    const work=app.appHandler(req,res);
    waitUntil(work);
    await work;
  } catch(error) {
    console.error('云服务启动失败：'+(error.code||'CONFIGURATION_ERROR'));
    if (!res.headersSent) {
      res.writeHead(503,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      res.end(JSON.stringify({error:'服务正在配置，请稍后重试。'}));
    } else if (!res.writableEnded) res.end();
  }
};
