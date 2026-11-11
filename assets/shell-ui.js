(function(){
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
  wrap.style.cssText='display:none;position:relative;box-sizing:border-box;min-width:0;flex:1 1 0';
  var box=document.createElement('div');
  box.style.cssText='display:none;position:fixed;z-index:2147483000;max-height:calc(100vh - 24px);overflow:auto;padding:16px;border-radius:14px;background:#242426;border:1px solid #45454b;box-shadow:0 14px 32px rgba(0,0,0,.42);font:12px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:#e9e9ee;box-sizing:border-box';
  var title=document.createElement('div');
  title.textContent='选择一个模板';
  title.style.cssText='font-size:14px;font-weight:600;color:#f3f3f5;margin:0 0 3px';
  var hint=document.createElement('div');
  hint.textContent='从现有模板开始，创建后可以继续编辑';
  hint.style.cssText='font-size:12px;line-height:1.5;color:#a3a3ad;margin-bottom:10px';
  var choices=document.createElement('div');
  choices.setAttribute('role','radiogroup');
  choices.setAttribute('aria-label','选择模板');
  choices.style.cssText='display:grid;gap:5px';
  var selected='';
  var cancel=document.createElement('button');
  cancel.type='button';cancel.textContent='取消';
  cancel.style.cssText='padding:7px 13px;border:1px solid #55555d;border-radius:7px;background:transparent;color:#d7d7de;font:12px system-ui,sans-serif;cursor:pointer';
  var button=document.createElement('button');
  button.type='button';
  button.textContent='新建项目';
  button.style.cssText='flex:0 0 auto;background:#3b82f6;color:#fff;border:0;border-radius:6px;padding:4px 10px;font:12px system-ui,sans-serif;cursor:pointer;white-space:nowrap';
  var footer=document.createElement('div');
  footer.style.cssText='display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-top:12px';
  footer.appendChild(cancel);footer.appendChild(button);
  box.appendChild(title);box.appendChild(hint);box.appendChild(choices);box.appendChild(footer);
  var trigger=document.createElement('button');
  trigger.type='button';
  trigger.textContent='选择模板';
  trigger.setAttribute('aria-expanded','false');
  trigger.style.cssText='display:flex;align-items:center;justify-content:center;width:100%;min-width:0;min-height:68px;padding:12px 10px;border:1px solid rgba(255,255,255,.10);border-radius:20px;background:#202022;color:#e9e9ee;font:14px system-ui,-apple-system,"Segoe UI",sans-serif;white-space:nowrap;cursor:pointer';
  function positionMenu(){
    if(box.style.display!=='block')return;
    var anchor=trigger.getBoundingClientRect();
    var width=Math.min(360,Math.max(0,innerWidth-24));
    box.style.width=width+'px';
    box.style.left=Math.max(12,Math.min(anchor.left,innerWidth-width-12))+'px';
    var height=box.getBoundingClientRect().height;
    var below=anchor.bottom+8;
    box.style.top=Math.max(12,Math.min(below,innerHeight-height-12))+'px';
  }
  function closeMenu(){box.style.display='none';trigger.setAttribute('aria-expanded','false');}
  trigger.addEventListener('click',function(){
    if(box.style.display==='block'){closeMenu();return;}
    box.style.display='block';trigger.setAttribute('aria-expanded','true');positionMenu();
  });
  cancel.addEventListener('click',function(){closeMenu();trigger.focus();});
  document.addEventListener('keydown',function(event){if(event.key==='Escape'&&box.style.display==='block'){closeMenu();trigger.focus();}});
  addEventListener('resize',positionMenu);
  addEventListener('scroll',positionMenu,true);
  wrap.appendChild(trigger);wrap.appendChild(box);
  // Insert into the upstream suggestion-card layout when that card exists.

  var list=null,busy=false;
  function fill(items){
    choices.textContent='';
    if(!items.some(function(item){return item.id===selected;}))selected=items.length?items[0].id:'';
    items.forEach(function(item){
      var option=document.createElement('button');
      option.type='button';option.setAttribute('role','radio');
      option.setAttribute('aria-checked',String(item.id===selected));
      option.style.cssText='display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:9px 10px;border:1px solid '+(item.id===selected?'#6c96da':'transparent')+';border-radius:8px;background:'+(item.id===selected?'#303c50':'#303032')+';color:#ededf0;cursor:pointer;font:inherit';
      var icons={'paper-texture':['▤','#d4ba91'],'replica-film':['▣','#8fb6d3'],'sketchnote':['✎','#d8b8a6']};
      var icon=document.createElement('span'),mark=icons[item.id]||['▧','#afb9cb'];
      icon.textContent=mark[0];icon.setAttribute('aria-hidden','true');
      icon.style.cssText='display:grid;place-items:center;flex:0 0 34px;height:34px;border-radius:8px;background:#17191d;color:'+mark[1]+';font-size:19px';
      var copy=document.createElement('span');copy.style.cssText='display:block;min-width:0';
      var name=document.createElement('span');name.textContent=item.title||item.id;
      name.style.cssText='display:block;font-size:13px;font-weight:600';copy.appendChild(name);
      if(item.description){var desc=document.createElement('span');desc.textContent=item.description;desc.style.cssText='display:block;color:#adadb5;font-size:11px;line-height:1.45;margin-top:3px';copy.appendChild(desc);}
      option.appendChild(icon);option.appendChild(copy);
      option.addEventListener('click',function(){selected=item.id;fill(items);});
      choices.appendChild(option);
    });
    button.disabled=!selected||busy;
    if(!items.length){var empty=document.createElement('div');empty.textContent='没有可用模板，请稍后重试';empty.style.cssText='color:#bcbcc4;padding:12px 4px';choices.appendChild(empty);}
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
    var id=selected;
    if(!id)return;
    busy=true;button.disabled=true;button.textContent='创建中…';
    rpc('template:create',{templateId:id}).then(function(value){
      var projectId=value&&value.projectId;
      if(typeof projectId!=='string'||!/^[A-Za-z0-9_-]{6,40}$/.test(projectId))throw new Error('bad project');
      try{if(value.prompt)localStorage.setItem('no996.openfilm.templatePrompt',String(value.prompt).slice(0,600));}catch(e){}
      wrap.style.display='none';
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
      var card=findReplicaCard();
      if(!card||!card.parentElement){wrap.style.display='none';return;}
      if(wrap.parentElement!==card.parentElement||wrap.nextElementSibling!==card)card.parentElement.insertBefore(wrap,card);
      // These are sibling suggestion cards; keep them side by side even in a narrow chat.
      card.parentElement.style.display='flex';
      card.parentElement.style.flexDirection='row';
      card.parentElement.style.alignItems='stretch';
      card.parentElement.style.gap='8px';
      card.style.flex='1 1 0';card.style.minWidth='0';
      wrap.style.display='block';
      positionMenu();
      wrap.setAttribute('data-no996-anchor','card');
      globalThis.__no996PickerState={mode:'card',bar:rectInfo(wrap)};
    }catch(e){}
  }
  // Keep the upstream suggestion visible, but disable its interaction without changing its implementation.
  var replicaCard=null;
  function findReplicaCard(){
    if(replicaCard&&replicaCard.isConnected)return replicaCard;
    replicaCard=null;
    try{
      var nodes=document.querySelectorAll('button,[role="button"],a,div,span,p');
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
          if(card&&card!==document.body&&card.parentElement){
            replicaCard=card;
            // Keep the upstream card and its React logic intact, but intercept interaction.
            card.setAttribute('data-no996-disabled','1');
            card.setAttribute('aria-disabled','true');
            card.style.opacity='0.45';card.style.cursor='not-allowed';
            card.title='视频复刻暂不可用';
            card.addEventListener('click',function(event){event.preventDefault();event.stopImmediatePropagation();},true);
            card.addEventListener('keydown',function(event){if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopImmediatePropagation();}},true);
            return card;
          }
        }
      }
    }catch(e){}
    return null;
  }
  function hideReplica(){ findReplicaCard(); place(); }
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
  // Ask the embedding panel to bootstrap again; never navigate to a fixed port.
  // The proxy's one-shot boot can precede a slow render or the iframe load.
  // Report readiness after load and keep checking until the shell has rendered.
  function reportReady(){
    if(window.parent===window)return;
    var root=document.getElementById('root');
    if(!root||!root.firstElementChild)return;
    window.parent.postMessage({type:'no996-openfilm:boot',version:1,hasNative:!!globalThis.openfilmNative,rendered:true},'*');
    clearInterval(readyTimer);
  }
  var readyTimer;
  function startReady(){ readyTimer=setInterval(reportReady,1000); setTimeout(reportReady,0); }
  if(document.readyState==='complete') startReady();
  else window.addEventListener('load',startReady,{once:true});
  var stop=document.createElement('div');
  stop.id='no996-stopped';
  stop.style.cssText='position:fixed;inset:0;z-index:2147483001;display:none;align-items:center;justify-content:center;background:rgba(10,10,12,.88);font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:#e9e9ee';
  stop.innerHTML='<div style="max-width:400px;padding:24px;border-radius:12px;background:#232326;border:1px solid rgba(255,255,255,.14);text-align:center;box-shadow:0 16px 48px rgba(0,0,0,.6)">'
    +'<div style="font-weight:600;font-size:15px;margin-bottom:8px">工作台已停止运行</div>'
    +'<div style="opacity:.75;font-size:12px;line-height:1.7;margin-bottom:18px">视频编辑服务已断开。重新启动会重新加载界面，未保存的内容可能丢失。</div>'
    +'<button id="no996-restart" type="button" style="display:inline-block;padding:9px 20px;border:0;border-radius:8px;background:#3b82f6;color:#fff;font-size:13px;cursor:pointer">重新启动工作台</button>'
    +'</div>';
  try{ document.documentElement.appendChild(stop); }catch(e){}
  var reported=false;
  function report(event){
    try{ rpc('client:log',{event:event}).catch(function(){}); }catch(e){}
  }
  var restartLink=stop.querySelector('#no996-restart');
  if(restartLink) restartLink.addEventListener('click',function(){
    report('restart-click');
    if(window.parent!==window) window.parent.postMessage({type:'no996-openfilm:restart',version:1},'*');
    else restartLink.textContent='请返回视频面板重试';
  });
  var misses=0;
  function probe(){
    var done=false;
    var finish=function(ok){
      if(done)return;
      done=true;
      if(ok){ misses=0; stop.style.display='none'; return; }
      misses+=1;
      if(misses>=2){
        stop.style.display='flex';
        if(!reported){ reported=true; report('recovery-shown'); }
      }
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
})()
