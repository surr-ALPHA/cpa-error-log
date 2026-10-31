import {openDB,allCards,getCard,putCard,removeCard,sha256,dueDateIn,isDue,dateLabel,rateCard,INTERVALS} from './store.js';
import {makeBackup,loadBackup,restoreCards} from './backup.js';
const main=document.getElementById('content');
const subjects=['재무회계','원가관리회계','세법','재무관리','회계감사','기타'];
const errorTypes=['조건 누락','개념·기준 오류','풀이 절차 오류','계산 실수','시간 부족','기타'];
let tab='dashboard', cards=[],pendingFile=null, pendingPreviewURL=null, displayURLs=[], editingId=null, detailId=null, reviewIds=null, reviewReveal=false, restoring=null,filter={q:'',subject:'전체',due:false};
let toastTimer;
const esc=s=>String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const fmtSize=n=>n<1024*1024?`${(n/1024).toFixed(0)} KB`:`${(n/1024/1024).toFixed(1)} MB`;
const nowISO=()=>new Date().toISOString();
const uniqueId=()=>crypto.randomUUID?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16))).map(v=>v.toString(16).padStart(2,'0')).join('');
function toast(s){const el=document.getElementById('toast');el.textContent=s;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),4500)}
function freeURLs(){displayURLs.forEach(url=>URL.revokeObjectURL(url));displayURLs=[]}
function fileURL(blob){const url=URL.createObjectURL(blob);displayURLs.push(url);return url}
function pageHeader(label,title,subtitle,action=''){return `<div class="heading"><div><div class="eyebrow">${label}</div><h1>${title}</h1>${subtitle?`<p class="subtext">${subtitle}</p>`:''}</div>${action}</div>`}
function metric(label,value,extra=''){return `<div class="metric"><div class="metric-label">${label}</div><div class="metric-value">${value}</div>${extra?`<div class="tiny muted">${extra}</div>`:''}</div>`}
function item(card,showDue=true){return `<button class="item" data-open="${esc(card.id)}"><span><div class="item-title">${esc(card.title)}</div><div class="item-desc">${esc(card.subject)}${card.topic?' · '+esc(card.topic):''}<span class="sep">·</span>${esc(card.errorType||'미분류')}<span class="sep">·</span>${(card.attempts||[]).length}회 복습</div></span><span class="row">${showDue?`<span class="pill ${isDue(card)?'due':'ok'}">${isDue(card)?'복습 필요':dateLabel(card.dueAt)}</span>`:''}<span class="item-arrow">›</span></span></button>`}
function dateOrder(a,b){return new Date(a.dueAt)-new Date(b.dueAt)}
function setNav(){document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x.dataset.tab===tab));}
function setHTML(html){freeURLs();main.innerHTML=html;main.scrollTop=0;setNav()}
function nav(dest){if(dest==='detail'&&detailId){editingId=null;tab='detail';render();return}tab=dest;editingId=null;detailId=null;reviewIds=null;reviewReveal=false;pendingFile=null;if(pendingPreviewURL){URL.revokeObjectURL(pendingPreviewURL);pendingPreviewURL=null}render();window.scrollTo(0,0)}
function notifyError(err){console.error(err);toast('오류: '+(err?.message||err))}
async function render(){try{cards=await allCards();setNav();switch(tab){case'dashboard':return drawDashboard();case'add':return drawAdd();case'library':return drawLibrary();case'review':return drawReview();case'detail':return drawDetail();case'backup':return drawBackup();}}catch(e){notifyError(e);main.innerHTML=`<div class="card danger-box">저장소 접근에 실패했습니다. 비공개 모드인지 확인하고 새로고침하세요.<p class="small">${esc(e.message)}</p></div>`}}
function drawDashboard(){
 const due=cards.filter(isDue).sort(dateOrder),attempts=cards.flatMap(c=>c.attempts||[]),nCorrect=attempts.filter(x=>x.correct).length;
 const recent=[...cards].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,5);
 setHTML(`${pageHeader('OVERVIEW','학습 대시보드','모든 문제와 오답 원인은 이 기기의 웹앱 저장 공간에만 보관됩니다.','<button class="btn btn-accent" data-nav="add">+ 오답 기록</button>')}
 <div class="grid">${metric('저장한 오답',cards.length+'개')}${metric('오늘 복습',due.length+'개')}${metric('누적 재풀이 정답률',attempts.length?Math.round(nCorrect/attempts.length*100)+'%':'—')}</div>
 <div class="split section"><section class="card"><div class="row spread"><h2>복습할 문제</h2><button class="btn btn-compact" data-nav="review">복습 시작 →</button></div><div class="divider"></div>${due.length?`<div class="list">${due.slice(0,4).map(x=>item(x)).join('')}</div>`:'<div class="empty"><div class="icon">✓</div>오늘 복습할 문제가 없습니다.<br>새 오답은 등록 다음 날부터 복습 대상으로 나타납니다.</div>'}</section>
 <section class="card"><h2>등록 원칙</h2><div class="divider"></div><div class="stack small"><p><strong>① 원본 그대로</strong><br><span class="muted">문제는 이미지 바이트를 변형하지 않고 저장</span></p><p><strong>② 틀린 이유</strong><br><span class="muted">잘못된 판단과 올바른 교정 기준을 기록</span></p><p><strong>③ 답을 가리고</strong><br><span class="muted">다시 푼 다음 오답 원인을 공개</span></p><p><strong>④ 백업 습관</strong><br><span class="muted">앱 삭제·데이터 정리에 대비해 ZIP 백업</span></p></div></section></div>
 <section class="card section"><div class="row spread"><h2>최근 등록한 문제</h2><button class="btn btn-compact" data-nav="library">전체 보기 →</button></div><div class="divider"></div>${recent.length?`<div class="list">${recent.map(x=>item(x)).join('')}</div>`:'<div class="empty">아직 등록된 오답이 없습니다.<br>첫 문제의 이미지를 넣고 오답 원인을 기록하세요.<div class="top-gap"><button class="btn btn-accent" data-nav="add">첫 오답 등록</button></div></div>'}</section>`);
}
function imgPreview(file,existing=false){if(!file)return '';
 const url=fileURL(file), mime=file.type||'';
 return `<div class="preview-area"><div class="image-toolbar"><strong class="small">${existing?'보존된 원본':'등록할 원본'}</strong><span class="tiny muted">${fmtSize(file.size)} · ${esc(mime||'알 수 없음')}</span></div>${mime==='application/pdf'?`<iframe title="문제 PDF 미리보기" src="${url}"></iframe>`:`<img alt="원본 문제 이미지 미리보기" src="${url}">`}</div>`
}
function drawAdd(){const old=editingId?cards.find(c=>c.id===editingId):null;
 setHTML(`${pageHeader('CAPTURE',old?'오답 기록 수정':'오답 빠른 등록',old?'문제 원본 파일은 변경할 수 없습니다. 잘못된 원본은 별도 카드로 다시 등록하세요.':'이미지 붙여넣기 → 오류 원인 작성 → 저장. 원본 이미지는 다시 압축하지 않습니다.')}
 <form id="card-form" class="stack"><div class="card stack"><div class="row spread"><h2>1. 원본 문제</h2><span class="pill">필수</span></div>
 <div id="image-preview">${old?imgPreview(old.blob,true):pendingFile?imgPreview(pendingFile):`<div class="dropbox" id="drop"><strong>문제 이미지 또는 PDF를 여기에 놓으세요</strong><p>Noteful에서 스크린샷을 찍어 가져오거나, 단축어로 복사한 이미지를 붙여넣으세요.</p><div class="file-help"><button type="button" class="btn btn-primary" id="pick-file">파일 선택</button><button type="button" class="btn" id="paste-file">클립보드 이미지 가져오기</button></div><p>PNG, JPG, WEBP, PDF / 최대 35MB · PDF는 전체 페이지로 저장</p></div>`}</div>
 ${!old&&pendingFile?`<div class="row"><button class="btn btn-compact" type="button" id="change-file">다른 이미지 선택</button><button class="btn btn-compact" type="button" id="paste-file">클립보드로 교체</button></div>`:''}
 <input id="input-file" type="file" accept="image/png,image/jpeg,image/webp,application/pdf,.png,.jpg,.jpeg,.webp,.pdf" hidden>
 <p class="data-help">원본의 픽셀, 수식, 텍스트를 자동 수정하거나 OCR로 덮어쓰지 않습니다. 문제 영역을 자를 경우, 잘라낸 이미지가 원본으로 저장됩니다.</p></div>
 <div class="card stack"><h2>2. 틀린 이유와 교정 기준</h2><div class="form-grid">
 <div class="field"><label for="subject">과목</label><select id="subject" name="subject">${subjects.map(s=>`<option ${old?.subject===s?'selected':''}>${s}</option>`).join('')}</select></div>
 <div class="field"><label for="errorType">오류 유형</label><select id="errorType" name="errorType">${errorTypes.map(s=>`<option ${old?.errorType===s?'selected':''}>${s}</option>`).join('')}</select></div>
 <div class="field wide"><label for="title">문제 이름</label><input id="title" maxlength="120" placeholder="예: 2026년 2차 재무관리 1번" value="${esc(old?.title||'')}"></div>
 <div class="field"><label for="topic">단원 (선택)</label><input id="topic" maxlength="100" placeholder="예: 통화스왑" value="${esc(old?.topic||'')}"></div>
 <div class="field"><label for="source">출처/원본 페이지 (선택)</label><input id="source" maxlength="160" placeholder="예: 기출 2026 p.12" value="${esc(old?.source||'')}"></div>
 <div class="field wide"><label for="wrong" class="required">틀린 이유: 무엇을 잘못 판단했는가?</label><textarea id="wrong" maxlength="4000" required placeholder="예: 현금흐름의 통화별 할인율을 구분하지 않았다.">${esc(old?.wrong||'')}</textarea></div>
 <div class="field wide"><label for="correction" class="required">교정 기준: 다음에는 무엇을 확인할 것인가?</label><textarea id="correction" maxlength="4000" required placeholder="예: 지급 시점과 통화를 먼저 나누고 대응 할인율을 확인한다.">${esc(old?.correction||'')}</textarea></div></div>
 <div class="form-footer"><button class="btn" type="button" data-nav="${old?'detail':'dashboard'}">취소</button><button class="btn btn-accent" type="submit" id="save-card">${old?'수정 내용 저장':'원본과 오답 저장'}</button></div></div></form>`);
 const loaded=old?.blob||pendingFile;
 if(loaded){const view=document.querySelector('#image-preview img,#image-preview iframe');if(view)view.src=fileURL(loaded)}
 const inp=document.getElementById('input-file');
 document.getElementById('pick-file')?.addEventListener('click',()=>inp.click());
 document.getElementById('change-file')?.addEventListener('click',()=>inp.click());
 document.getElementById('paste-file')?.addEventListener('click',pasteClipboard);
 inp.addEventListener('change',e=>{if(e.target.files[0])selectFile(e.target.files[0])});
 const drop=document.getElementById('drop');if(drop){drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('over')});drop.addEventListener('dragleave',()=>drop.classList.remove('over'));drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('over');if(e.dataTransfer.files[0])selectFile(e.dataTransfer.files[0])})}
 document.getElementById('card-form').addEventListener('submit',saveCard);
}
async function sniff(file){const buf=new Uint8Array(await file.slice(0,16).arrayBuffer());let mime='';
 if(buf.length>=8&&buf.slice(0,8).every((x,i)=>x===[137,80,78,71,13,10,26,10][i]))mime='image/png';
 else if(buf[0]===255&&buf[1]===216&&buf[2]===255)mime='image/jpeg';
 else if(String.fromCharCode(...buf.slice(0,4))==='RIFF'&&String.fromCharCode(...buf.slice(8,12))==='WEBP')mime='image/webp';
 else if(String.fromCharCode(...buf.slice(0,5))==='%PDF-')mime='application/pdf';
 return mime;
}
async function selectFile(file){try{
 if(!file||file.size===0||file.size>35*1024*1024)throw new Error('0~35MB의 PNG/JPG/WEBP/PDF 파일만 등록할 수 있습니다.');
 const mime=await sniff(file);if(!mime)throw new Error('파일 내용이 지원하는 PNG/JPG/WEBP/PDF 형식이 아닙니다.');
 pendingFile=new File([file],file.name||`problem-${Date.now()}`,{type:mime});
 const el=document.getElementById('image-preview');if(!el)return;
 freeURLs();el.innerHTML=imgPreview(pendingFile);
 document.getElementById('drop')?.remove();
 if(!document.getElementById('change-file')){
  const row=document.createElement('div');row.className='row';row.innerHTML='<button class="btn btn-compact" type="button" id="change-file">다른 이미지 선택</button><button class="btn btn-compact" type="button" id="paste-file">클립보드로 교체</button>';
  el.after(row);row.querySelector('#change-file').addEventListener('click',()=>document.getElementById('input-file').click());row.querySelector('#paste-file').addEventListener('click',pasteClipboard);
 }
 toast('원본 이미지가 준비되었습니다. 저장 전에는 기기에 등록되지 않습니다.');
 }catch(e){notifyError(e)}}
