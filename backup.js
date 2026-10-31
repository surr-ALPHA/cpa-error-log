import {sha256,restoreCards} from './store.js';
// ZIP store-mode (method 0), with ZIP CRC-32 plus per-image SHA-256.
// No external CDN or server is required. All attachment bytes are preserved verbatim.
const enc = new TextEncoder(), dec = new TextDecoder('utf-8',{fatal:true});
const MAX_IMPORT=250*1024*1024;const MAX_RECORDS=5000;
const table=new Uint32Array(256);
for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++) c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0}
function crc32(bytes){let c=0xffffffff;for(let i=0;i<bytes.length;i++)c=table[(c^bytes[i])&255]^(c>>>8);return(c^0xffffffff)>>>0}
function u16(d,o,n){d.setUint16(o,n,true)}function u32(d,o,n){d.setUint32(o,n>>>0,true)}
function entryHeader(nameBytes,bytes,crc){const b=new ArrayBuffer(30+nameBytes.length),d=new DataView(b);u32(d,0,0x04034b50);u16(d,4,20);u16(d,6,0x800);u16(d,8,0);u32(d,14,crc);u32(d,18,bytes.length);u32(d,22,bytes.length);u16(d,26,nameBytes.length);new Uint8Array(b,30).set(nameBytes);return b}
function centralHeader(nameBytes,bytes,crc,offset){const b=new ArrayBuffer(46+nameBytes.length),d=new DataView(b);u32(d,0,0x02014b50);u16(d,4,20);u16(d,6,20);u16(d,8,0x800);u32(d,16,crc);u32(d,20,bytes.length);u32(d,24,bytes.length);u16(d,28,nameBytes.length);u32(d,42,offset);new Uint8Array(b,46).set(nameBytes);return b}
export async function makeBackup(cards,progress=()=>{}){
 const entries=[], metadata=[];let total=0;
 for(let i=0;i<cards.length;i++){
  const card=cards[i];const bytes=new Uint8Array(await card.blob.arrayBuffer());
  const digest=await sha256(card.blob);
  if(digest!==card.sha256)throw new Error(`${card.title||card.id} 원본 이미지 무결성 확인에 실패했습니다. 백업을 중단했습니다.`);
  const filename=`assets/${card.id}`;
  const {blob,...meta}=card;metadata.push({...meta,asset:filename});entries.push([filename,bytes]);
  total+=bytes.length;progress(Math.round((i+1)/Math.max(cards.length,1)*80));
 }
 const manifest={format:'cpa-error-log-v1',exportedAt:new Date().toISOString(),items:metadata};
 entries.unshift(['manifest.json',enc.encode(JSON.stringify(manifest,null,2))]);
 const chunks=[],central=[];let offset=0;
 for(const [name,bytes] of entries){
  if(bytes.length>0xffffffff)throw new Error('개별 파일이 ZIP 형식의 최대 크기를 초과합니다.');
  const nameBytes=enc.encode(name),crc=crc32(bytes),local=entryHeader(nameBytes,bytes,crc);
  chunks.push(local,bytes);central.push(centralHeader(nameBytes,bytes,crc,offset));offset+=local.byteLength+bytes.length;
 }
 const dirLength=central.reduce((s,x)=>s+x.byteLength,0);
 if(offset>0xffffffff||dirLength>0xffffffff||entries.length>65535)throw new Error('백업 ZIP 크기 제한을 초과했습니다.');
 const eocd=new ArrayBuffer(22),v=new DataView(eocd);u32(v,0,0x06054b50);u16(v,8,entries.length);u16(v,10,entries.length);u32(v,12,dirLength);u32(v,16,offset);
 progress(100);
 return new Blob([...chunks,...central,eocd],{type:'application/zip'});
}
function unzip(buf){
 const d=new DataView(buf),bytes=new Uint8Array(buf),out=new Map();let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){if(d.getUint32(i,true)===0x06054b50){end=i;break}}
 if(end<0)throw new Error('올바른 ZIP 백업 파일이 아닙니다.');
 const total=d.getUint16(end+10,true),dirLen=d.getUint32(end+12,true),dirStart=d.getUint32(end+16,true);
 if(total>MAX_RECORDS+1||dirStart+dirLen>end)throw new Error('백업의 목차가 유효하지 않습니다.');
 let p=dirStart;
 for(let i=0;i<total;i++){
  if(p+46>bytes.length||d.getUint32(p,true)!==0x02014b50)throw new Error('ZIP 목차가 손상되었습니다.');
  const method=d.getUint16(p+10,true),crc=d.getUint32(p+16,true),compressed=d.getUint32(p+20,true),uncompressed=d.getUint32(p+24,true);
  const nameLen=d.getUint16(p+28,true),extra=d.getUint16(p+30,true),comment=d.getUint16(p+32,true),offset=d.getUint32(p+42,true);
  if(method!==0||compressed!==uncompressed)throw new Error('이 앱에서 만든 무압축 ZIP 백업만 복원할 수 있습니다.');
  if(p+46+nameLen+extra+comment>bytes.length||offset+30>bytes.length)throw new Error('ZIP 항목 범위가 잘못되었습니다.');
  const name=dec.decode(bytes.subarray(p+46,p+46+nameLen));
  if(name.includes('..')||name.startsWith('/')||out.has(name))throw new Error('백업의 파일 경로가 유효하지 않습니다.');
  if(d.getUint32(offset,true)!==0x04034b50)throw new Error('ZIP 본문이 손상되었습니다.');
  const localName=d.getUint16(offset+26,true),localExtra=d.getUint16(offset+28,true);
  const begin=offset+30+localName+localExtra;
  if(begin+uncompressed>bytes.length)throw new Error('ZIP 파일이 잘렸습니다.');
  const data=bytes.subarray(begin,begin+uncompressed);
  if(crc32(data)!==crc)throw new Error(`${name}: CRC 무결성 확인 실패`);
  out.set(name,data);
  p+=46+nameLen+extra+comment;
 }
 return out;
}
function validateMeta(meta){
 if(!meta||typeof meta!=='object'||!Array.isArray(meta.items)||meta.format!=='cpa-error-log-v1')throw new Error('지원하지 않는 백업 버전입니다.');
 if(meta.items.length>MAX_RECORDS)throw new Error('지원하는 오답 수를 초과했습니다.');
 const seen=new Set();
 for(const c of meta.items){
  if(!c||typeof c.id!=='string'||!/^[-a-zA-Z0-9]{8,80}$/.test(c.id)||seen.has(c.id))throw new Error('오답 ID가 유효하지 않습니다.');
  if(typeof c.asset!=='string'||c.asset!==`assets/${c.id}`)throw new Error('원본 파일 경로 오류');
  if(typeof c.sha256!=='string'||!/^([0-9a-f]{64})$/.test(c.sha256))throw new Error('해시값 오류');
  for(const k of ['title','subject','wrong','correction','dueAt','createdAt'])if(typeof c[k]!=='string')throw new Error(`오답 항목 ${k} 정보 오류`);
  if(!Array.isArray(c.attempts)||c.attempts.length>100000||!['image/png','image/jpeg','image/webp','application/pdf'].includes(c.mime))throw new Error('오답 데이터 형식 오류');
  if(!Number.isFinite(Date.parse(c.dueAt)))throw new Error('복습 날짜 오류');
  seen.add(c.id);
 }
}
export async function loadBackup(file,progress=()=>{}){
 if(file.size>MAX_IMPORT)throw new Error('복원 ZIP 파일은 250MB 이하여야 합니다. 분할 백업은 추후 버전에서 지원합니다.');
 const entries=unzip(await file.arrayBuffer()),manifestData=entries.get('manifest.json');
 if(!manifestData)throw new Error('manifest.json이 없는 백업입니다.');
 let meta;try{meta=JSON.parse(dec.decode(manifestData))}catch{throw new Error('백업 설명 파일을 읽지 못했습니다.')}
 validateMeta(meta);
 if(entries.size!==meta.items.length+1)throw new Error('백업 항목 수가 일치하지 않습니다.');
 const cards=[];
 for(let i=0;i<meta.items.length;i++){
  const entry=meta.items[i],data=entries.get(entry.asset);if(!data)throw new Error(`${entry.id}: 원본 이미지가 없습니다.`);
  if(data.byteLength!==entry.size)throw new Error(`${entry.id}: 원본 크기가 일치하지 않습니다.`);
  const blob=new Blob([data],{type:entry.mime});
  if(await sha256(blob)!==entry.sha256)throw new Error(`${entry.id}: SHA-256 이미지 무결성 실패`);
  const {asset,...rest}=entry;cards.push({...rest,blob});progress(Math.round((i+1)/Math.max(meta.items.length,1)*100));
 }
 return {cards,exportedAt:meta.exportedAt};
}
export {restoreCards};
