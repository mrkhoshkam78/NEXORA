import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;

let crcTable;
function makeCrcTable(){
  if(crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for(let n=0;n<256;n++){
    let c=n;
    for(let k=0;k<8;k++) c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);
    crcTable[n]=c>>>0;
  }
  return crcTable;
}
function crc32(buf){
  const t=makeCrcTable(); let c=0xffffffff;
  for(const b of buf) c=t[(c^b)&255]^(c>>>8);
  return (c^0xffffffff)>>>0;
}
function u16(b,o){return b.readUInt16LE(o)}
function u32(b,o){return b.readUInt32LE(o)}
function dosTime(date=new Date()){
  const d=((date.getHours()<<11)|(date.getMinutes()<<5)|(Math.floor(date.getSeconds()/2)))&0xffff;
  const day=((date.getFullYear()-1980)<<9)|((date.getMonth()+1)<<5)|date.getDate();
  return {time:d,date:day};
}
function safeRel(p){
  const s=p.replace(/\\/g,'/');
  const n=path.posix.normalize(s);
  if(!n || n==='.' || n.startsWith('../') || n.startsWith('/') || n.includes('/../')) throw new Error('Unsafe ZIP path: '+p);
  return n;
}

export async function extractZipBuffer(buf,dest){
  const endMin=22, start=Math.max(0,buf.length-0x10000-endMin);
  let eocd=-1;
  for(let i=buf.length-endMin;i>=start;i--) if(u32(buf,i)===SIG_END){eocd=i;break;}
  if(eocd<0) throw new Error('Invalid ZIP archive.');
  const count=u16(buf,eocd+10), cdSize=u32(buf,eocd+12), cdOffset=u32(buf,eocd+16);
  if(cdOffset+cdSize>buf.length) throw new Error('Invalid ZIP central directory.');
  await fs.mkdir(dest,{recursive:true});
  let p=cdOffset;
  for(let i=0;i<count;i++){
    if(u32(buf,p)!==SIG_CENTRAL) throw new Error('Invalid ZIP entry.');
    const method=u16(buf,p+10), compSize=u32(buf,p+20), uncompSize=u32(buf,p+24), nameLen=u16(buf,p+28), extraLen=u16(buf,p+30), commentLen=u16(buf,p+32), localOffset=u32(buf,p+42);
    const name=buf.subarray(p+46,p+46+nameLen).toString('utf8');
    p += 46+nameLen+extraLen+commentLen;
    const rel=safeRel(name), target=path.resolve(dest,rel);
    if(target!==path.resolve(dest) && !target.startsWith(path.resolve(dest)+path.sep)) throw new Error('Unsafe ZIP path.');
    const isDir=name.endsWith('/');
    if(isDir){ await fs.mkdir(target,{recursive:true}); continue; }
    if(u32(buf,localOffset)!==SIG_LOCAL) throw new Error('Invalid ZIP local header.');
    const ln=u16(buf,localOffset+26), le=u16(buf,localOffset+28), dataStart=localOffset+30+ln+le;
    const end=dataStart+compSize;
    if(end>buf.length) throw new Error('Truncated ZIP entry.');
    let raw=buf.subarray(dataStart,end);
    let out;
    if(method===0) out=Buffer.from(raw); else if(method===8) out=zlib.inflateRawSync(raw); else throw new Error('Unsupported ZIP compression method: '+method);
    if(out.length!==uncompSize) throw new Error('ZIP size mismatch.');
    await fs.mkdir(path.dirname(target),{recursive:true});
    await fs.writeFile(target,out);
  }
}

export async function createZipBuffer(root){
  const entries=[];
  async function walk(dir,rel=''){
    for(const e of await fs.readdir(dir,{withFileTypes:true})){
      if(['node_modules','.git'].includes(e.name)) continue;
      const full=path.join(dir,e.name), child=rel?path.posix.join(rel,e.name):e.name;
      if(e.isDirectory()) await walk(full,child+'/'); else entries.push({full,name:child});
    }
  }
  await walk(root);
  const locals=[], centrals=[]; let offset=0; const now=dosTime();
  for(const e of entries){
    const data=await fs.readFile(e.full), compressed=zlib.deflateRawSync(data,{level:6}), method=compressed.length<data.length?8:0, payload=method===8?compressed:data;
    const name=Buffer.from(e.name,'utf8'), crc=crc32(data);
    const lh=Buffer.alloc(30+name.length);
    lh.writeUInt32LE(SIG_LOCAL,0); lh.writeUInt16LE(20,4); lh.writeUInt16LE(0,6); lh.writeUInt16LE(method,8); lh.writeUInt16LE(now.time,10); lh.writeUInt16LE(now.date,12); lh.writeUInt32LE(crc,14); lh.writeUInt32LE(payload.length,18); lh.writeUInt32LE(data.length,22); lh.writeUInt16LE(name.length,26); lh.writeUInt16LE(0,28); name.copy(lh,30);
    locals.push(lh,payload); offset += lh.length+payload.length;
    const ch=Buffer.alloc(46+name.length);
    ch.writeUInt32LE(SIG_CENTRAL,0); ch.writeUInt16LE(20,4); ch.writeUInt16LE(20,6); ch.writeUInt16LE(0,8); ch.writeUInt16LE(method,10); ch.writeUInt16LE(now.time,12); ch.writeUInt16LE(now.date,14); ch.writeUInt32LE(crc,16); ch.writeUInt32LE(payload.length,20); ch.writeUInt32LE(data.length,24); ch.writeUInt16LE(name.length,28); ch.writeUInt16LE(0,30); ch.writeUInt16LE(0,32); ch.writeUInt16LE(0,34); ch.writeUInt16LE(0,36); ch.writeUInt32LE(0,38); ch.writeUInt32LE(offset-lh.length-payload.length,42); name.copy(ch,46); centrals.push(ch);
  }
  const cd=Buffer.concat(centrals), body=Buffer.concat([...locals,cd]); const end=Buffer.alloc(22);
  end.writeUInt32LE(SIG_END,0); end.writeUInt16LE(0,4); end.writeUInt16LE(0,6); end.writeUInt16LE(entries.length,8); end.writeUInt16LE(entries.length,10); end.writeUInt32LE(cd.length,12); end.writeUInt32LE(offset,16); end.writeUInt16LE(0,20);
  return Buffer.concat([body,end]);
}
