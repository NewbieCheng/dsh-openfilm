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

  // Account chip + page reload live in OpenFilm React (WorkbenchAccountControls),
  // not DOM injection — see packages/openfilm/studio/ui/.../WorkbenchAccount.tsx.

  // Keep the upstream suggestion visible, but disable its interaction without changing its implementation.
  var replicaCard=null;
  function findReplicaCard(){
    if(replicaCard&&replicaCard.isConnected)return replicaCard;
    replicaCard=null;
    try{
      var nodes=document.querySelectorAll('button,[role="button"],a,div,span,p');
      for(var i=0;i<nodes.length;i++){
        var el=nodes[i];
        if(el.childElementCount===0&&(el.textContent||'').trim()==='视频复刻'){
          el.style.whiteSpace='nowrap';el.style.overflow='hidden';el.style.textOverflow='ellipsis';el.style.maxWidth='100%';
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
  // "更多技能" and "从示例开始" open flows this build does not carry. Keep them in
  // the row so it still reads like upstream, but stop clicks the same way the
  // replica card is stopped.
  var extrasApplied={};
  function disableExtras(){
    try{
      var labels=['更多技能','从示例开始'];
      // The panel polls often; once both links are marked and still mounted, skip the walk.
      if(labels.every(function(label){return extrasApplied[label]&&extrasApplied[label].isConnected;}))return;
      // Match the text node itself: these links carry a chevron icon beside the label,
      // so requiring a childless element would miss them.
      var walker=document.createTreeWalker(document.body||document.documentElement,4,null);
      var node;
      while((node=walker.nextNode())){
        if(labels.indexOf((node.nodeValue||'').trim())<0)continue;
        var el=node.parentElement;
        if(!el)continue;
        var target=el.closest('button,[role="button"],a')||el;
        if(target.hasAttribute('data-no996-off'))continue;
        target.setAttribute('data-no996-off','1');
        extrasApplied[(node.nodeValue||'').trim()]=target;
        target.setAttribute('aria-disabled','true');
        target.style.opacity='0.45';
        target.style.cursor='not-allowed';
        target.style.pointerEvents='none';
        target.addEventListener('click',function(event){event.preventDefault();event.stopImmediatePropagation();},true);
        target.addEventListener('keydown',function(event){if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopImmediatePropagation();}},true);
      }
    }catch(e){}
  }
  // The pinned build cannot update itself, so the About panel's failed update
  // check is noise. Say what this build is, and drop the update row plus the
  // GitHub / 示例 / 官网 links: they point at upstream, not at this wrapper.
  // Matched by exact label rather than by an ancestor panel: inside that page the
  // update line and the footer links sit in different containers, so a walk up
  // from the line never reached the links.
  function tuneAbout(){
    try{
      var walker=document.createTreeWalker(document.body||document.documentElement,4,null);
      var node,footerRow=null;
      while((node=walker.nextNode())){
        var text=(node.nodeValue||'').trim();
        if(!text)continue;
        if(text.indexOf('更新没能完成')>=0){node.nodeValue='基于 OpenFilm 开发';continue;}
        if(text.indexOf('发现新版本')>=0||text==='检查更新'){
          var row=node.parentElement;
          if(row)row.style.display='none';
          continue;
        }
        if(text==='GitHub'||text==='示例'||text==='官网'){
          var el=node.parentElement;
          if(!el)continue;
          if(text==='GitHub')footerRow=el.parentElement;
          el.style.display='none';
        }
      }
      if(footerRow&&!document.querySelector('[data-no996-version]')){
        var tag=document.createElement('div');
        tag.setAttribute('data-no996-version','1');
        tag.textContent='兼容 OpenFilm '+(globalThis.__no996OpenfilmVersion||'0.3.2');
        tag.style.cssText='margin-top:6px;text-align:left;font-size:11px;color:#8a8a93';
        footerRow.appendChild(tag);
      }
    }catch(e){}
  }

  function watchVersion(){
    if(location.protocol==='dsh-app:')return;
    fetch('/__dsh/shell-version',{cache:'no-store',credentials:'same-origin'})
      .then(function(r){return r.ok?r.json():null;})
      .then(function(v){
        if(!v||!v.version)return;
        if(!loadedVersion){loadedVersion=v.version;return;}
        if(v.version===loadedVersion)return;
        loadedVersion=v.version;
        if(document.visibilityState!=='visible'){location.reload();return;}
        var btn=document.querySelector('[data-workbench-account] button[aria-label="刷新界面"]');
        if(btn){btn.style.background='rgba(59,130,246,.28)';btn.title='有新版本，点击刷新';}
      })
      .catch(function(){});
  }
  setTimeout(watchVersion,1200);
  setInterval(watchVersion,4000);
  setInterval(function(){disableExtras();tuneAbout();},700);
  addEventListener('resize',function(){ disableExtras(); tuneAbout(); });

  // Transcript files. The chat is a page on the editor origin, so it cannot do two
  // things a film conversation needs: draw a picture that lives in the project (the
  // browser asks /projects/... and Studio does not serve it) and open a product file
  // a person clicks (the link is offered to the system browser, which has no panel
  // session, so the proxy answers OF_SESSION_REQUIRED). Both become Host requests:
  // /__dsh/project-file serves one image from a verified project, /__dsh/open-file
  // hands the file to the operating system's default application.
  (function transcriptFiles(){
    var IMAGE=/[.](png|jpe?g|webp|gif|avif|bmp)$/i;
    var FILE=/[.](mp4|m4v|mov|mkv|webm|avi|mp3|wav|m4a|aac|flac|ogg|png|jpe?g|webp|gif|bmp|avif|svg|pdf|md|markdown|txt|csv|json|js|mjs|css|html|pptx|docx|xlsx|zip|srt|vtt)$/i;
    var upgradeTimer=null,toastTimer=null;

    function projectId(){
      var match=/^\/projects\/([A-Za-z0-9_-]{6,40})(?:\/|$)/.exec(location.pathname||'');
      return match?match[1]:'';
    }
    // A relative destination as written in the transcript, or ''. Anything with a
    // scheme, a leading slash or a parent segment is not ours to resolve.
    function relative(value){
      if(typeof value!=='string')return '';
      var text=value.trim();
      if(!text||text.length>400)return '';
      text=text.replace(/^<+/,'').replace(/>+$/,'').trim();
      if(!text||text.charAt(0)==='#'||text.charAt(0)==='/')return '';
      if(/^[a-z][a-z0-9+.-]*:/i.test(text))return '';
      try{ text=decodeURIComponent(text); }catch(e){ return ''; }
      text=text.replace(/\\/g,'/').replace(/^[.]\//,'');
      if(!text||text.length>400||text.indexOf('\0')>=0)return '';
      if(/^[A-Za-z]:/.test(text)||text.charAt(0)==='/')return '';
      var parts=text.split('/');
      for(var i=0;i<parts.length;i++){
        if(!parts[i]||parts[i]==='.'||parts[i]==='..')return '';
      }
      return text;
    }
    // The same, from an attribute the browser may already have resolved.
    function fromAttribute(value){
      var text=String(value||'');
      if(/^https?:/i.test(text)){
        var url;
        try{ url=new URL(text); }catch(e){ return ''; }
        if(url.origin!==location.origin)return '';
        text=url.pathname;
      }
      if(text.indexOf('/projects/')===0){
        try{ text=decodeURIComponent(text.slice('/projects/'.length)); }catch(e){ return ''; }
      }
      return relative(text);
    }
    function imageUrl(pid,rel){
      return '/__dsh/project-file?projectId='+encodeURIComponent(pid)+'&path='+encodeURIComponent(rel);
    }
    function nameOf(rel){
      var parts=String(rel).split('/');
      return parts[parts.length-1]||rel;
    }
    function toast(message){
      var box=document.getElementById('no996-file-toast');
      if(!box){
        box=document.createElement('div');
        box.id='no996-file-toast';
        box.setAttribute('role','status');
        box.setAttribute('aria-live','polite');
        box.style.cssText='position:fixed;right:16px;bottom:72px;z-index:2147483000;display:none;max-width:320px;padding:9px 14px;border:1px solid rgba(255,255,255,.14);border-radius:8px;background:rgba(30,30,32,.96);color:#f1eee8;font:12.5px/1.5 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.45)';
        document.documentElement.appendChild(box);
      }
      box.textContent=message;
      box.style.display='block';
      clearTimeout(toastTimer);
      toastTimer=setTimeout(function(){ box.style.display='none'; },3200);
    }
    function openNative(pid,rel,reveal){
      toast(reveal?'正在文件夹中定位…':'正在用默认应用打开…');
      fetch('/__dsh/open-file',{
        method:'POST',credentials:'same-origin',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({projectId:pid,path:rel,reveal:reveal===true}),
      }).then(function(r){
        if(!r.ok)throw new Error('HTTP '+r.status);
        toast(reveal?'已在文件夹中定位':'已交给默认应用打开');
      }).catch(function(){
        toast('这个文件没能打开：'+nameOf(rel));
      });
    }
    var lightbox=null;
    function closeLightbox(){
      if(!lightbox)return;
      var previous=lightbox.previous;
      lightbox.root.parentNode&&lightbox.root.parentNode.removeChild(lightbox.root);
      lightbox=null;
      try{ if(previous&&previous.focus)previous.focus(); }catch(e){}
    }
    function showLightbox(pid,rel){
      closeLightbox();
      var name=nameOf(rel);
      var root=document.createElement('div');
      root.setAttribute('role','dialog');
      root.setAttribute('aria-modal','true');
      root.setAttribute('aria-label','大图：'+name);
      root.style.cssText='position:fixed;inset:0;z-index:2147483003;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;background:rgba(8,8,10,.9)';
      var picture=document.createElement('img');
      picture.src=imageUrl(pid,rel);
      picture.alt=name;
      picture.style.cssText='max-width:94vw;max-height:82vh;object-fit:contain;border-radius:8px;background:#111';
      var bar=document.createElement('div');
      bar.style.cssText='display:flex;flex-wrap:wrap;gap:8px;justify-content:center';
      function action(label,handler){
        var button=document.createElement('button');
        button.type='button';
        button.textContent=label;
        button.style.cssText='padding:7px 14px;border:1px solid #555;border-radius:7px;background:#2a2a2d;color:#f1eee8;font:13px system-ui,sans-serif;cursor:pointer';
        button.addEventListener('click',handler);
        bar.appendChild(button);
        return button;
      }
      action('用默认应用打开',function(){ openNative(pid,rel,false); });
      action('在文件夹中显示',function(){ openNative(pid,rel,true); });
      var close=action('关闭',closeLightbox);
      root.appendChild(picture);
      root.appendChild(bar);
      root.addEventListener('click',function(event){ if(event.target===root)closeLightbox(); });
      document.documentElement.appendChild(root);
      lightbox={root:root,previous:document.activeElement};
      try{ close.focus(); }catch(e){}
    }
    // A picture written as a link (markdown with alt text) is drawn beside it, and
    // the original link stays as the fallback when the Host cannot read the file.
    function drawPicture(anchor,pid,rel){
      anchor.setAttribute('data-no996-picture','1');
      var name=nameOf(rel);
      var button=document.createElement('button');
      button.type='button';
      button.setAttribute('data-no996-picture-btn','1');
      button.setAttribute('aria-label','查看大图：'+name);
      button.style.cssText='display:block;max-width:100%;margin:8px 0;padding:0;border:0;background:none;text-align:left;cursor:zoom-in';
      var picture=document.createElement('img');
      picture.src=imageUrl(pid,rel);
      picture.alt=name;
      picture.loading='lazy';
      picture.style.cssText='display:block;max-width:100%;max-height:420px;width:auto;border:1px solid rgba(255,255,255,.14);border-radius:6px';
      picture.addEventListener('error',function(){
        if(button.parentNode)button.parentNode.removeChild(button);
        anchor.removeAttribute('data-no996-picture');
      });
      picture.addEventListener('load',function(){
        anchor.style.display='none';
        anchor.setAttribute('data-no996-picture','shown');
      });
      button.appendChild(picture);
      button.addEventListener('click',function(){ showLightbox(pid,rel); });
      if(anchor.parentNode)anchor.parentNode.insertBefore(button,anchor.nextSibling);
    }
    function upgrade(){
      var pid=projectId();
      if(!pid)return;
      var links;
      try{ links=document.querySelectorAll('a[href]'); }catch(e){ return; }
      // Bounded: a transcript page is not a directory listing.
      for(var i=0;i<links.length&&i<300;i++){
        var anchor=links[i];
        if(anchor.querySelector&&anchor.querySelector('img'))continue;
        var rel=fromAttribute(anchor.getAttribute('href'));
        if(!rel||!IMAGE.test(rel))continue;
        // The picture is a sibling of the link, not inside it: an upstream re-render
        // can drop the sibling while the link survives, so a marker alone is not
        // enough to call this done.
        var sibling=anchor.nextElementSibling;
        var drawn=!!(sibling&&sibling.getAttribute&&sibling.getAttribute('data-no996-picture-btn')==='1');
        if(anchor.getAttribute('data-no996-picture')==='1'&&!drawn){
          anchor.removeAttribute('data-no996-picture');
          try{ anchor.style.display=''; }catch(e){}
        }
        if(anchor.getAttribute('data-no996-picture')==='1')continue;
        drawPicture(anchor,pid,rel);
      }
      var images;
      try{ images=document.querySelectorAll('img[src]'); }catch(e){ return; }
      for(var j=0;j<images.length&&j<300;j++){
        var picture=images[j];
        if(picture.getAttribute('data-no996-src'))continue;
        var src=picture.getAttribute('src')||'';
        if(src.indexOf('/__dsh/project-file')===0)continue;
        var own=fromAttribute(src);
        if(!own||!IMAGE.test(own))continue;
        picture.setAttribute('data-no996-src',own);
        picture.setAttribute('src',imageUrl(pid,own));
      }
    }
    function schedule(){
      if(upgradeTimer)return;
      upgradeTimer=setTimeout(function(){ upgradeTimer=null; try{ upgrade(); }catch(e){} },350);
    }
    // Clicking a product in the transcript opens it with the owner's own tools, not
    // in a browser tab the proxy will refuse.
    document.addEventListener('click',function(event){
      var target=event.target;
      var anchor=target&&target.closest?target.closest('a[href]'):null;
      if(!anchor)return;
      var pid=projectId();
      if(!pid)return;
      var rel=fromAttribute(anchor.getAttribute('href'));
      if(!rel)return;
      if(anchor.getAttribute('data-no996-picture')==='1'&&IMAGE.test(rel))return;
      if(!FILE.test(rel))return;
      event.preventDefault();
      if(event.stopPropagation)event.stopPropagation();
      if(IMAGE.test(rel)){ showLightbox(pid,rel); return; }
      openNative(pid,rel,event.shiftKey===true||event.altKey===true);
    },true);
    document.addEventListener('keydown',function(event){
      if(event.key==='Escape'&&lightbox)closeLightbox();
    });
    try{
      new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
    }catch(e){}
    setTimeout(upgrade,900);
    setInterval(function(){ try{ upgrade(); }catch(e){} },2500);
  })();
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

  // ---- 首次启动向导 ---------------------------------------------------------
  // 只在 prefs.onboardingCompleted !== true 时出现：
  //   第 1 步：检查 ffmpeg/ffprobe 与转写模型，缺的自动装（模型走已有 /asr 路由）；
  //   第 2 步：选片型（含空白项目），建完直接进编辑器。
  // 正常启动不检查、不弹，避免每次进工作台都被打扰。
  (function firstRun(){
    if(globalThis.__no996FirstRun)return; globalThis.__no996FirstRun=1;
    var overlay=null,hiddenPicker=null,poll=null,asr=null,env=null,step=1,templates=null,choice='',busy=false;
    var ratio='16:9',seconds=30,language='中文';

    function el(tag,css,text){var n=document.createElement(tag);if(css)n.style.cssText=css;if(text!=null)n.textContent=text;return n;}
    function pickerNode(){
      var all=document.querySelectorAll('div,section');
      for(var i=0;i<all.length;i++){
        var n=all[i];
        if(n.children.length<14&&n.textContent&&n.textContent.indexOf('你想剪哪种视频')>=0){
          var top=n;
          while(top.parentElement&&getComputedStyle(top).position!=='fixed')top=top.parentElement;
          // 只在确实是浮层时才藏整层；否则退回藏这张卡片，绝不能把 <html> 藏掉。
          return getComputedStyle(top).position==='fixed'?top:n;
        }
      }
      return null;
    }
    function hidePicker(){ hiddenPicker=pickerNode(); if(hiddenPicker)hiddenPicker.style.visibility='hidden'; }
    function showPicker(){ if(hiddenPicker){hiddenPicker.style.visibility='';hiddenPicker=null;} }
    function close(){ if(poll){clearInterval(poll);poll=null;} if(overlay&&overlay.parentElement)overlay.parentElement.removeChild(overlay); overlay=null; }

    function row(name,detail,status,action){
      var line=el('div','display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px dashed rgba(24,23,28,.18)');
      var mark=el('span','width:22px;height:22px;border-radius:50%;flex:0 0 auto;display:grid;place-items:center;font:700 13px/1 system-ui;background:'+(status==='ok'?'#1f8a4c;color:#fff':status==='bad'?'#a33a2a;color:#fff':'#d9cfbc;color:#6d6a62'),status==='ok'?'✓':status==='bad'?'!':'…');
      var box=el('div','flex:1 1 auto;min-width:0');
      box.appendChild(el('div','font:600 14px/1.4 system-ui,sans-serif;color:#18171c',name));
      if(detail)box.appendChild(el('div','font:400 12px/1.6 system-ui,sans-serif;color:#6d6a62;word-break:break-word',detail));
      line.appendChild(mark);line.appendChild(box);
      if(action){action.style.marginLeft='auto';line.appendChild(action);}
      return line;
    }
    function button(label,kind){
      var b=el('button','border:0;border-radius:4px;padding:9px 16px;font:600 13px/1 system-ui,sans-serif;cursor:pointer;'+(kind==='ghost'?'background:transparent;color:#6d6a62;border:1px solid rgba(24,23,28,.22)':kind==='dark'?'background:#18171c;color:#fff':kind==='warn'?'background:#ff6400;color:#fff':'background:#e8e0cf;color:#18171c'),label);
      b.type='button';
      return b;
    }

    function panel(){
      if(overlay)return overlay;
      var mask=el('div','position:fixed;inset:0;z-index:2147482400;display:flex;align-items:center;justify-content:center;padding:24px;background:linear-gradient(180deg,#05060f 0%,#0b1a33 55%,#241a12 100%);overflow:auto');
      var card=el('div','position:relative;width:min(100%,720px);background:linear-gradient(160deg,#f5f0e5,#ebe4d2);color:#18171c;border-radius:4px;box-shadow:0 0 0 1px rgba(255,100,0,.25),0 30px 70px rgba(0,0,0,.55);padding:26px 30px 22px');
      var tape=el('div','position:absolute;top:-10px;left:-14px;width:86px;height:22px;transform:rotate(-8deg);background:repeating-linear-gradient(135deg,rgba(255,255,255,.3) 0 4px,transparent 4px 9px),rgba(255,100,0,.9)');
      card.appendChild(tape);
      card.appendChild(el('div','font:500 12px/1.4 ui-monospace,monospace;letter-spacing:.18em;color:#ff6400','OPENFILM · 首次启动'));
      card.appendChild(el('h1','margin:6px 0 4px;font:700 26px/1.25 "Noto Sans SC","Microsoft YaHei",sans-serif','先把工具装齐，再开工'));
      card.appendChild(el('p','margin:0 0 16px;font:400 13px/1.7 system-ui,sans-serif;color:#6d6a62','这一步只做一次。缺的组件我直接装；装完再选片型。'));
      var body=el('div');card.appendChild(body);
      var foot=el('div','display:flex;gap:10px;align-items:center;justify-content:flex-end;flex-wrap:wrap;margin-top:18px');card.appendChild(foot);
      mask.appendChild(card);document.documentElement.appendChild(mask);
      overlay=mask;
      return mask;
    }

    var envRefs=null;
    function envRow(label){
      var line=el('div','display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px dashed rgba(24,23,28,.18)');
      var mark=el('span','width:22px;height:22px;border-radius:50%;flex:0 0 auto;display:grid;place-items:center;font:700 13px/1 system-ui;background:#d9cfbc;color:#6d6a62','…');
      var box=el('div','flex:1 1 auto;min-width:0');
      box.appendChild(el('div','font:600 14px/1.4 system-ui,sans-serif;color:#18171c',label));
      var detail=el('div','font:400 12px/1.6 system-ui,sans-serif;color:#6d6a62;word-break:break-word','');
      box.appendChild(detail);
      line.appendChild(mark);line.appendChild(box);
      return {line:line,mark:mark,detail:detail};
    }
    function applyRow(ref,info){
      ref.detail.textContent=info.text;
      ref.mark.textContent=info.state==='ok'?'✓':info.state==='bad'?'!':'…';
      ref.mark.style.background=info.state==='ok'?'#1f8a4c':info.state==='bad'?'#a33a2a':'#d9cfbc';
      ref.mark.style.color=info.state==='ok'||info.state==='bad'?'#fff':'#6d6a62';
    }
    function fmtBytes(n){
      n=Number(n)||0;
      if(n>=1048576)return (n/1048576).toFixed(n>=10485760?0:1)+' MB';
      if(n>=1024)return Math.round(n/1024)+' KB';
      return n+' B';
    }
    function fmtSpeed(n){
      n=Number(n)||0;
      if(n<=0)return '连接中';
      if(n>=1048576)return (n/1048576).toFixed(1)+' MB/s';
      return Math.max(1,Math.round(n/1024))+' KB/s';
    }
    function toolDetail(tool){
      var system=env||{}, tools=system.tools||{}, installed=(system.installer&&system.installer.tools)||{};
      var info=installed[tool]||{}, probe=tools[tool]||{status:'timeout'};
      if(probe.status==='ok')return {text:info.source==='system'?'已就绪（系统安装）':'已就绪',state:'ok'};
      if(info.installing){
        if(info.phase==='connecting')return {text:'正在连接下载源（'+(info.sourceId||'npmmirror')+'）…',state:'busy'};
        if(info.phase==='verifying')return {text:'正在校验下载…',state:'busy'};
        return {text:'正在下载 '+fmtBytes(info.received)+' / '+fmtBytes(info.total)+' · '+fmtSpeed(info.speed)+'（源：'+(info.sourceId||'?')+'）',state:'busy'};
      }
      if(info.error)return {text:'下载失败：'+info.error,state:'bad'};
      return {text:probe.status==='missing'?'没有找到 '+tool:'已安装但无法运行',state:'bad'};
    }
    function asrDetail(){
      var asr=(env&&env.asr)||{};
      if(asr.ready===true)return {text:'已就绪',state:'ok'};
      if(asr.unknown)return {text:'插件重载后确认',state:'busy'};
      if(asr.installing){
        if(asr.phase==='connecting')return {text:'正在连接下载源（'+(asr.source||'hf-mirror')+'）…',state:'busy'};
        return {text:'正在下载 '+Math.round((asr.progress||0)*100)+'% · '+fmtSpeed(asr.speed)+'（源：'+(asr.source||'?')+'）',state:'busy'};
      }
      if(asr.error)return {text:'下载失败：'+asr.error,state:'bad'};
      if(asr.bytesOnDisk)return {text:fmtBytes(asr.bytesOnDisk)+' / '+fmtBytes(asr.bytesTotal),state:'busy'};
      return {text:'未下载（约 228 MB）',state:'bad'};
    }
    // 只建一次 DOM，轮询改文字：否则每 1.5 秒重建按钮，点击会被从指下抽走。
    function updateEnv(){
      if(!envRefs)return;
      applyRow(envRefs.ff,toolDetail('ffmpeg'));
      applyRow(envRefs.fp,toolDetail('ffprobe'));
      applyRow(envRefs.asr,asrDetail());
      var ready=readyToPick(env);
      envRefs.next.textContent=ready?'选片型':'等装完再继续';
      envRefs.hint.style.display=ready?'none':'';
      envRefs.install.style.display=ready?'none':'';
      envRefs.guide.style.display=ready?'none':'';
    }
    function renderEnv(){
      var card=panel().firstChild, body=card.children[4], foot=card.children[5];
      step=1;
      card.children[1].textContent='OPENFILM · 首次启动 · 1/2';
      card.children[2].textContent='先把工具装齐，再开工';
      if(envRefs){updateEnv();return;}
      body.textContent='';foot.textContent='';
      envRefs={};
      envRefs.ff=envRow('FFmpeg · 视频解码与导出');
      envRefs.fp=envRow('ffprobe · 时长与格式探测');
      envRefs.asr=envRow('口播转写模型 · SenseVoice');
      body.appendChild(envRefs.ff.line);
      body.appendChild(envRefs.fp.line);
      body.appendChild(envRefs.asr.line);
      envRefs.hint=el('p','margin:10px 0 0;font:400 12px/1.7 system-ui,sans-serif;color:#6d6a62','缺的组件会直接下：ffmpeg/ffprobe 约 115 MB，转写模型约 228 MB。默认走国内镜像（npmmirror / hf-mirror），失败会自动换源；全程显示速度与来源，装不动就点「重试」。');
      body.appendChild(envRefs.hint);
      envRefs.next=button('等装完再继续','dark');
      envRefs.next.addEventListener('click',async function(){
        env=await probeSystem();
        if(readyToPick(env))renderTemplates(); else updateEnv();
      });
      envRefs.skip=button('以后再说','ghost');
      envRefs.skip.addEventListener('click',function(){ try{sessionStorage.setItem('no996.onboard.skip','1');}catch(e){} close(); showPicker(); });
      envRefs.guide=guideButton();
      envRefs.install=installButton();
      // 次要动作靠左、主动作最右，整排贴右下角。
      foot.appendChild(envRefs.skip);
      foot.appendChild(envRefs.guide);
      foot.appendChild(envRefs.install);
      foot.appendChild(envRefs.next);
      updateEnv();
    }
    function readyToPick(system){
      var tools=(system&&system.tools)||{};
      return tools.ffmpeg&&tools.ffmpeg.status==='ok'&&tools.ffprobe&&tools.ffprobe.status==='ok'&&system.asr&&system.asr.ready===true;
    }
    function installButton(){
      var b=button('重试安装','ghost');
      b.addEventListener('click',async function(){
        b.disabled=true;b.textContent='正在连接…';
        try{
          await rpc('system:install',{tool:'all'});
          var asr=env&&env.asr;
          if(asr&&asr.ready!==true&&asr.unknown!==true)await rpc('asr:install',{});
        }catch(e){
          b.disabled=false;b.textContent='重试安装';
          return;
        }
        env=await probeSystem();
        if(overlay)renderEnv();
        // The button is hidden once everything is ready; otherwise it must come
        // back usable, or a slow download leaves it stuck on "正在开始…".
        b.disabled=false;b.textContent='重试安装';
      });
      return b;
    }
    function guideButton(){
      var b=button('安装方法','ghost');
      b.addEventListener('click',function(){ if(window.__no996CheckTools)window.__no996CheckTools(); });
      return b;
    }

    function renderTemplates(){
      step=2;
      var card=panel().firstChild, body=card.children[4], foot=card.children[5];
      body.textContent='';foot.textContent='';
      card.children[1].textContent='OPENFILM · 首次启动 · 2/2';
      card.children[2].textContent='你想剪哪种视频？';
      card.children[3].textContent='选一个片型，建好项目就能开工；素材直接拖进对话。';
      var grid=el('div','display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px');
      var list=(templates&&templates.templates)||[];
      if(!choice&&list.length)choice=list[0].id;
      list.forEach(function(t){
        var c=el('button','text-align:left;border:1px solid '+(choice===t.id?'#18171c':'rgba(24,23,28,.18)')+';border-radius:4px;padding:12px;background:'+(choice===t.id?'#fff':'rgba(255,255,255,.45)')+';cursor:pointer;font:inherit');
        c.type='button';
        c.appendChild(el('div','font:600 14px/1.4 system-ui,sans-serif;color:#18171c',(choice===t.id?'✓ ':'')+(t.productTitle||t.title)));
        c.appendChild(el('div','margin-top:4px;font:400 12px/1.5 system-ui,sans-serif;color:#6d6a62',t.productBlurb||t.description||''));
        c.addEventListener('click',function(){choice=t.id;renderTemplates();});
        grid.appendChild(c);
      });
      body.appendChild(grid);
      if(choice==='custom'){
        var opts=el('div','margin:12px 0 0;display:flex;flex-direction:column;gap:8px');
        function seg(label,values,current,onPick){
          var line=el('div','display:flex;align-items:center;gap:8px');
          line.appendChild(el('span','flex:0 0 64px;font:400 12px/1.6 system-ui,sans-serif;color:#6d6a62',label));
          values.forEach(function(v){
            var b=button(String(v),current===v?'dark':'ghost');
            b.style.padding='6px 12px';
            b.addEventListener('click',function(){onPick(v);renderTemplates();});
            line.appendChild(b);
          });
          opts.appendChild(line);
        }
        seg('画布',['16:9','9:16','1:1'],ratio,function(v){ratio=v;});
        seg('时长',[15,30,60],seconds,function(v){seconds=v;});
        seg('语言',['中文','English'],language,function(v){language=v;});
        body.appendChild(opts);
        body.appendChild(el('p','margin:8px 0 0;font:400 12px/1.7 system-ui,sans-serif;color:#6d6a62','先建空白项目；这三个选择会记住，下次不用再选。'));
      }
      var create=button(busy?'正在建项目…':'用这个开工','dark');
      create.disabled=busy;
      create.addEventListener('click',async function(){
        if(busy||!choice)return;
        busy=true;renderTemplates();
        try{
          var res=await rpc(choice==='custom'?'project:create-blank':'template:create',choice==='custom'?{ratio:ratio,seconds:seconds,language:language}:{templateId:choice});
          var id=res&&typeof res.projectId==='string'?res.projectId:'';
          if(!/^[A-Za-z0-9_-]{6,40}$/.test(id))throw new Error('Studio 没有返回项目地址');
          try{ if(res.onboarding)localStorage.setItem('no996.openfilm.onboarding',JSON.stringify(res.onboarding).slice(0,1200)); }catch(e){}
          close();
          location.assign('/projects/'+id);
        }catch(error){
          busy=false;
          var p=el('p','margin:10px 0 0;font:400 12px/1.7 system-ui,sans-serif;color:#a33a2a',String(error&&error.message||error).slice(0,160));
          body.appendChild(p);
          renderTemplates();
        }
      });
      var back=button('上一步','ghost');
      back.addEventListener('click',function(){renderEnv();});
      foot.appendChild(back);
      foot.appendChild(create);
    }

    async function probeSystem(){
      try{ return await rpc('system:check',{}); }
      catch(e){
        // Old Host without the system channels: answer what we can, and never
        // guess that the transcription model is missing.
        var base={platform:'',tools:{},installer:{tools:{}},asr:{ready:false,unknown:true},ready:false};
        try{ var checked=await rpc('environment:check',{}); base.platform=checked&&checked.platform||''; base.tools=(checked&&checked.tools)||{}; }catch(e2){}
        return base;
      }
    }
    function pollSystem(){
      if(poll)return;
      poll=setInterval(function(){
        if(!overlay)return;
        probeSystem().then(function(state){ env=state; if(step===1)renderEnv(); }).catch(function(){});
      },1500);
    }

    async function boot(){
      var status=null;
      try{ status=await rpc('auth:status',{}); }catch(e){}
      if(!status||status.loggedIn!==true){
        window.addEventListener('no996-auth-changed',function(ev){ if(ev&&ev.detail&&ev.detail.loggedIn){boot();} },{once:true});
        return;
      }
      try{
        var prefs=(await rpc('prefs:get',{})).prefs||{};
        if(prefs.onboardingCompleted===true)return;
        if(prefs.customRatio)ratio=prefs.customRatio;
        if(prefs.customSeconds)seconds=prefs.customSeconds;
        if(prefs.customLanguage)language=prefs.customLanguage;
        if(sessionStorage.getItem('no996.onboard.skip')==='1')return;
      }catch(e){return;}
      env=await probeSystem();
      var tools=env.tools||{}, asrState=env.asr||{};
      var ff=tools.ffmpeg&&tools.ffmpeg.status==='ok';
      var fp=tools.ffprobe&&tools.ffprobe.status==='ok';
      if(ff&&fp&&asrState.ready===true)return;      // 环境齐了：交给原来的片型页
      hidePicker();
      renderEnv();
      if(!ff||!fp)rpc('system:install',{tool:'all'}).catch(function(){});
      if(asrState.ready!==true&&asrState.unknown!==true)rpc('asr:install',{}).catch(function(){});
      pollSystem();
      try{ templates=await rpc('template:list',{}); }catch(e){ templates={templates:[]}; }
    }
    setTimeout(boot,1200);
  })();

})()

