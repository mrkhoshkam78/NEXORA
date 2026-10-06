import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadConnection, saveConnection, clearConnection, appHome } from './config.js';
import { extractZipBuffer, createZipBuffer } from './zip.js';
import { validateAndDiscover, testModel, chatCompletion } from './cloudflare.js';
import { toolDefinitions, executeTool } from './tools.js';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = path.join(appHome(), 'workspaces');
const PUBLIC = path.resolve(process.cwd(), 'public');
await fs.mkdir(ROOT, { recursive: true });

const mime = { '.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.txt':'text/plain; charset=utf-8' };
const json = (res, status, data) => { const body=JSON.stringify(data); res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body)}); res.end(body); };
async function tree(dir, base=''){
  const out=[];
  for(const e of await fs.readdir(dir,{withFileTypes:true})){
    if(['node_modules','.git'].includes(e.name)) continue;
    const full=path.join(dir,e.name), rel=path.join(base,e.name);
    if(e.isDirectory()) out.push({type:'folder',path:rel,children:await tree(full,rel)});
    else { const s=await fs.stat(full); out.push({type:'file',path:rel,size:s.size}); }
  }
  return out.sort((a,b)=>(a.type==='folder'?0:1)-(b.type==='folder'?0:1)||a.path.localeCompare(b.path));
}
function isModelError(e){ return [400,401,403,404,409].includes(e?.status) || /model|permission|access|not found/i.test(e?.message||''); }
const SYSTEM=`You are Nexora, a precise coding agent. Work on the user's local project using the supplied tools. Never claim a change occurred unless a tool confirms it. Inspect relevant files before substantial edits. Preserve existing features unless explicitly asked to change them. Prefer focused edits. Do not invent project files or APIs.`;
function cleanCred(c){ return c ? {connected:true,accountId:c.accountId,primaryModel:c.primaryModel||null,fallbacks:c.fallbacks||[],updatedAt:c.updatedAt} : {connected:false}; }
async function readBody(req, max=5*1024*1024){ const chunks=[]; let n=0; for await(const c of req){n+=c.length;if(n>max)throw new Error('Request too large.');chunks.push(c);}return Buffer.concat(chunks); }
async function readJson(req){ const b=await readBody(req,2*1024*1024); return JSON.parse(b.toString('utf8')||'{}'); }
function projectPath(id, rel=''){ const root=path.resolve(ROOT,id); const p=path.resolve(root,rel); if(p!==root&&!p.startsWith(root+path.sep))throw new Error('Invalid project path.'); return p; }
async function handle(req,res){
  const u=new URL(req.url,`http://${req.headers.host||HOST}`); const method=req.method||'GET';
  if(method==='GET' && u.pathname==='/api/status') return json(res,200,cleanCred(await loadConnection()));
  if(method==='POST' && u.pathname==='/api/setup/validate'){
    try{const body=await readJson(req),accountId=String(body.accountId||'').trim(),token=String(body.token||'').trim();if(!accountId||token.length<20)return json(res,400,{error:'Enter a valid Account ID and API Token.'});const d=await validateAndDiscover(accountId,token);if(!d.primary)return json(res,403,{error:'Workers AI is reachable but no compatible model is available.'});const test=await testModel({accountId,token,model:d.primary});await saveConnection({accountId,token,primaryModel:d.primary,fallbacks:d.fallbacks,updatedAt:new Date().toISOString()});return json(res,200,{ok:true,primary:d.primary,primaryModel:d.primary,fallbacks:d.fallbacks,models:d.models,test});}
    catch(e){return json(res,e.status===429?429:502,{error:e.message||'Cloudflare validation failed.',classification:e.status===429?'quota_or_rate_limit':'connection_or_model_error'});}
  }
  if(method==='POST' && u.pathname==='/api/setup/reset'){await clearConnection();return json(res,200,{ok:true});}
  if(method==='GET' && u.pathname==='/api/models'){const c=await loadConnection();if(!c)return json(res,401,{error:'Not connected.'});try{return json(res,200,await validateAndDiscover(c.accountId,c.token));}catch(e){return json(res,502,{error:e.message});}}
  if(method==='POST' && u.pathname==='/api/projects/import'){
    try{const zip=await readBody(req,60*1024*1024);if(!zip.length)return json(res,400,{error:'ZIP body is empty.'});const id=crypto.randomUUID(),dir=path.join(ROOT,id);await extractZipBuffer(zip,dir);return json(res,200,{projectId:id});}catch(e){return json(res,400,{error:e.message});}
  }
  const tm=u.pathname.match(/^\/api\/projects\/([^/]+)\/tree$/); if(method==='GET'&&tm){try{return json(res,200,await tree(projectPath(tm[1])));}catch(e){return json(res,404,{error:e.message});}}
  const fm=u.pathname.match(/^\/api\/projects\/([^/]+)\/file$/); if(method==='GET'&&fm){try{const p=projectPath(fm[1],u.searchParams.get('path')||'');return json(res,200,{content:await fs.readFile(p,'utf8')});}catch(e){return json(res,404,{error:e.message});}}
  const sm=u.pathname.match(/^\/api\/projects\/([^/]+)\/file$/); if(method==='PUT'&&sm){try{const body=await readJson(req),p=projectPath(sm[1],body.path);await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,String(body.content??''),'utf8');return json(res,200,{ok:true});}catch(e){return json(res,400,{error:e.message});}}
  const zm=u.pathname.match(/^\/api\/projects\/([^/]+)\/zip$/); if(method==='POST'&&zm){try{const id=zm[1],dir=projectPath(id),zipName=`nexora-${id}-${Date.now()}.zip`,zipPath=path.join(ROOT,zipName);await fs.writeFile(zipPath,await createZipBuffer(dir));return json(res,200,{url:`/api/projects/${encodeURIComponent(id)}/zip-download?file=${encodeURIComponent(zipName)}`});}catch(e){return json(res,500,{error:e.message});}}
  const zd=u.pathname.match(/^\/api\/projects\/([^/]+)\/zip-download$/);if(method==='GET'&&zd){try{const f=u.searchParams.get('file')||'',p=path.resolve(ROOT,f);if(!p.startsWith(ROOT+path.sep)||!f.endsWith('.zip'))throw new Error('Invalid archive.');const b=await fs.readFile(p);res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="${path.basename(p)}"`,'Content-Length':b.length});res.end(b);}catch(e){return json(res,404,{error:e.message});}}
  if(method==='POST'&&u.pathname==='/api/chat'){
    const c=await loadConnection();if(!c)return json(res,401,{error:'Connect Cloudflare first.'});
    const body=await readJson(req,4*1024*1024),projectId=String(body.projectId||''),incoming=Array.isArray(body.messages)?body.messages:[]; if(!incoming.length)return json(res,400,{error:'Messages required.'});
    res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});const send=o=>res.write(`data: ${JSON.stringify(o)}\n\n`);
    let models=[c.primaryModel,...(c.fallbacks||[])].filter(Boolean),used=null,history=[{role:'system',content:SYSTEM},...incoming.slice(-30)];
    try{
      let done=false;
      for(const model of models){
        try{used=model;for(let round=0;round<6;round++){const r=await chatCompletion({accountId:c.accountId,token:c.token,model,messages:history,tools:toolDefinitions,tool_choice:'auto',stream:false});const j=await r.json(),msg=j?.choices?.[0]?.message;if(!msg)throw new Error('Cloudflare returned no assistant message.');history.push(msg);if(msg.tool_calls?.length){for(const tc of msg.tool_calls){let args={};try{args=JSON.parse(tc.function.arguments||'{}')}catch{}send({type:'tool_start',name:tc.function.name,args});try{const result=await executeTool(projectId,tc.function.name,args);history.push({role:'tool',tool_call_id:tc.id,name:tc.function.name,content:String(result)});send({type:'tool_end',name:tc.function.name,result:String(result).slice(0,800)});}catch(err){history.push({role:'tool',tool_call_id:tc.id,name:tc.function.name,content:`ERROR: ${err.message}`});send({type:'tool_end',name:tc.function.name,error:err.message});}}continue;}done=true;break;}if(done)break;}
        catch(e){if(isModelError(e)&&model!==models.at(-1)){const next=models[models.indexOf(model)+1];send({type:'model_fallback',from:model,to:next,reason:e.message});continue;}throw e;}
      }
      if(!done)throw new Error('Agent stopped before a final response.');
      const r=await chatCompletion({accountId:c.accountId,token:c.token,model:used,messages:history,tools:toolDefinitions,tool_choice:'none',stream:true}); if(!r.body)throw new Error('Cloudflare did not return a stream.');
      const reader=r.body.getReader(),dec=new TextDecoder();let buffer='';while(true){const {value,done}=await reader.read();if(done)break;buffer+=dec.decode(value,{stream:true});let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i).trim();buffer=buffer.slice(i+1);if(!line.startsWith('data:'))continue;const p=line.slice(5).trim();if(p==='[DONE]')continue;try{const j=JSON.parse(p),delta=j?.choices?.[0]?.delta?.content;if(delta)send({type:'delta',text:delta});}catch{}}}
      send({type:'done',model:used});res.end();
    }catch(e){send({type:'error',error:e.message||'AI request failed.',classification:e.status===429?'quota_exhausted_or_rate_limited':isModelError(e)?'model_or_access_failure':'request_failure',model:used});res.end();}
    return;
  }
  if(method==='GET'){
    let file=u.pathname==='/'?'/index.html':u.pathname; const p=path.resolve(PUBLIC,file.slice(1));if(p.startsWith(PUBLIC+path.sep)){try{const b=await fs.readFile(p);res.writeHead(200,{'Content-Type':mime[path.extname(p)]||'application/octet-stream','Content-Length':b.length});return res.end(b);}catch{}}
    const idx=await fs.readFile(path.join(PUBLIC,'index.html'));res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(idx);
  }
  json(res,404,{error:'Not found'});
}
const server=http.createServer((req,res)=>handle(req,res).catch(e=>{if(!res.headersSent)json(res,500,{error:e.message});else res.end();}));
server.listen(PORT,HOST,()=>{
  const url=`http://${HOST}:${PORT}`; console.log(`Nexora V1 running at ${url}`);
  if(process.env.NEXORA_NO_BROWSER!=='1') {
    import('node:child_process').then(({exec})=>{
      const cmd=process.platform==='win32'?`start "" "${url}"`:process.platform==='darwin'?`open "${url}"`:`xdg-open "${url}"`;
      exec(cmd,{windowsHide:true});
    }).catch(()=>{});
  }
});
