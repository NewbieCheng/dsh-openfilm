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
  var button=document.createElement('button');
  button.type='button';
  button.textContent='新建项目';
  button.style.cssText='flex:0 0 auto;background:#3b82f6;color:#fff;border:0;border-radius:6px;padding:4px 10px;font:12px system-ui,sans-serif;cursor:pointer;white-space:nowrap';
  box.appendChild(label);box.appendChild(select);box.appendChild(button);
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
  function place(){
    try{
      var el=composer();
      var rect=el?el.getBoundingClientRect():null;
      wrap.style.display='block';
      if(rect&&rect.width>140){
        wrap.style.left=Math.round(rect.left)+'px';
        wrap.style.right='auto';
        wrap.style.width=Math.round(rect.width)+'px';
        wrap.style.top=Math.round(Math.max(8,rect.top-42))+'px';
      }else{
        wrap.style.left='auto';
        wrap.style.right='16px';
        wrap.style.top='10px';
        wrap.style.width='340px';
      }
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
})()</script>`;
