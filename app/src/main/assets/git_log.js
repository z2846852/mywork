/* Read-only GitHub commit audit. Render text, never interpret a diff as HTML. */
(function(){
 "use strict";
 const $=id=>document.getElementById(id);
 const root=$("gitLogList"),status=$("gitLogStatus"),refreshButton=$("refreshGitLog");
 let inFlight=false;
 const labels={added:"新增文件",modified:"修改文件",removed:"删除文件",renamed:"重命名",copied:"复制",changed:"修改"};
 function refresh(){
  if(inFlight)return;
  if(!state.connected){status.textContent="请先在本页底部授权 GitHub 私有仓库";return}
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
 // Unified diff: additions and deletions keep their +/- prefixes and get
 // Gerrit-like full-row backgrounds. Diff text is always assigned via textContent.
 function diffLineClass(line){
  if(line.startsWith("@@"))return "git-diff-hunk";
  if(line.startsWith("+++")||line.startsWith("---")||
     line.startsWith("diff --git ")||line.startsWith("index ")||
     line.startsWith("\\ No newline at end of file"))return "git-diff-meta";
  if(line.startsWith("+"))return "git-diff-added";
  if(line.startsWith("-"))return "git-diff-removed";
  return "git-diff-context";
 }
 function renderPatch(file){
  const diff=item("div","","git-diff");
  if(!file.patch){
   diff.append(item("div","GitHub 未提供文本 diff（可能是二进制文件或过大的变更）。","git-diff-unavailable"));
   return diff;
  }
  for(const line of String(file.patch).split(/\r?\n/)){
   diff.append(item("div",line,"git-diff-line "+diffLineClass(line)));
  }
  if(file.patch_truncated){
   diff.append(item("div","… APP 为避免过大响应而截断此 diff，请到 GitHub 查看完整版本。","git-diff-unavailable"));
  }
  return diff;
 }
 function render(list){
  root.replaceChildren();
  if(!Array.isArray(list)||!list.length){
   status.textContent="此仓库没有可显示的 Git 提交";return;
  }
  status.textContent="已读取私有仓库 z2846852/- 最近 "+list.length+" 次提交";
  for(const commit of list){
   const card=item("section","","raw-note git-commit");
   const header=item("div","","row wrap");
   const title=item("strong",commit.message||"（无提交说明）");
   title.className="git-commit-message";
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
   card.append(item("p",sum,"sub git-commit-summary"));
   if(!files.length)card.append(item("p","本次提交没有可显示的文件差异。","sub"));
   for(const file of files){
    const part=item("section","","git-commit-file");
    const summary=(labels[file.status]||file.status||"更改")+" · "+
      (file.filename||"未知文件")+"  (+"+(file.additions||0)+"/-"+(file.deletions||0)+")";
    part.append(item("div",summary,"git-file-header"));
    part.append(renderPatch(file));
    card.append(part);
   }
   if(commit.incomplete)card.append(item("p","此提交的文件列表可能不完整，请到 GitHub 核实。","sub"));
   root.append(card);
  }
 }
 refreshButton.addEventListener("click",refresh);
 // Git log requests are strictly user-initiated via the Refresh button.
 const previous=window.bodyTraceReceive;
 window.bodyTraceReceive=function(event){
  if(typeof previous==="function")previous(event);
  if(!event)return;
  if(event.type==="git_log"){
   inFlight=false;refreshButton.disabled=false;
   render(event.commits);
  }else if(event.type==="git_log_error"){
   inFlight=false;refreshButton.disabled=false;
   status.textContent="读取 Git log 失败："+(event.message||"未知错误");
  }else if(event.type==="disconnected"){
   inFlight=false;refreshButton.disabled=false;
   root.replaceChildren();status.textContent="已解除授权；请在本页底部连接 GitHub";
  }
 };
})();
