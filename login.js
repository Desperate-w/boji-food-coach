(() => {
  const form=document.getElementById('auth-form');
  const error=document.getElementById('auth-error');
  const submit=document.getElementById('auth-submit');
  const switchButton=document.getElementById('auth-switch');
  const inviteField=document.getElementById('invite-field');
  const password=document.getElementById('auth-password');
  let registering=false;
  const setMode=value=>{
    registering=value;
    document.getElementById('auth-title').textContent=value?'创建你的独立账号':'回到你的饮食计划';
    document.getElementById('auth-description').textContent=value?'填写邀请码，为自己建立专属的饮食空间。':'登录后继续记录今天吃了什么。';
    document.getElementById('auth-switch-copy').textContent=value?'已经有账号？':'第一次使用？';
    switchButton.textContent=value?'返回登录':'用邀请码创建账号';
    submit.textContent=value?'创建账号并进入':'登录';
    inviteField.hidden=!value;
    document.getElementById('auth-invite').required=value;
    password.autocomplete=value?'new-password':'current-password';
    error.hidden=true;
  };
  switchButton.addEventListener('click',()=>setMode(!registering));
  if (location.hash==='#register') setMode(true);
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    error.hidden=true;
    submit.disabled=true;
    submit.textContent=registering?'正在创建…':'正在登录…';
    try {
      const body={username:document.getElementById('auth-username').value.trim(),password:password.value};
      if (registering) body.inviteCode=document.getElementById('auth-invite').value.trim();
      const response=await fetch(registering?'/api/auth/register':'/api/auth/login',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
      });
      const data=await response.json();
      if (!response.ok) throw new Error(data.error||'操作失败，请重试。');
      location.replace('/');
    } catch(failure) {
      error.textContent=failure.message||'连接失败，请稍后重试。';
      error.hidden=false;
      submit.disabled=false;
      submit.textContent=registering?'创建账号并进入':'登录';
    }
  });
})();
