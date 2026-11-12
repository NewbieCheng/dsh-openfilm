import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const white = readFileSync(join(root, 'assets/logo-symbol-white.svg'), 'utf8').trim();

const css = [
  '.nof-lg{--night:#05060f;--panel:#0a1224;--text:#f3eee4;--dim:#8d90a6;--brand:#051D43;--orange:#FF6400;--orange-deep:#d45500;--paper:#f5f0e5;--paper-2:#ebe4d2;--ink:#18171c;--ink-dim:#6d6a62;--err:#a33a2a;--tlh:72px;--hand:"Ma Shan Zheng","STKaiti","KaiTi",cursive;--sans:"Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif;position:fixed;inset:0;z-index:2147482500;overflow:hidden;background:var(--night);color:var(--text);font-family:var(--sans);box-sizing:border-box}',
  '.nof-lg *,.nof-lg *::before,.nof-lg *::after{box-sizing:border-box}',
  '.nof-lg .sky,.nof-lg .sun,.nof-lg .grain{position:absolute;inset:0;pointer-events:none}',
  '.nof-lg .sky{background:linear-gradient(180deg,#051D43 0%,#0b1a33 48%,#3a2418 100%)}',
  '.nof-lg .sun{inset:auto;right:8%;bottom:calc(var(--tlh) - 40px);width:min(42vmin,280px);height:min(42vmin,280px)}',
  '.nof-lg .sun svg{width:100%;height:100%;overflow:visible;display:block}',
  '.nof-lg .grain{opacity:.08;mix-blend-mode:overlay;background:url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'180\' height=\'180\'><filter id=\'n\'><feTurbulence baseFrequency=\'.85\' numOctaves=\'2\' stitchTiles=\'stitch\'/></filter><rect width=\'100%\' height=\'100%\' filter=\'url(%23n)\'/></svg>")}',
  '.nof-lg .brand{position:absolute;top:max(12px,env(safe-area-inset-top,0px));left:clamp(12px,2vw,24px);z-index:2;display:flex;align-items:center;gap:8px;font-weight:500;font-size:14px;letter-spacing:.04em}',
  '.nof-lg .brand .mark{width:26px;height:26px;display:block;flex:none}',
  '.nof-lg .brand .mark svg{width:100%;height:100%;display:block}',
  '.nof-lg .brand small{font-weight:400;font-size:12px;color:var(--dim)}',
  '.nof-lg main{position:relative;z-index:1;height:100%;display:flex;align-items:center;justify-content:center;padding:48px 16px calc(var(--tlh) + 20px);overflow:auto}',
  '.nof-lg .paper{width:min(100%,380px);position:relative;padding:22px 24px 16px;border-radius:3px;color:var(--ink);background:radial-gradient(circle,#d3cab3 1px,transparent 1.3px) 0 0/14px 14px,linear-gradient(160deg,var(--paper),var(--paper-2));box-shadow:0 0 0 1px rgba(255,100,0,.28),0 24px 56px rgba(0,0,0,.5)}',
  '.nof-lg .tape{position:absolute;top:-9px;left:-12px;width:72px;height:20px;transform:rotate(-8deg);background:repeating-linear-gradient(135deg,rgba(255,255,255,.3) 0 4px,transparent 4px 9px),rgba(255,100,0,.88);z-index:2}',
  '.nof-lg h1{margin:0;font:400 28px/1.2 var(--hand);letter-spacing:.02em;color:var(--brand)}',
  '.nof-lg .sub{margin:6px 0 14px;font-size:12px;color:var(--ink-dim);line-height:1.45}',
  '.nof-lg .fld{display:block;margin-bottom:12px}',
  '.nof-lg .fld>span{display:block;font-size:12px;color:var(--ink-dim);margin-bottom:1px}',
  '.nof-lg .inw{position:relative;display:flex;align-items:center}',
  '.nof-lg .inw>.ic{position:absolute;left:2px;width:16px;height:16px;color:var(--ink-dim);flex:none;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}',
  '.nof-lg .inw:focus-within>.ic{color:var(--orange)}',
  '.nof-lg .fld input{width:100%;font:500 15px var(--sans);color:var(--ink);background:transparent;border:0;border-bottom:1px solid rgba(24,23,28,.35);border-radius:0;padding:7px 30px 7px 26px;outline:0;caret-color:var(--orange)}',
  '.nof-lg .fld input:focus-visible{border-bottom-color:var(--orange);box-shadow:0 1px 0 var(--orange)}',
  '.nof-lg .fld input::placeholder{color:#a8a291}',
  '.nof-lg .eye{position:absolute;right:0;display:grid;place-items:center;width:28px;height:28px;color:var(--ink-dim);background:none;border:0;border-radius:50%;cursor:pointer;padding:0;font-size:14px}',
  '.nof-lg .go{width:100%;margin-top:6px;font:500 15px var(--sans);letter-spacing:.06em;padding:.72em 1em;border-radius:2px;border:0;background:var(--brand);color:#fff;cursor:pointer;box-shadow:inset 0 -2px 0 rgba(255,100,0,.85)}',
  '.nof-lg .go:disabled{opacity:.55;cursor:default}',
  '.nof-lg .links{display:flex;justify-content:space-between;gap:10px;margin-top:10px;font-size:12px;flex-wrap:wrap}',
  '.nof-lg .lk{color:var(--orange-deep);background:none;border:0;font:inherit;padding:2px 0;cursor:pointer;text-decoration:underline;text-underline-offset:3px}',
  '.nof-lg .aside{margin:10px 0 0;min-height:1.3em;font-size:12px;color:var(--ink-dim)}',
  '.nof-lg .aside.err{color:var(--err)}',
  '.nof-lg .row{display:flex;gap:8px;align-items:flex-end}',
  '.nof-lg .row .fld{flex:1;margin-bottom:12px}',
  '.nof-lg .otp{flex:none;margin-bottom:12px;font:500 12px var(--sans);padding:.55em .75em;border-radius:2px;border:1px solid rgba(5,29,67,.2);background:transparent;color:var(--orange-deep);cursor:pointer}',
  '.nof-lg .otp:disabled{opacity:.5}',
  '.nof-lg .tl{position:absolute;left:0;right:0;bottom:0;z-index:1;background:var(--panel);border-top:1px solid rgba(255,100,0,.22);padding-bottom:env(safe-area-inset-bottom,0px)}',
  '.nof-lg .clips{display:flex;gap:2px;padding:6px 8px 8px;height:var(--tlh);box-sizing:border-box}',
  '.nof-lg .clip{flex:1;min-width:0;border-radius:3px;overflow:hidden;display:flex;flex-direction:column;background:#000;outline:1px solid transparent;outline-offset:-1px}',
  '.nof-lg .clip.cur{outline-color:var(--orange)}',
  '.nof-lg .clip b{display:block;font:500 10px/16px var(--sans);padding:0 5px;background:#122038;color:#aeb0c4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '.nof-lg .clip.cur b{color:var(--orange)}',
  '.nof-lg .clip i{flex:1;position:relative;background:linear-gradient(180deg,#1a2740,#12152b)}',
  '.nof-lg .clip i::before{content:"";position:absolute;left:55%;top:40%;width:8px;height:8px;margin:-4px;border-radius:50%;background:var(--orange);opacity:.7}',
  '.nof-lg .ph{position:absolute;top:0;bottom:0;width:1px;background:var(--orange);left:8%;box-shadow:0 0 10px rgba(255,100,0,.6)}',
  '.nof-lg .cap-mask{position:absolute;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(5,29,67,.55)}',
  '.nof-lg .cap{width:min(100%,400px);background:#fff;color:#18171c;border-radius:10px;box-shadow:0 20px 48px rgba(0,0,0,.4);padding:14px;font:13px/1.4 var(--sans)}',
  '.nof-lg .cap h2{margin:0 0 4px;font:600 15px/1.3 inherit;color:#051D43}',
  '.nof-lg .cap .hint{margin:0 0 8px;font-size:12px;color:#6d6a62}',
  '.nof-lg .cap .stage{position:relative;min-height:200px;border:1px solid #e5e1d8;border-radius:8px;background:#f7f5f0;overflow:hidden;cursor:pointer}',
  '.nof-lg .cap .stage svg{display:block;width:100%;height:100%;min-height:200px}',
  '.nof-lg .cap .pick{position:absolute;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;background:#FF6400;color:#fff;display:grid;place-items:center;font:700 10px/1 inherit;pointer-events:none;box-shadow:0 0 0 2px #fff}',
  '.nof-lg .cap .err{min-height:1.2em;margin:8px 0 0;font-size:12px;color:#a33a2a}',
  '.nof-lg .cap .acts{display:flex;gap:10px;margin-top:10px;align-items:center}',
  '.nof-lg .cap .acts button{font:inherit;cursor:pointer}',
  '.nof-lg .cap .cancel{background:none;border:0;color:#8a6a2c;text-decoration:underline;text-underline-offset:3px}',
  '.nof-lg .cap .refresh{padding:4px 10px;border:1px solid #e5e1d8;border-radius:6px;background:#fff;color:#051D43}',
  '@media (max-height:640px){.nof-lg{--tlh:56px}.nof-lg h1{font-size:24px}.nof-lg main{padding:40px 12px calc(var(--tlh) + 12px)}.nof-lg .paper{padding:16px 18px 12px}}',
  '@media (max-height:520px){.nof-lg{--tlh:0px}.nof-lg .tl{display:none}.nof-lg main{padding:36px 12px 16px}}',
].join('');

