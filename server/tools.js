import fs from 'node:fs/promises';
import path from 'node:path';
import { appHome } from './config.js';
import { createZipBuffer } from './zip.js';

const IGNORE = new Set(['.git','node_modules','.DS_Store','config']);
const TEXT_EXT = new Set(['.js','.jsx','.ts','.tsx','.json','.css','.html','.md','.txt','.yml','.yaml','.toml','.xml','.svg','.sql','.py','.rs','.go','.java','.c','.cpp','.h','.hpp','.vue','.svelte']);

function rootFor(id) { return path.join(appHome(), 'workspaces', id); }
function safe(id, rel='') {
  const root = rootFor(id);
  const target = path.resolve(root, rel);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Path escapes project workspace.');
  return target;
}

async function walk(dir, base='') {
  const out = [];
  for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
    if (IGNORE.has(ent.name)) continue;
    const rel = path.join(base, ent.name);
    if (ent.isDirectory()) out.push({ type:'folder', path:rel, children: await walk(path.join(dir, ent.name), rel) });
    else out.push({ type:'file', path:rel, size:(await fs.stat(path.join(dir, ent.name))).size });
  }
  return out;
}

export const toolDefinitions = [
  { type:'function', function:{ name:'list_files', description:'List the project file tree.', parameters:{type:'object',properties:{},additionalProperties:false} }},
  { type:'function', function:{ name:'read_file', description:'Read a UTF-8 text file.', parameters:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false} }},
  { type:'function', function:{ name:'write_file', description:'Create or overwrite a project text file.', parameters:{type:'object',properties:{path:{type:'string'},content:{type:'string'}},required:['path','content'],additionalProperties:false} }},
  { type:'function', function:{ name:'edit_file', description:'Replace an exact text fragment in a project file.', parameters:{type:'object',properties:{path:{type:'string'},old_text:{type:'string'},new_text:{type:'string'}},required:['path','old_text','new_text'],additionalProperties:false} }},
  { type:'function', function:{ name:'delete_file', description:'Delete a project file.', parameters:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false} }},
  { type:'function', function:{ name:'search_code', description:'Search text across project files.', parameters:{type:'object',properties:{query:{type:'string'}},required:['query'],additionalProperties:false} }},
  { type:'function', function:{ name:'analyze_project', description:'Summarize project structure and common entry files.', parameters:{type:'object',properties:{},additionalProperties:false} }},
  { type:'function', function:{ name:'create_zip', description:'Create a downloadable ZIP archive of the entire project.', parameters:{type:'object',properties:{},additionalProperties:false} }}
];

export async function executeTool(id, name, args={}) {
  const root = rootFor(id);
  await fs.mkdir(root, {recursive:true});
  switch (name) {
    case 'list_files': return JSON.stringify(await walk(root));
    case 'read_file': {
      const p = safe(id, args.path); const buf = await fs.readFile(p); if (buf.includes(0)) throw new Error('Binary file cannot be read as text.');
      return (await fs.readFile(p,'utf8')).slice(0, 120000);
    }
    case 'write_file': { const p = safe(id,args.path); await fs.mkdir(path.dirname(p),{recursive:true}); await fs.writeFile(p,args.content,'utf8'); return `Wrote ${args.path}`; }
    case 'edit_file': { const p = safe(id,args.path); const old = await fs.readFile(p,'utf8'); if (!old.includes(args.old_text)) throw new Error('old_text not found.'); if ((old.match(new RegExp(escape(args.old_text),'g'))||[]).length > 1) throw new Error('old_text is not unique.'); await fs.writeFile(p,old.replace(args.old_text,args.new_text),'utf8'); return `Edited ${args.path}`; }
    case 'delete_file': { const p = safe(id,args.path); await fs.rm(p,{force:true}); return `Deleted ${args.path}`; }
    case 'search_code': {
      const hits=[]; async function scan(dir) { for (const ent of await fs.readdir(dir,{withFileTypes:true})) { if (IGNORE.has(ent.name)) continue; const p=path.join(dir,ent.name); if(ent.isDirectory()) await scan(p); else if(TEXT_EXT.has(path.extname(ent.name).toLowerCase())) { const s=await fs.readFile(p,'utf8').catch(()=>null); if(s?.toLowerCase().includes(String(args.query).toLowerCase())) hits.push({path:path.relative(root,p),snippet:s.slice(Math.max(0,s.toLowerCase().indexOf(String(args.query).toLowerCase())-160), Math.min(s.length,s.toLowerCase().indexOf(String(args.query).toLowerCase())+320))}); } if(hits.length>=50) return; }} await scan(root); return JSON.stringify(hits);
    }
    case 'analyze_project': { const tree=await walk(root); const files=tree.flatMap(flat); const counts={}; for(const f of files){const ext=path.extname(f.path)||'(none)';counts[ext]=(counts[ext]||0)+1;} const entries=['package.json','README.md','index.html','src/main.jsx','src/main.tsx','server.js','vite.config.js'].filter(x=>files.some(f=>f.path.replaceAll('\\','/')===x)); return JSON.stringify({fileCount:files.length,extensions:counts,entryCandidates:entries,root}); }
    case 'create_zip': { const zip=await createZipBuffer(root); return JSON.stringify({projectId:id,archiveBase64:zip.toString('base64'),size:zip.length}); }
    default: throw new Error(`Unknown tool: ${name}`);
  }
}
function flat(node){return node.flatMap(x=>x.type==='file'?[x]:flat(x.children||[]));}
function escape(s){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}