async function pasteClipboard(){try{
 if(!navigator.clipboard?.read)throw new Error('이 실행 환경에서는 클립보드 이미지 읽기를 지원하지 않습니다. 파일 선택을 이용하세요.');
 const items=await navigator.clipboard.read();
 for(const item of items){for(const mime of ['image/png','image/jpeg','image/webp']){
  if(item.types.includes(mime)){const blob=await item.getType(mime);await selectFile(new File([blob],`clipboard-${Date.now()}.${mime.split('/')[1]}`,{type:mime}));return}
 }}throw new Error('클립보드에 PNG/JPG/WEBP 이미지가 없습니다.');
 }catch(e){notifyError(e)}}
document.addEventListener('paste',async e=>{if(tab!=='add'||editingId)return;const files=Array.from(e.clipboardData?.items||[]).filter(i=>i.kind==='file');if(files.length){const file=files[0].getAsFile();if(file){e.preventDefault();await selectFile(file)}}});
async function saveCard(e){e.preventDefault();const btn=document.getElementById('save-card');const old=editingId?await getCard(editingId):null;
 const blob=old?.blob||pendingFile;
 if(!blob)return toast('문제 원본 이미지 또는 PDF를 먼저 추가하세요.');
 const wrong=document.getElementById('wrong').value.trim(),correction=document.getElementById('correction').value.trim();
 if(!wrong||!correction)return toast('틀린 이유와 교정 기준은 모두 작성해야 합니다.');
 btn.disabled=true;btn.textContent='무결성 검사 후 저장 중…';
 try{
 const mime=old?.mime||await sniff(blob),checksum=old?.sha256||await sha256(blob);
 const created=old?.createdAt||nowISO(),subject=document.getElementById('subject').value,source=document.getElementById('source').value.trim(),topic=document.getElementById('topic').value.trim();
 const title=document.getElementById('title').value.trim()||`${subject} · ${new Date().toLocaleDateString('ko-KR')}`;
 if(!old&&cards.some(c=>c.sha256===checksum)){if(!confirm('동일한 원본 이미지가 이미 등록되어 있습니다. 그래도 새 오답으로 등록할까요?'))return}
 const card={id:old?.id||uniqueId(),blob:old?.blob||blob,filename:old?.filename||blob.name||'problem',mime,size:blob.size,sha256:checksum,subject,errorType:document.getElementById('errorType').value,title,topic,source,wrong,correction,createdAt:created,updatedAt:nowISO(),dueAt:old?.dueAt||dueDateIn(1),step:old?.step??0,lapses:old?.lapses??0,attempts:old?.attempts||[]};
 await putCard(card);pendingFile=null;editingId=null;detailId=card.id;tab='detail';toast('원본 문제와 오답 원인이 저장되었습니다.');await render();
 }catch(err){notifyError(err)}finally{if(btn.isConnected){btn.disabled=false;btn.textContent='저장'}}
}
function filtered(){const q=filter.q.toLocaleLowerCase('ko-KR');return [...cards].filter(c=>(filter.subject==='전체'||c.subject===filter.subject)&&(!filter.due||isDue(c))&&[c.title,c.subject,c.topic,c.source,c.wrong,c.correction,c.errorType].join(' ').toLocaleLowerCase('ko-KR').includes(q)).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt))}
function drawLibrary(){setHTML(`${pageHeader('LIBRARY','전체 오답','원본 문제와 작성한 이유를 함께 검색하고, 원하는 문제를 다시 풀 수 있습니다.')}
 <div class="card stack"><div class="toolbar"><input id="search" class="search" placeholder="문제명, 단원, 틀린 이유 검색" value="${esc(filter.q)}" aria-label="오답 검색"><select id="filter-subject" class="search" aria-label="과목 선택" style="max-width:190px"><option>전체</option>${subjects.map(s=>`<option ${filter.subject===s?'selected':''}>${s}</option>`).join('')}</select><label class="small"><input type="checkbox" id="filter-due" ${filter.due?'checked':''}> 복습 필요만</label></div><div id="library-items"></div></div>`);
 document.getElementById('search').addEventListener('input',e=>{filter.q=e.target.value;updateLibrary()});
 document.getElementById('filter-subject').addEventListener('change',e=>{filter.subject=e.target.value;updateLibrary()});
 document.getElementById('filter-due').addEventListener('change',e=>{filter.due=e.target.checked;updateLibrary()});
 updateLibrary();
}
function updateLibrary(){const list=filtered(),out=document.getElementById('library-items');if(out)out.innerHTML=`<div class="tiny muted">${list.length}개 문제</div><div class="list top-gap">${list.map(c=>item(c)).join('')}</div>${list.length?'':'<div class="empty">검색 조건에 맞는 오답이 없습니다.</div>'}`}
function drawDetail(){const card=cards.find(c=>c.id===detailId);if(!card){tab='library';return drawLibrary()}
 const pdf=card.mime==='application/pdf';
 setHTML(`<button class="back" data-nav="library">← 전체 오답으로</button>${pageHeader('ORIGINAL RECORD',esc(card.title),`${esc(card.subject)}${card.topic?' · '+esc(card.topic):''}`)}
 <div class="split"><div class="card stack"><div class="row spread"><h2>원본 문제</h2><span class="pill">SHA-256 보존</span></div><div class="preview-area review-image">${pdf?`<iframe title="원본 문제 PDF"></iframe>`:`<img alt="원본 문제 이미지">`}</div><div class="row"><a class="btn btn-compact" download="${esc(card.filename)}" href="#">원본 내려받기</a><button class="btn btn-compact" id="verify">무결성 검사</button></div><p class="data-help">파일: ${esc(card.filename)} · ${fmtSize(card.size)}<br>해시: ${esc(card.sha256.slice(0,16))}…</p></div>
 <div class="card stack"><div class="row spread"><h2>오답 분석</h2><span class="pill ${isDue(card)?'due':'ok'}">${isDue(card)?'복습 예정/필요':dateLabel(card.dueAt)+' 복습'}</span></div><div><div class="reason-label">틀린 이유</div><div class="reason">${esc(card.wrong)}</div></div><div><div class="reason-label">교정 기준</div><div class="reason">${esc(card.correction)}</div></div><p class="small muted">유형: ${esc(card.errorType)}<br>출처: ${esc(card.source||'미기록')}<br>등록일: ${dateLabel(card.createdAt)} · 복습 ${(card.attempts||[]).length}회</p><div class="row"><button class="btn btn-primary" data-practice="${esc(card.id)}">답 가리고 재풀이</button><button class="btn" id="edit-card">기록 수정</button><button class="btn btn-danger" id="delete-card">삭제</button></div></div></div>`);
 // Create blob URL only after replacing the previous view to avoid revocation.
 const actual=fileURL(card.blob),view=main.querySelector('.review-image img,.review-image iframe');if(view)view.src=actual;
 const a=main.querySelector('a[download]');if(a)a.href=actual;
 document.getElementById('verify').addEventListener('click',async()=>{try{const digest=await sha256(card.blob);toast(digest===card.sha256?'원본의 SHA-256 해시가 등록 당시와 일치합니다.':'경고: 원본 무결성 확인에 실패했습니다.')}catch(e){notifyError(e)}});
 document.getElementById('edit-card').addEventListener('click',()=>{editingId=card.id;tab='add';render()});
 document.getElementById('delete-card').addEventListener('click',async()=>{if(confirm('이 오답과 원본 문제를 영구 삭제할까요? 백업한 ZIP에서는 복원할 수 있습니다.')){await removeCard(card.id);toast('오답이 삭제되었습니다.');nav('library')}});
}
function drawReview(){const dueCards=cards.filter(isDue).sort(dateOrder);
 if(!reviewIds)reviewIds=dueCards.map(c=>c.id);
 const active=reviewIds.find(id=>cards.some(c=>c.id===id));
 if(!active){setHTML(`${pageHeader('REVIEW','오늘의 복습','답과 오답 이유를 가리고 먼저 문제를 다시 풉니다.')}
 <div class="card empty"><div class="icon">✓</div><h2>현재 복습 대기 중인 문제가 없습니다.</h2><p>등록 후 다음 날, 또는 이전 복습 결과로 정해진 날짜에 다시 나타납니다.</p><div class="row" style="justify-content:center;margin-top:16px"><button class="btn btn-accent" data-nav="library">전체 문제에서 선택</button><button class="btn" data-nav="add">오답 등록</button></div></div>`);return}
 const card=cards.find(c=>c.id===active),remaining=reviewIds.length,pdf=card.mime==='application/pdf';
 setHTML(`${pageHeader('ACTIVE RECALL','문제를 먼저 풀어보세요',`남은 복습 ${remaining}문제 · 기록된 오답 원인과 교정 기준은 숨겨져 있습니다.`)}
 <div class="card stack"><div class="row spread"><div><span class="pill">${esc(card.subject)}</span><span class="pill">${esc(card.errorType)}</span></div><span class="small muted">${remaining}문제 남음</span></div><h2>${esc(card.title)}</h2><div class="preview-area review-image">${pdf?`<iframe title="재풀이 PDF 원본"></iframe>`:'<img alt="다시 풀 문제의 원본 이미지">'}</div>
 <p class="tiny muted">종이에 재풀이하고 채점한 다음 아래 버튼을 누르세요.</p>
 ${!reviewReveal?'<button id="show-reason" class="btn btn-primary">풀이 완료 — 이전 오답 이유 확인</button>':`<div class="stack"><div class="reason-label">이전에 틀린 이유</div><div class="reason">${esc(card.wrong)}</div><div class="reason-label">다음에 적용할 교정 기준</div><div class="reason">${esc(card.correction)}</div><div class="review-actions"><button class="btn btn-danger" data-rate="wrong">다시 틀림</button><button class="btn btn-success" data-rate="correct">정답 / 이해함</button></div><p class="data-help">틀림: 1일 후 재복습 / 정답: 다음 간격(3·7·14·30·60·120일)으로 이동. 학습 근거에 따라 언제든 간격을 조정할 수 있습니다.</p></div>`}</div>`);
 const url=fileURL(card.blob),v=main.querySelector('.review-image img,.review-image iframe');if(v)v.src=url;
 document.getElementById('show-reason')?.addEventListener('click',()=>{reviewReveal=true;drawReview()});
 main.querySelectorAll('[data-rate]').forEach(x=>x.addEventListener('click',async()=>{
  try{const correct=x.dataset.rate==='correct';await putCard(rateCard(card,correct));reviewIds=reviewIds.filter(id=>id!==active);reviewReveal=false;toast(correct?'정답으로 기록했습니다. 다음 간격으로 이동합니다.':'오답으로 기록했습니다. 내일 다시 복습합니다.');await render()}
  catch(e){notifyError(e)}
 }));
}
function drawBackup(){const total=cards.reduce((sum,c)=>sum+(c.size||0),0),last=localStorage.getItem('cpa-last-backup');
 setHTML(`${pageHeader('DATA SAFETY','백업 및 복원','ZIP 한 파일에 모든 원본 이미지와 오답 기록, 복습 이력을 함께 보관합니다.')}
 <div class="stack"><div class="card stack"><h2>전체 ZIP 백업</h2><p class="small muted">${cards.length}개 문제 · 원본 파일 합계 ${fmtSize(total)} · 최근 백업: ${last?dateLabel(last):'기록 없음'}</p><div class="hint">원본 파일의 SHA-256을 확인한 뒤 ZIP에 그대로 포함합니다. 데이터를 서버로 전송하지 않습니다. 백업은 iCloud Drive 또는 별도 저장소에 직접 보관하세요.</div><div class="row"><button id="export" class="btn btn-accent" ${cards.length?'':'disabled'}>↓ 전체 백업 ZIP 만들기</button><span id="export-status" class="tiny muted"></span></div><p class="data-help">대용량 ZIP은 iPad 메모리 제한에 영향을 받을 수 있습니다. 100MB 안팎부터 정기 백업을 권장하며, 250MB를 초과하는 백업의 복원은 MVP에서 지원하지 않습니다.</p></div>
 <div class="card stack"><h2>백업 파일 복원</h2><p class="small muted">이 앱이 생성한 ZIP을 선택하세요. 압축 파일 무결성과 각 원본의 SHA-256을 확인한 뒤 저장합니다.</p><input type="file" id="restore-file" accept=".zip,application/zip"><div class="row"><label class="small"><input type="radio" name="restore-mode" value="merge" checked> 기존 기록 유지 + 새 문제만 추가</label></div><div class="row"><label class="small"><input type="radio" name="restore-mode" value="replace"> 현재 데이터를 백업 내용으로 교체</label></div><button class="btn btn-primary" id="restore" disabled>선택한 ZIP 검사 및 복원</button><p id="restore-status" class="data-help"></p><div class="hint warning">‘교체’는 기존 문제와 복습 이력을 지웁니다. 교체 전에 현재 데이터의 ZIP 백업을 먼저 만드세요. 검증이 끝나기 전에는 기존 데이터에 손대지 않습니다.</div></div>
 <div class="card stack"><h2>보관 위치 유의사항</h2><p class="small">이 웹앱은 로그인이나 클라우드 동기화가 없는 오프라인 우선 MVP입니다. 브라우저 데이터 삭제, 기기 분실, 홈 화면 앱 삭제 등으로 로컬 기록이 사라질 수 있습니다. <strong>정기 ZIP 백업이 필수</strong>입니다.</p><p class="small">iPad Safari 탭과 홈 화면에 설치한 웹앱은 데이터를 별도로 저장할 수 있습니다. <strong>등록·복습·백업은 항상 같은 설치된 앱</strong>에서 진행하세요.</p><button id="request-persist" class="btn">가능한 경우 브라우저 저장소 보호 요청</button><p class="data-help">저장소 보호 요청은 브라우저가 거부할 수 있으며, 백업을 대체하지 않습니다.</p></div></div>`);
 document.getElementById('export').addEventListener('click',exportBackup);
 document.getElementById('restore-file').addEventListener('change',e=>{const f=e.target.files?.[0];document.getElementById('restore').disabled=!f;document.getElementById('restore-status').textContent=f?`선택 파일: ${f.name} (${fmtSize(f.size)})`:''});
 document.getElementById('restore').addEventListener('click',importBackup);
 document.getElementById('request-persist').addEventListener('click',async()=>{try{const ok=await navigator.storage?.persist?.();toast(ok?'브라우저가 지속 저장 요청을 수락했습니다.':'지원하지 않거나 허용되지 않았습니다. ZIP 백업을 유지하세요.')}catch(e){notifyError(e)}});
}
async function exportBackup(){const btn=document.getElementById('export'),out=document.getElementById('export-status');btn.disabled=true;
 try{const all=await allCards();if(!all.length)return;
  const blob=await makeBackup(all,p=>{out.textContent=`원본 검사 및 백업 구성 ${p}%`});
  const filename=`CPA-오답백업-${new Date().toLocaleDateString('sv-SE')}.zip`;
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
  localStorage.setItem('cpa-last-backup',nowISO());out.textContent=`백업 파일 ${fmtSize(blob.size)} — 다운로드 목록에서 저장 여부를 확인하세요.`;
  toast('백업 ZIP을 만들었습니다. 파일 앱에서 실제 저장 여부를 확인하세요.');
 }catch(e){notifyError(e);out.textContent=e.message}finally{btn.disabled=false}
}
async function importBackup(){const inp=document.getElementById('restore-file'),btn=document.getElementById('restore'),out=document.getElementById('restore-status'),file=inp.files?.[0];if(!file)return;
 const mode=document.querySelector('input[name="restore-mode"]:checked').value;
 if(mode==='replace'&&!confirm('주의: 현재 모든 오답 기록을 지우고 ZIP 내용으로 교체합니다. 복원 전에 현재 백업을 만들었나요?'))return;
 btn.disabled=true;out.textContent='ZIP과 원본 SHA-256 확인 중…';
 try{const {cards:records}=await loadBackup(file,p=>{out.textContent=`무결성 검사 ${p}%`});
  if(!confirm(`${records.length}개 오답의 무결성 검사가 끝났습니다. ${mode==='replace'?'현재 자료를 교체':'기존 자료를 유지하며 새 자료를 추가'}할까요?`))return;
  const result=await restoreCards(records,mode);out.textContent=`복원 완료: ${result.added}개 저장, ${result.skipped}개 중복 ID로 건너뜀.`;
  toast('검증 완료 후 복원했습니다.');
 }catch(e){notifyError(e);out.textContent='복원 실패: '+e.message}finally{const b=document.getElementById('restore');if(b)b.disabled=false}
}
// Shared navigation and card links.
document.addEventListener('click',e=>{
 const navButton=e.target.closest('[data-nav]');if(navButton){e.preventDefault();nav(navButton.dataset.nav);return}
 const tabButton=e.target.closest('[data-tab]');if(tabButton){e.preventDefault();nav(tabButton.dataset.tab);return}
 const cardButton=e.target.closest('[data-open]');if(cardButton){e.preventDefault();detailId=cardButton.dataset.open;tab='detail';render();window.scrollTo(0,0);return}
 const practice=e.target.closest('[data-practice]');if(practice){e.preventDefault();tab='review';reviewIds=[practice.dataset.practice];reviewReveal=false;render();window.scrollTo(0,0)}
});
document.getElementById('top-add').addEventListener('click',()=>nav('add'));
if('serviceWorker' in navigator&&location.protocol==='https:'||location.hostname==='localhost'){
 navigator.serviceWorker?.register('./sw.js').catch(err=>console.warn('Offline cache unavailable',err));
}
openDB().then(async()=>{
 try{if(navigator.storage?.estimate){const est=await navigator.storage.estimate();if(est.quota&&est.usage&&est.usage/est.quota>.8)toast('저장 공간이 부족할 수 있습니다. ZIP 백업 후 여유 공간을 확보하세요.')}}catch{}
 render();
}).catch(e=>{main.innerHTML=`<div class="card danger-box">이 환경에서는 기기 저장소를 열 수 없습니다. Safari의 일반 모드 또는 설치된 웹앱에서 여세요. 오류: ${esc(e.message)}</div>`});
