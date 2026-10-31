// Original file blobs are stored in IndexedDB without resizing, OCR, or recompression.
const DB_NAME = 'cpa-error-log';
const DB_VERSION = 1;
const STORE = 'cards';
let dbPromise;
export function openDB(){
  if(!('indexedDB' in window)) return Promise.reject(new Error('이 브라우저는 IndexedDB를 지원하지 않습니다.'));
  if(!dbPromise) dbPromise = new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if(!req.result.objectStoreNames.contains(STORE)){
        const st = req.result.createObjectStore(STORE,{keyPath:'id'});
        st.createIndex('byDue','dueAt');
        st.createIndex('bySubject','subject');
      }
    };
    req.onsuccess = ()=>{const db=req.result;db.onversionchange=()=>db.close();resolve(db)};
    req.onerror = ()=>reject(req.error || new Error('저장소를 열 수 없습니다.'));
    req.onblocked = ()=>reject(new Error('다른 탭의 앱을 닫고 다시 시도하세요.'));
  }).catch(err=>{dbPromise=null;throw err});
  return dbPromise;
}
export function request(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
export async function allCards(){const db=await openDB();return request(db.transaction(STORE,'readonly').objectStore(STORE).getAll())}
export async function getCard(id){const db=await openDB();return request(db.transaction(STORE,'readonly').objectStore(STORE).get(id))}
export async function putCard(card){const db=await openDB();return new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(card);
  tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error||new Error('저장 실패'));tx.onabort=()=>reject(tx.error||new Error('저장 취소'));
})}
export async function removeCard(id){const db=await openDB();return new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(id);
  tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
})}
export async function restoreCards(cards,mode){
  const db=await openDB();const old=mode==='merge'?await allCards():[];
  const indexed=new Map(old.map(c=>[c.id,c]));
  if(mode==='merge'){
    const conflicts=cards.filter(c=>{const prev=indexed.get(c.id);return prev&&(prev.sha256!==c.sha256||prev.updatedAt!==c.updatedAt||prev.wrong!==c.wrong||prev.correction!==c.correction||JSON.stringify(prev.attempts)!==JSON.stringify(c.attempts))});
    if(conflicts.length)throw new Error(`같은 카드 ID지만 내용이나 복습 이력이 다른 항목이 ${conflicts.length}개 있습니다. 충돌을 피하기 위해 병합을 중단했습니다. 현재 데이터를 먼저 백업한 후 별도 저장소에서 확인하세요.`);
  }
  const incoming=mode==='merge'?cards.filter(c=>!indexed.has(c.id)):cards;
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite');const st=tx.objectStore(STORE);
    if(mode==='replace') st.clear();
    incoming.forEach(c=>st.put(c));
    tx.oncomplete=()=>resolve({added:incoming.length,skipped:cards.length-incoming.length});
    tx.onerror=()=>reject(tx.error||new Error('복원 중 저장 오류'));tx.onabort=()=>reject(tx.error||new Error('복원 실패'));
  });
}
export async function sha256(blob){const buffer=await blob.arrayBuffer();const digest=await crypto.subtle.digest('SHA-256',buffer);return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('')}
export function todayDate(){const d=new Date();d.setHours(0,0,0,0);return d}
export function dueDateIn(days){const d=todayDate();d.setDate(d.getDate()+days);return d.toISOString()}
export function isDue(card){return new Date(card.dueAt)<=new Date()}
export function dateLabel(date){if(!date)return '미정';return new Date(date).toLocaleDateString('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit'})}
export const INTERVALS=[1,3,7,14,30,60,120];
export function rateCard(card,correct){
 const now=new Date().toISOString();const step=correct?Math.min((card.step||0)+1,INTERVALS.length-1):0;
 return {...card,step,dueAt:dueDateIn(INTERVALS[step]),lapses:(card.lapses||0)+(correct?0:1),attempts:[...(card.attempts||[]),{time:now,correct}],updatedAt:now};
}
