/* Read-only private Git commit audit: no external WebView networking. */
(function(){
 "use strict";
 const $=id=>document.getElementById(id);
 const root=$("gitLogList"),status=$("gitLogStatus"),refreshButton=$("refreshGitLog");
 let inFlight=false,loaded=false;
 const labels={added:"新增文件",modified:"修改文件",removed:"删除文件",renamed:"重命名",copied:"复制",changed:"修改"};
 function refresh(){
  if(inFlight)return;
  if(!state.connected){status.textContent="请先在连接页面授权私有 GitHub 仓库";return}
  if(!window.BodyTraceNative?.readGitLog){
   status.textContent="当前 APK 尚不支持 Git log，请更新 APP";return;
  }
  inFlight=true;
  status.textContent="正在读取最近10次提交与文件差异…";
  refreshButton.disabled=true;
  BodyTraceNative.readGitLog();
 }
 function item(tag,text,className){
  const node=document.createElement(tag);
  if(className)node.className=className;
  node.textContent=text;
  return node;
 }
 function render(list){
  root.replaceChildren();
  if(!Array.isArray(list)||!list.length){
   status.textContent="此仓库没有可显示的 Git 提交";return;
  }
  status.textContent="已读取私有仓库 z2846852/- 最近 "+list.length+" 次提交";
  for(const commit of list){
   const card=item("section","","raw-note");
   const header=item("div","","row wrap");
   const title=item("strong",commit.message||"（无提交说明）");
   title.style.cssText="font-size:12px;overflow-wrap:anywhere;flex:1";
   const shortId=item("span",String(commit.sha||"").slice(0,8),"tag");
   header.append(title,shortId);card.append(header);
   const timestamp=commit.date?new Date(commit.date):null;
   const date=timestamp&&!isNaN(timestamp.getTime())
    ?timestamp.toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",hour12:false})
    :"时间未知";
   card.append(item("p",date,"sub"));
   if(commit.detail_error){
    card.append(item("p","文件明细加载失败，不能判断本次增删改。","sub"));
    root.append(card);continue;
   }
   const files=Array.isArray(commit.files)?commit.files:[];
   const counts={added:0,modified:0,removed:0,renamed:0};
   for(const file of files){
    if(Object.prototype.hasOwnProperty.call(counts,file.status))counts[file.status]++;
   }
   const sum="新增文件 "+counts.added+" / 修改文件 "+counts.modified+
    " / 删除文件 "+counts.removed+" / 重命名 "+counts.renamed+
    " · 行变更 +"+(commit.additions||0)+" / -"+(commit.deletions||0);
   card.append(item("p",sum,"sub"));
   const details=document.createElement("details");
   details.append(item("summary","展开文件及 Git diff（"+files.length+"项）"));
   for(const file of files){
    const part=document.createElement("details");
    part.style.cssText="padding:8px 0;border-top:1px solid #2a4140";
    const summary=(labels[file.status]||file.status||"更改")+" · "+
      (file.filename||"未知文件")+"  (+"+(file.additions||0)+"/-"+(file.deletions||0)+")";
    const head=item("summary",summary);
    head.style.cssText="font-size:11px;overflow-wrap:anywhere";
    part.append(head);
    const patch=item("pre",file.patch||"GitHub 未提供文本 diff；可能是二进制或较大的更改。");
    patch.style.cssText="font-size:10px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;overflow:auto;max-height:320px;color:#c9e8d5";
    part.append(patch);
    details.append(part);
   }
   if(commit.incomplete)details.append(item("p","此提交的文件列表可能不完整。请到 GitHub 核实。","sub"));
   card.append(details);root.append(card);
  }
 }
 refreshButton.addEventListener("click",refresh);
 const settingsTab=document.querySelector('.tabs button[data-page="settings"]');
 if(settingsTab)settingsTab.addEventListener("click",()=>{if(!loaded&&!inFlight)refresh()});
 const previous=window.bodyTraceReceive;
 window.bodyTraceReceive=function(event){
  if(typeof previous==="function")previous(event);
  if(!event)return;
  if(event.type==="git_log"){
   inFlight=false;loaded=true;refreshButton.disabled=false;
   render(event.commits);
  }else if(event.type==="git_log_error"){
   inFlight=false;refreshButton.disabled=false;
   status.textContent="读取 Git log 失败："+(event.message||"未知错误");
  }else if(event.type==="disconnected"){
   inFlight=false;loaded=false;refreshButton.disabled=false;
   root.replaceChildren();status.textContent="已解除授权；Git log 需要连接私有仓库";
  }
 };
})();
