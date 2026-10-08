const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..'),out=path.join(root,'public');
fs.mkdirSync(out,{recursive:true});
const files=['styles.css','app.js','login.js','nutrition.js','photos.js'];
for (const file of files) fs.copyFileSync(path.join(root,file),path.join(out,file));
for (const file of fs.readdirSync(out)) {
  if (!files.includes(file)) throw new Error('public 目录存在未授权的文件，请先清理。');
}
console.log('前端资源已生成；账号、密钥、数据库和服务端源码不会作为静态文件发布。');
