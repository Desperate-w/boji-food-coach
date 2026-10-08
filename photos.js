(function(root,factory) {
  if (typeof module==='object'&&module.exports) module.exports=factory();
  else root.BojiPhotos=factory();
})(typeof window!=='undefined'?window:globalThis,function() {
  const MAX_PHOTOS=6,MAX_PHOTO_BYTES=1_200_000,MAX_TOTAL_PHOTO_BYTES=2_700_000,MAX_UPLOAD_PHOTO_BYTES=450_000;
  function inputImages(body) {return Array.isArray(body.images)?body.images:body.image?[body.image]:[];}
  function photoUrls(message) {
    const urls=Array.isArray(message.photoUrls)?message.photoUrls:message.photoUrl?[message.photoUrl]:[];
    return urls.filter(url=>typeof url==='string'&&url.length);
  }
  function withPhotoUrls(message,urls) {return {...message,photoUrls:urls,photoUrl:urls[0]||null};}
  function imageBytes(url) {
    const match=typeof url==='string'&&/^data:image\/(jpeg|png|webp);base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/.exec(url);
    if (!match||!match[2]) throw new Error('照片格式无效。');
    const bytes=match[2].length/4*3-(match[2].endsWith('==')?2:match[2].endsWith('=')?1:0);
    return bytes;
  }
  function checkedImageBytes(url) {
    const bytes=imageBytes(url);
    if (bytes>MAX_PHOTO_BYTES) throw new Error('单张照片过大，请缩小后重试。');
    return bytes;
  }
  function validateImages(images) {
    if (!Array.isArray(images)) throw new Error('照片列表格式无效。');
    if (images.length>MAX_PHOTOS) throw new Error(`每条消息最多添加 ${MAX_PHOTOS} 张照片。`);
    if (images.reduce((sum,url)=>sum+checkedImageBytes(url),0)>MAX_TOTAL_PHOTO_BYTES) throw new Error('照片总大小过大，请分批发送。');
    return images;
  }
  function backupPhotoUrls(message) {
    if (message.photoUrls!==undefined&&!Array.isArray(message.photoUrls)) throw new Error('备份中的照片列表格式无效。');
    const urls=Array.isArray(message.photoUrls)?message.photoUrls:message.photoUrl?[message.photoUrl]:[];
    if (urls.length>MAX_PHOTOS) throw new Error('备份中的单条记录照片过多。');
    return validateImages(urls.filter(url=>typeof url==='string'&&url.startsWith('data:image/')));
  }
  return {MAX_PHOTOS,MAX_PHOTO_BYTES,MAX_TOTAL_PHOTO_BYTES,MAX_UPLOAD_PHOTO_BYTES,inputImages,photoUrls,withPhotoUrls,imageBytes,validateImages,backupPhotoUrls};
});
