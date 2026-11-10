// Injected UI for the official shell page: a compact template picker and the
// removal of the upstream "视频复刻" suggestion card.
//
// This is a runtime overlay, not a modification of the pinned upstream build:
// the shell files stay byte-identical (manifest hashes), the picker lives in its
// own fixed container, and every capability goes through the bridge's fixed
// `official-rpc` channels. If the anchors disappear in a future shell version,
// both behaviours degrade to "nothing is shown" rather than breaking the page.
export const shellUiInjection = `<script>(function(){
  if(globalThis.__no996ShellUi)return;globalThis.__no996ShellUi=1;
  // dsh-element-source-plus calls window.__dshEsSetShortcut(...) in every webview
  // it finds, including this page, before its own source is injected here — so the
  // console showed "is not a function". Accept the call; their real definition
  // overwrites this stub when it does load.
  if(typeof window.__dshEsSetShortcut!=='function'){
    window.__dshEsSetShortcut=function(){ return false; };
  }
  function rpc(channel,payload){
    return fetch('/__dsh/official-rpc',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({channel:channel,payload:payload})})
      .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();});
  }
  var wrap=document.createElement('div');
  wrap.id='no996-template-picker';
  wrap.style.cssText='position:fixed;z-index:2147483000;display:none;left:0;top:0;width:0;height:0';
  var box=document.createElement('div');
  box.style.cssText='display:flex;align-items:center;gap:6px;padding:5px 6px;border-radius:9px;background:rgba(24,24,27,.92);border:1px solid rgba(255,255,255,.14);box-shadow:0 6px 20px rgba(0,0,0,.35);font:12px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;color:#e9e9ee;box-sizing:border-box';
  var label=document.createElement('span');
  label.textContent='模板';
  label.style.cssText='opacity:.65;padding-left:4px;white-space:nowrap;letter-spacing:.02em';
  var select=document.createElement('select');
  select.setAttribute('aria-label','选择模板');
  select.style.cssText='flex:1 1 auto;min-width:0;background:#1f1f23;color:#e9e9ee;border:1px solid rgba(255,255,255,.16);border-radius:6px;padding:3px 6px;font:12px system-ui,sans-serif;outline:none;cursor:pointer';
  var open=document.createElement('button');
  open.type='button';
  open.textContent='↗';
  open.title='在新窗口打开（一次性 token）';
  open.style.cssText='flex:0 0 auto;background:transparent;color:#c9c9d1;border:1px solid rgba(255,255,255,.16);border-radius:6px;padding:3px 8px;font:12px system-ui,sans-serif;cursor:pointer';
  var button=document.createElement('button');
  button.type='button';
  button.textContent='新建项目';
  button.style.cssText='flex:0 0 auto;background:#3b82f6;color:#fff;border:0;border-radius:6px;padding:4px 10px;font:12px system-ui,sans-serif;cursor:pointer;white-space:nowrap';
  box.appendChild(label);box.appendChild(select);box.appendChild(button);box.appendChild(open);
  wrap.appendChild(box);
  try{document.documentElement.appendChild(wrap);}catch(e){return;}

  var list=null,busy=false;
  function fill(items){
    select.innerHTML='';
    for(var i=0;i<items.length;i++){
      var option=document.createElement('option');
      option.value=items[i].id;
      option.textContent=items[i].title||items[i].id;
      select.appendChild(option);
    }
    if(!items.length){
      var empty=document.createElement('option');
      empty.value='';empty.textContent='没有可用模板';select.appendChild(empty);
    }
  }
  function load(){
    if(list)return Promise.resolve(list);
    return rpc('template:list',{}).then(function(value){
      list=(value&&Array.isArray(value.templates))?value.templates:[];
      fill(list);return list;
    }).catch(function(){list=[];fill(list);return list;});
  }
  function reset(){
    busy=false;button.disabled=false;button.textContent='新建项目';
  }
  open.addEventListener('click',function(){
    open.disabled=true;
    rpc('editor:link',{}).then(function(value){
      var url=value&&value.url;
      // Prefix checks only. This snippet is produced from a template literal, so
      // regex escapes would be collapsed before the page ever parses it.
      var ok=typeof url==='string'&&(url.indexOf('http://127.0.0.1:')===0||url.indexOf('http://127.0.0.2:')===0||url.indexOf('http://localhost:')===0)&&url.indexOf('/__dsh/open#')>0;
      if(!ok)throw new Error('bad link');
      // The ticket is one-use and short-lived, so also put it on the clipboard:
      // a popup blocker after an await is common, and the person can paste it.
      try{ if(navigator.clipboard) navigator.clipboard.writeText(url).catch(function(){}); }catch(e){}
      open.title=url;
      var win=window.open(url,'_blank','noopener');
      if(!win){ open.textContent='已复制'; setTimeout(function(){ open.textContent='↗'; },2000); }
    }).catch(function(){ open.title='链接不可用'; }).then(function(){ setTimeout(function(){ open.disabled=false; },800); });
  });
  button.addEventListener('click',function(){
    if(busy)return;
    var id=select.value;
    if(!id)return;
    busy=true;button.disabled=true;button.textContent='创建中…';
    rpc('template:create',{templateId:id}).then(function(value){
      var projectId=value&&value.projectId;
      if(typeof projectId!=='string'||!/^[A-Za-z0-9_-]{6,40}$/.test(projectId))throw new Error('bad project');
      try{if(value.prompt)localStorage.setItem('no996.openfilm.templatePrompt',String(value.prompt).slice(0,600));}catch(e){}
      location.href='/projects/'+projectId;
    }).catch(function(){
      button.textContent='创建失败，重试';button.disabled=false;busy=false;
      setTimeout(reset,2500);
    });
  });
  function textNode(exact){
    var nodes=document.querySelectorAll('div,span,p,h1,h2,h3,button,a');
    for(var i=0;i<nodes.length;i++){
      var el=nodes[i];
      if(el.closest&&el.closest('#no996-template-picker'))continue;
      if(el.childElementCount===0&&(el.textContent||'').trim()===exact){
        var rect=el.getBoundingClientRect();
        if(rect.width>0&&rect.height>0)return el;
      }
    }
    return null;
  }
  function composer(){
    var nodes=document.querySelectorAll('textarea,[contenteditable="true"]');
    var best=null,bestArea=0;
    for(var i=0;i<nodes.length;i++){
      var el=nodes[i];
      if(el.closest&&el.closest('#no996-template-picker'))continue;
      var rect=el.getBoundingClientRect();
      if(rect.width<120||rect.height<16)continue;
      var hint=(el.getAttribute('placeholder')||'')+' '+(el.getAttribute('aria-label')||'');
      if(/描述你的影片|Describe your film|输入 @/.test(hint))return el;
      var area=rect.width*rect.height;
      if(rect.top>innerHeight*0.45&&area>bestArea){best=el;bestArea=area;}
    }
    return best;
  }
  // The chat column is the widest stable reference we have; the composer lives
  // at its bottom edge, so its left/width describe the column itself.
  function columnRect(){
    var el=composer();
    if(!el)return null;
    var rect=el.getBoundingClientRect();
    return rect.width>140?rect:null;
  }
  function columnBox(){
    var el=composer();
    if(!el)return null;
    var width=el.getBoundingClientRect().width;
    var node=el, box=el.getBoundingClientRect();
    for(var i=0;i<8&&node.parentElement;i++){
      var parent=node.parentElement;
      var rect=parent.getBoundingClientRect();
      if(rect.width>width+32||rect.height>innerHeight*0.98)break;
      node=parent;box=rect;
    }
    return box;
  }
  function anchorMode(){
    try{
      var forced=localStorage.getItem('no996.picker.anchor');
      if(forced==='heading'||forced==='header'||forced==='topright')return forced;
    }catch(e){}
    return 'heading';
  }
  // Empty-chat anchor: right under "你想做什么?", where the upstream suggestion
  // card sits. This is the place the person was pointing at.
  function placeUnderHeading(){
    var heading=textNode('你想做什么?')||textNode('你想做什么？')||textNode('你想做什么')||textNode('What do you want to make?');
    var head=heading?heading.getBoundingClientRect():null;
    var column=columnRect();
    if(!head||!column)return false;
    var width=Math.min(360,column.width-24);
    wrap.style.display='block';
    wrap.style.right='auto';
    wrap.style.width=Math.round(width)+'px';
    wrap.style.left=Math.round(column.left+12)+'px';
    wrap.style.top=Math.round(head.bottom+26)+'px';
    return true;
  }
  // Busy-chat anchor: on the header row, to the right of "新对话".
  function placeHeader(){
    // Conversation open: sit on the chat column's header row, flush right, so
    // nothing covers the composer or the message list.
    var box=columnBox();
    if(!box)return false;
    var width=Math.min(330,box.width-24);
    var left=box.right-width-10;
    wrap.style.display='block';
    wrap.style.width=Math.round(width)+'px';
    wrap.style.left=Math.round(left)+'px';
    wrap.style.top=Math.round(box.top+6)+'px';
    wrap.style.right='auto';
    return true;
  }
  function placeTopRight(){
    wrap.style.display='block';
    wrap.style.left='auto';
    wrap.style.right='16px';
    wrap.style.top='10px';
    wrap.style.width='340px';
  }
  function rectInfo(el){
    if(!el)return null;
    var rect=el.getBoundingClientRect();
    return {x:Math.round(rect.left),y:Math.round(rect.top),w:Math.round(rect.width),h:Math.round(rect.height)};
  }
  // Console helpers for the person, not the machine: open this page in a tab,
  // run __no996Probe() and paste the JSON. Nothing is written anywhere.
  globalThis.__no996Probe=function(){
    try{
      var column=columnRect();
      return {
        viewport:{w:innerWidth,h:innerHeight},
        mode:anchorMode(),
        heading:rectInfo(textNode('你想做什么?')||textNode('你想做什么？')||textNode('你想做什么')),
        header:rectInfo(textNode('新对话')||textNode('New chat')),
        composer:rectInfo(composer()),
        column:column?{x:Math.round(column.left),w:Math.round(column.width)}:null,
        picker:rectInfo(wrap),
        hiddenCards:document.querySelectorAll('[data-no996-hidden]').length
      };
    }catch(e){return {error:String(e&&e.message||e)};}
  };
  function place(){
    try{
      var mode=anchorMode();
      var placed=false;
      if(mode==='heading')placed=placeUnderHeading()||placeHeader();
      else if(mode==='header')placed=placeHeader();
      if(!placed)placeTopRight();
      wrap.setAttribute('data-no996-anchor',mode);
      globalThis.__no996PickerState={mode:mode,bar:rectInfo(wrap)};
    }catch(e){}
  }
  // The upstream suggestion card ("视频复刻") is hidden, never removed from the
  // bundle: the pinned build stays untouched and a future shell simply re-shows
  // it if the text changes.
  function hideReplica(){
    try{
      var nodes=document.querySelectorAll('button,[role="button"],a,div');
      for(var i=0;i<nodes.length;i++){
        var el=nodes[i];
        if(el.closest&&el.closest('#no996-template-picker'))continue;
        if(el.childElementCount===0&&(el.textContent||'').trim()==='视频复刻'){
          var card=el;
          for(var up=0;up<4&&card.parentElement&&card.parentElement!==document.body;up++){
            card=card.parentElement;
            var rect=card.getBoundingClientRect();
            if(rect.width>140&&rect.height>48)break;
          }
          if(card&&card!==document.body&&!card.hasAttribute('data-no996-hidden')){
            card.setAttribute('data-no996-hidden','1');
            card.style.display='none';
          }
        }
      }
    }catch(e){}
  }
  var hideTimer=null;
  function scheduleHide(){
    if(hideTimer)return;
    hideTimer=setTimeout(function(){hideTimer=null;hideReplica();},400);
  }
  try{
    new MutationObserver(scheduleHide).observe(document.documentElement,{childList:true,subtree:true});
  }catch(e){}
  load().then(place);
  place();
  setInterval(place,700);
  addEventListener('resize',place);
  hideReplica();

  // The page is all a person can see when the Host's Studio goes away, and the
  // upstream overlay tells them to restart an application that is not involved.
  // Watch the service ourselves and offer the one action that works: the fixed
  // loopback console, which re-mints a session and comes back on its own.
  var stop=document.createElement('div');
  stop.id='no996-stopped';
  stop.style.cssText='position:fixed;inset:0;z-index:2147483001;display:none;align-items:center;justify-content:center;background:rgba(10,10,12,.88);font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:#e9e9ee';
  stop.innerHTML='<div style="max-width:400px;padding:24px;border-radius:12px;background:#232326;border:1px solid rgba(255,255,255,.14);text-align:center;box-shadow:0 16px 48px rgba(0,0,0,.6)">'
    +'<div style="font-weight:600;font-size:15px;margin-bottom:8px">工作台已停止运行</div>'
    +'<div style="opacity:.75;font-size:12px;line-height:1.7;margin-bottom:18px">视频编辑服务已断开（会话过期或服务重启）。点下面的按钮即可恢复，项目和素材都不会丢。</div>'
    +'<a id="no996-restart" href="http://127.0.0.1:47821/editor" style="display:inline-block;padding:9px 20px;border-radius:8px;background:#3b82f6;color:#fff;text-decoration:none;font-size:13px">重新启动工作台</a>'
    +'<div style="opacity:.45;font-size:11px;margin-top:14px">换一台机器访问时，把地址换成该机器的 127.0.0.1:47821/editor</div>'
    +'</div>';
  try{ document.documentElement.appendChild(stop); }catch(e){}
  var misses=0;
  function probe(){
    var done=false;
    var finish=function(ok){
      if(done)return;
      done=true;
      if(ok){ misses=0; stop.style.display='none'; return; }
      misses+=1;
      if(misses>=2) stop.style.display='flex';
    };
    try{
      var controller=window.AbortController?new AbortController():null;
      var timer=setTimeout(function(){ try{controller&&controller.abort();}catch(e){} finish(false); },4000);
      fetch('/api/version',{cache:'no-store',credentials:'same-origin',signal:controller?controller.signal:undefined})
        .then(function(r){ clearTimeout(timer); finish(r.ok); })
        .catch(function(){ clearTimeout(timer); finish(false); });
    }catch(e){ finish(false); }
  }
  setTimeout(probe,3000);
  setInterval(probe,5000);
})()</script>`;
