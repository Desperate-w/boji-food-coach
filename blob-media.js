const crypto = require('node:crypto');

function decodePhoto(dataUrl) {
  const match=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl||'');
  if (!match) throw new Error('照片格式无效。');
  const bytes=Buffer.from(match[2],'base64');
  if (!bytes.length || bytes.length>1_200_000) throw new Error('照片过大或无效。');
  // File extension and declared MIME must match a supported image signature.
  const valid=match[1]==='jpeg' ? bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff
    : match[1]==='png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP';
  if (!valid) throw new Error('照片内容与格式不匹配。');
  const id=crypto.randomUUID();
  return {id,bytes,mime:'image/'+match[1],extension:match[1]==='jpeg'?'jpg':match[1]};
}

class BlobMedia {
  constructor({sdk}={}) {this.sdk=sdk || require('@vercel/blob');}
  async put(pathname, bytes, mime) {
    const result=await this.sdk.put(pathname,bytes,{access:'private',contentType:mime,
      addRandomSuffix:false,allowOverwrite:false,abortSignal:AbortSignal.timeout(30000)});
    if (result.pathname!==pathname || !new URL(result.url).hostname.endsWith('.private.blob.vercel-storage.com')) {
      throw new Error('照片存储必须使用私有 Blob。');
    }
    return pathname;
  }
  async get(pathname) {
    const result=await this.sdk.get(pathname,{access:'private',useCache:false,abortSignal:AbortSignal.timeout(15000)});
    if (!result) return null;
    const bytes=Buffer.from(await new Response(result.stream).arrayBuffer());
    if (bytes.length>1_200_000) throw new Error('照片内容过大。');
    return bytes;
  }
  async del(pathname) {
    await this.sdk.del(pathname,{abortSignal:AbortSignal.timeout(15000)});
  }
}
module.exports={BlobMedia,decodePhoto};