const body = `(function(){
  if(globalThis.__no996ShellLogin)return;globalThis.__no996ShellLogin=1;
  var BRAND_WHITE=${JSON.stringify(white)};
  function rpc(channel,payload){
    return fetch('/__dsh/official-rpc',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({channel:channel,payload:payload||{}})})
      .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();});
  }
  function auth(action,fields){
    return rpc('auth:action',Object.assign({action:action},fields||{})).then(function(data){
      if(data&&data.ok===false)throw new Error(data.message||data.error||'请求失败');
      return data;
    });
  }
  function emitAuth(loggedIn){
    try{window.dispatchEvent(new CustomEvent('no996-auth-changed',{detail:{loggedIn:!!loggedIn}}));}catch(e){}
  }
  var CSS=${JSON.stringify(css)};
  var NAMES=['上班','开会','改稿','返工','收尾','关电脑','下班'];
  var GREET={login:'欢迎回来，准点下班。',register:'新同事，欢迎入职。',reset:'忘了也没关系。'};
  var SUB={login:'登录后继续剪辑；会话保存在本机。',register:'注册需要邮箱验证码与邀请码。',reset:'用邮箱验证码设置新密码。'};
  var ICON_LABEL={fish:'鱼',cake:'蛋糕',egg:'蛋',milk:'牛奶',chili:'辣椒',potato:'土豆',chocolate:'巧克力',garlic:'蒜',scallion:'葱',mint:'薄荷',snow_lotus:'雪莲',sweet_potato:'红薯',bean:'豆子'};

  var root=document.createElement('div');
  root.id='no996-shell-login';
  root.className='nof-lg';
  root.setAttribute('role','dialog');
  root.setAttribute('aria-label','登录');
  root.hidden=true;

  var style=document.createElement('style');
  style.textContent=CSS;
  root.appendChild(style);

  var font=document.createElement('link');
  font.rel='stylesheet';
  font.href='https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&family=Noto+Sans+SC:wght@400;500;600&display=swap';
  root.appendChild(font);

  function el(tag,attrs,kids){
    var node=document.createElement(tag);
    if(attrs)Object.keys(attrs).forEach(function(k){
      if(k==='text')node.textContent=attrs[k];
      else if(k==='html')node.innerHTML=attrs[k];
      else if(k==='hidden')node.hidden=!!attrs[k];
      else node.setAttribute(k,attrs[k]);
    });
    (kids||[]).forEach(function(c){if(c)node.appendChild(c);});
    return node;
  }

  var sky=el('div',{class:'sky'});
  var sun=el('div',{class:'sun','aria-hidden':'true'});
  sun.innerHTML='<svg viewBox="-200 -200 400 400"><defs><radialGradient id="nof-g"><stop offset="0" stop-color="#FF6400" stop-opacity=".28"/><stop offset="1" stop-color="#FF6400" stop-opacity="0"/></radialGradient></defs><circle r="200" fill="url(#nof-g)"/><circle r="56" fill="#FF6400"/><g fill="none" stroke="#FF6400"><circle r="80" stroke-opacity=".5"/><circle r="108" stroke-opacity=".32"/><circle r="140" stroke-opacity=".18"/></g></svg>';
  var grain=el('div',{class:'grain'});
  var brand=el('div',{class:'brand'});
  var mark=el('span',{class:'mark','aria-hidden':'true'});
  mark.innerHTML=BRAND_WHITE;
  brand.appendChild(mark);
  brand.appendChild(document.createTextNode('不加班 '));
  brand.appendChild(el('small',{text:'AI 剪辑'}));

  var title=el('h1',{id:'nof-title'});
  var sub=el('p',{class:'sub',id:'nof-sub'});
  var form=el('form',{id:'nof-form',novalidate:''});
  var accountLab=el('span',{id:'nof-acc-lab',text:'账号'});
  var account=el('input',{id:'nof-account',autocomplete:'username',autocapitalize:'none',spellcheck:'false',placeholder:'手机号或邮箱'});
  var accountFld=el('label',{class:'fld'},[accountLab,el('span',{class:'inw'},[
    (function(){var s=el('svg',{class:'ic',viewBox:'0 0 24 24','aria-hidden':'true'});s.innerHTML='<circle cx="12" cy="8" r="3.6"/><path d="M5 20c.8-4 3.6-6 7-6s6.2 2 7 6"/>';return s;})(),
    account
  ])]);
  var name=el('input',{id:'nof-name',autocomplete:'nickname'});
  var nameWrap=el('label',{class:'fld',id:'nof-name-wrap',hidden:true},[el('span',{text:'昵称（可选）'}),el('span',{class:'inw'},[
    (function(){var s=el('svg',{class:'ic',viewBox:'0 0 24 24','aria-hidden':'true'});s.innerHTML='<circle cx="12" cy="8" r="3.6"/><path d="M5 20c.8-4 3.6-6 7-6s6.2 2 7 6"/>';return s;})(),
    name
  ])]);
  var code=el('input',{id:'nof-code',inputmode:'numeric',autocomplete:'one-time-code',placeholder:'6 位'});
  var otpBtn=el('button',{type:'button',class:'otp',id:'nof-otp',text:'发送验证码'});
  var otpRow=el('div',{class:'row',id:'nof-otp-row',hidden:true},[
    el('label',{class:'fld'},[el('span',{text:'邮箱验证码'}),el('span',{class:'inw'},[
      (function(){var s=el('svg',{class:'ic',viewBox:'0 0 24 24','aria-hidden':'true'});s.innerHTML='<rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8.5 11V8.5a3.5 3.5 0 0 1 7 0V11"/>';return s;})(),
      code
    ])]),
    otpBtn
  ]);
  var invite=el('input',{id:'nof-invite',autocomplete:'off'});
  var inviteWrap=el('label',{class:'fld',id:'nof-invite-wrap',hidden:true},[el('span',{text:'邀请码'}),el('span',{class:'inw'},[
    (function(){var s=el('svg',{class:'ic',viewBox:'0 0 24 24','aria-hidden':'true'});s.innerHTML='<rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8.5 11V8.5a3.5 3.5 0 0 1 7 0V11"/>';return s;})(),
    invite
  ])]);
  var password=el('input',{id:'nof-password',type:'password',autocomplete:'current-password',placeholder:'至少 6 位'});
  var eye=el('button',{type:'button',class:'eye',id:'nof-eye','aria-label':'显示密码','aria-pressed':'false',text:'👁'});
  var pwLab=el('span',{id:'nof-pw-lab',text:'密码'});
  var pwFld=el('label',{class:'fld'},[pwLab,el('span',{class:'inw'},[
    (function(){var s=el('svg',{class:'ic',viewBox:'0 0 24 24','aria-hidden':'true'});s.innerHTML='<rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8.5 11V8.5a3.5 3.5 0 0 1 7 0V11"/>';return s;})(),
    password,eye
  ])]);
  var go=el('button',{type:'submit',class:'go',id:'nof-go',text:'登录并继续剪辑'});
  var left=el('button',{type:'button',class:'lk',id:'nof-left',text:'忘记密码'});
  var right=el('button',{type:'button',class:'lk',id:'nof-right',text:'注册新账号'});
  var aside=el('p',{class:'aside',id:'nof-aside',text:'使用不加班账号登录。点登录后完成人机验证即可。'});
  form.appendChild(accountFld);form.appendChild(nameWrap);form.appendChild(otpRow);form.appendChild(inviteWrap);form.appendChild(pwFld);form.appendChild(go);
  form.appendChild(el('div',{class:'links'},[left,right]));form.appendChild(aside);
  var paper=el('section',{class:'paper'},[el('i',{class:'tape'}),title,sub,form]);
  var main=el('main',null,[paper]);
  var clips=el('div',{class:'clips',id:'nof-clips'});
  NAMES.forEach(function(n,i){
    var c=el('div',{class:'clip',html:'<b></b><i></i>'});
    c.querySelector('b').textContent=n;
    if(i===0)c.classList.add('cur');
    clips.appendChild(c);
  });
  var tl=el('div',{class:'tl','aria-hidden':'true'},[clips,el('div',{class:'ph'})]);
  var capMask=el('div',{class:'cap-mask',id:'nof-cap',hidden:true});
  var capHint=el('p',{class:'hint',id:'nof-cap-hint',text:'请完成人机验证'});
  var capStage=el('div',{class:'stage',id:'nof-cap-stage'});
  var capErr=el('p',{class:'err',id:'nof-cap-err'});
  var capRefresh=el('button',{type:'button',class:'refresh',id:'nof-cap-refresh',text:'换一张'});
  var capCancel=el('button',{type:'button',class:'cancel',id:'nof-cap-cancel',text:'取消'});
  capMask.appendChild(el('div',{class:'cap',role:'dialog','aria-modal':'true','aria-label':'人机验证'},[
    el('h2',{text:'人机验证'}),capHint,capStage,capErr,el('div',{class:'acts'},[capRefresh,capCancel])
  ]));

  [sky,sun,grain,brand,main,tl,capMask].forEach(function(n){root.appendChild(n);});
  (document.documentElement||document.body).appendChild(root);

  var mode='login',busy=false,otpWait=0,pending=null,captchaId='',captchaPrompt='',captchaSequence=[],captchaClicks=[],captchaWrong=0;

  function problem(msg){aside.textContent=msg;aside.classList.add('err');}
  function note(msg){aside.textContent=msg;aside.classList.remove('err');}
  function paintMode(){
    title.textContent=GREET[mode];
    sub.textContent=SUB[mode];
    accountLab.textContent=mode==='login'?'账号':'邮箱';
    account.placeholder=mode==='login'?'手机号或邮箱':'name@example.com';
    pwLab.textContent=mode==='reset'?'新密码':'密码';
    password.autocomplete=mode==='login'?'current-password':'new-password';
    nameWrap.hidden=mode!=='register';
    otpRow.hidden=mode==='login';
    inviteWrap.hidden=mode!=='register';
    go.textContent=mode==='login'?'登录并继续剪辑':mode==='register'?'注册并继续剪辑':'更新密码';
    left.textContent=mode==='login'?'忘记密码':'返回登录';
    right.textContent=mode==='login'?'注册新账号':mode==='register'?'去登录':'去登录';
    note(mode==='login'?'使用不加班账号登录。点登录后完成人机验证即可。':'');
  }
  function show(){root.hidden=false;paintMode();}
  function hide(){root.hidden=true;capMask.hidden=true;pending=null;}

  function fillCaptchaViewport(svg){
    return String(svg||'').replace(/<svg\\b([^>]*)>/,function(_t,attrs){
      return /\\spreserveAspectRatio\\s*=/.test(attrs)
        ? '<svg'+attrs.replace(/\\spreserveAspectRatio\\s*=\\s*(["']).*?\\1/,' preserveAspectRatio="none"')+'>'
        : '<svg'+attrs+' preserveAspectRatio="none">';
    });
  }
  function isSequencePrompt(prompt){
    return prompt==='click_sequence'||prompt==='click_size_asc'||prompt==='click_size_desc';
  }
  function promptHint(prompt,iconTarget){
    var icon=ICON_LABEL[iconTarget]||'图标';
    if(prompt==='click_largest')return '请点击最大的'+icon;
    if(prompt==='click_smallest')return '请点击最小的'+icon;
    if(prompt==='click_second_smallest')return '请点击第二小的'+icon;
    if(prompt==='click_icon')return '请点击图中的'+icon;
    if(prompt==='click_sequence')return '请按提示顺序点击';
    if(prompt==='click_size_asc')return '请按从小到大点击'+icon;
    if(prompt==='click_size_desc')return '请按从大到小点击'+icon;
    return '请完成人机验证';
  }
  function expectedSteps(){
    if(captchaPrompt==='click_sequence')return captchaSequence.length||1;
    if(captchaPrompt==='click_size_asc'||captchaPrompt==='click_size_desc')return 4;
    return 1;
  }
  function clearCaptchaMarks(){
    captchaClicks=[];captchaWrong=0;
    Array.prototype.slice.call(capStage.querySelectorAll('.pick')).forEach(function(n){n.remove();});
    Array.prototype.slice.call(capStage.querySelectorAll('.is-picked')).forEach(function(n){n.classList.remove('is-picked');});
  }
  function loadCaptcha(){
    capErr.textContent='';
    clearCaptchaMarks();
    capStage.innerHTML='<div style="display:grid;place-items:center;min-height:200px;color:#8d90a6">加载中…</div>';
    return auth('captcha',{type:'click'}).then(function(data){
      if(!data||!data.id||!data.svg){capErr.textContent='验证码加载失败，请重试';return;}
      captchaId=data.id;
      captchaPrompt=data.prompt||'';
      captchaSequence=Array.isArray(data.sequence)?data.sequence:[];
      capHint.textContent=promptHint(captchaPrompt,data.icon_target);
      var wrap=document.createElement('div');
      wrap.style.cssText='position:absolute;inset:1px';
      wrap.innerHTML=fillCaptchaViewport(data.svg);
      capStage.innerHTML='';
      capStage.appendChild(wrap);
    }).catch(function(err){capErr.textContent=err.message||'验证码加载失败';});
  }
  function openCaptcha(kind){
    pending=kind;capMask.hidden=false;loadCaptcha();
  }
  function closeCaptcha(){capMask.hidden=true;pending=null;captchaId='';clearCaptchaMarks();}

  function afterLogin(){
    hide();
    emitAuth(true);
    try{
      if(window.parent!==window)window.parent.postMessage({type:'no996-openfilm:auth',version:1,action:'logged-in'},'*');
    }catch(e){}
  }

  function finishCaptcha(codeValue){
    var kind=pending;
    if(kind==='login')runLogin(captchaId,codeValue);
    else if(kind==='otp')runOtp(captchaId,codeValue);
    else closeCaptcha();
  }
  function runLogin(id,codeValue){
    busy=true;go.disabled=true;
    return auth('login',{account:account.value.trim(),password:password.value,captchaId:id,captchaCode:codeValue})
      .then(afterLogin)
      .catch(function(err){problem(err.message||'登录失败');})
      .finally(function(){busy=false;go.disabled=false;closeCaptcha();});
  }
  function runOtp(id,codeValue){
    busy=true;otpBtn.disabled=true;
    return auth('verification-code',{
      account:account.value.trim(),
      purpose:mode==='reset'?'reset_password':'register',
      captchaId:id,captchaCode:codeValue
    }).then(function(){
      note('验证码已发送，请查收邮箱');
      otpWait=60;otpBtn.textContent=otpWait+'s';
      var timer=setInterval(function(){
        otpWait-=1;
        if(otpWait<=0){clearInterval(timer);otpBtn.disabled=false;otpBtn.textContent='发送验证码';}
        else otpBtn.textContent=otpWait+'s';
      },1000);
    }).catch(function(err){problem(err.message||'验证码发送失败');otpBtn.disabled=false;})
      .finally(function(){busy=false;closeCaptcha();});
  }

  capStage.addEventListener('click',function(ev){
    if(!captchaId||capMask.hidden)return;
    var target=ev.target&&ev.target.closest?ev.target.closest('[data-captcha-id]'):null;
    if(!target)return;
    var id=target.getAttribute('data-captcha-id');
    var kind=target.getAttribute('data-captcha-kind')||'';
    if(!id)return;
    var sr=capStage.getBoundingClientRect();
    var tr=target.getBoundingClientRect();
    function addMark(order){
      var mark=el('span',{class:'pick',text:String(order)});
      mark.style.left=(tr.left-sr.left+tr.width/2)+'px';
      mark.style.top=(tr.top-sr.top+tr.height/2)+'px';
      capStage.appendChild(mark);
      target.classList.add('is-picked');
    }
    if(!isSequencePrompt(captchaPrompt)){
      addMark(1);
      setTimeout(function(){finishCaptcha(id);},180);
      return;
    }
    if(captchaClicks.indexOf(id)!==-1)return;
    if(captchaPrompt==='click_sequence'){
      var expected=captchaSequence[captchaClicks.length];
      if(expected&&kind!==expected){
        captchaWrong+=1;
        captchaClicks=[];
        Array.prototype.slice.call(capStage.querySelectorAll('.pick')).forEach(function(n){n.remove();});
        Array.prototype.slice.call(capStage.querySelectorAll('.is-picked')).forEach(function(n){n.classList.remove('is-picked');});
        if(captchaWrong>=2){capErr.textContent='点错太多次，已刷新题目';loadCaptcha();}
        else capErr.textContent='顺序不对，请重试';
        return;
      }
    }
    captchaClicks.push(id);
    addMark(captchaClicks.length);
    capErr.textContent='';
    if(captchaClicks.length>=expectedSteps()){
      setTimeout(function(){finishCaptcha(captchaClicks.join(','));},220);
    }
  });
  capRefresh.addEventListener('click',function(){loadCaptcha();});
  capCancel.addEventListener('click',function(){closeCaptcha();});

  eye.addEventListener('click',function(){
    var show=password.type==='password';
    password.type=show?'text':'password';
    eye.setAttribute('aria-pressed',show?'true':'false');
  });
  left.addEventListener('click',function(){
    if(mode==='login'){mode='reset';paintMode();}
    else{mode='login';paintMode();}
  });
  right.addEventListener('click',function(){
    mode=mode==='login'?'register':'login';
    paintMode();
  });
  otpBtn.addEventListener('click',function(){
    if(busy||otpWait>0)return;
    if(account.value.trim().indexOf('@')===-1)return problem('请先填写邮箱');
    openCaptcha('otp');
  });
  form.addEventListener('submit',function(ev){
    ev.preventDefault();
    if(busy||!capMask.hidden)return;
    var acc=account.value.trim();
    if(!acc)return problem(mode==='login'?'请输入账号：手机号或邮箱。':'请输入邮箱。');
    if(mode==='login'){
      if(password.value.length<6)return problem('密码至少 6 位，请重新输入。');
      openCaptcha('login');
      return;
    }
    if(mode==='register'){
      if(acc.indexOf('@')===-1)return problem('注册请使用邮箱。');
      if(password.value.length<6)return problem('密码至少 6 位。');
      if(!code.value.trim())return problem('请输入邮箱验证码。');
      if(!invite.value.trim())return problem('请输入邀请码。');
      busy=true;go.disabled=true;
      auth('register',{account:acc,password:password.value,code:code.value.trim(),inviteCode:invite.value.trim(),displayName:name.value.trim()||undefined})
        .then(afterLogin)
        .catch(function(err){problem(err.message||'注册失败');})
        .finally(function(){busy=false;go.disabled=false;});
      return;
    }
    if(acc.indexOf('@')===-1)return problem('请使用邮箱重置密码。');
    if(!code.value.trim())return problem('请输入邮箱验证码。');
    if(password.value.length<6)return problem('新密码至少 6 位。');
    busy=true;go.disabled=true;
    auth('reset-password',{account:acc,code:code.value.trim(),newPassword:password.value})
      .then(function(){mode='login';paintMode();note('密码已更新，请登录。');code.value='';})
      .catch(function(err){problem(err.message||'重置失败');})
      .finally(function(){busy=false;go.disabled=false;});
  });

  function syncFromStatus(){
    rpc('auth:status',{}).then(function(data){
      if(data&&data.loggedIn===true)hide();
      else show();
    }).catch(function(){show();});
  }
  window.addEventListener('no996-auth-changed',function(ev){
    if(ev&&ev.detail&&ev.detail.loggedIn)hide();
    else show();
  });
  paintMode();
  syncFromStatus();
})();
`;

writeFileSync(join(root, 'assets/shell-login.js'), body, 'utf8');
console.log('wrote assets/shell-login.js', body.length);
