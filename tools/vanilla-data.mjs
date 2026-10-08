// Preserve a complete, auditable upstream roster separately from the Rhine overlay.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

// The pristine upstream v0.2.0 tree (the second parent of the "并入上游 v0.2.0" merge 92826b5). The vanilla profile
// must stay byte-for-byte this upstream roster; the Rhine overlay is applied only to the root data/ profile.
export const VANILLA_UPSTREAM_VERSION = '0.2.0';
export const VANILLA_UPSTREAM_COMMIT = '1303321407f9a9b80c68e0a4d47b40871a5d06c3';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function writeVanillaData(files,out,{source='build-data before the Rhine overlay',upstreamVersion=VANILLA_UPSTREAM_VERSION}={}){
  await fs.mkdir(out,{recursive:true});
  for(const [name,record] of Object.entries(files)){
    if(!/^[a-z][a-z-]*$/.test(name)||name==='manifest')throw new Error('Invalid vanilla data name');
    const dest=path.join(out,name+'.json'),tmp=dest+'.tmp-'+process.pid;
    await fs.writeFile(tmp,JSON.stringify(record));await fs.rename(tmp,dest);
  }
  const entries=[];
  for(const name of (await fs.readdir(out)).filter(n=>n.endsWith('.json')&&n!=='manifest.json').sort()){
    const bytes=await fs.readFile(path.join(out,name));JSON.parse(bytes.toString('utf8'));
    entries.push({path:name,size:bytes.length,sha256:hash(bytes)});
  }
  await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify({schemaVersion:1,profile:'vanilla',upstreamVersion,source,files:entries},null,2)+'\n');
}

async function snapshot(){
  const out=path.join(ROOT,'data','vanilla');
  const git=(...args)=>execFileSync('git',['-C',ROOT,...args],{windowsHide:true,maxBuffer:32*1024*1024});
  // Top-level data/<name>.json plus the localised data/i18n/<lang>.json; never the Rhine-only data/vanilla snapshot.
  const paths=git('ls-tree','--name-only','-r',VANILLA_UPSTREAM_COMMIT,'data/').toString('utf8').trim().split(/\r?\n/)
    .filter(rel=>/^data\/[a-z-]+\.json$/.test(rel)||/^data\/i18n\/[a-zA-Z-]+\.json$/.test(rel));
  await fs.mkdir(path.join(out,'i18n'),{recursive:true});
  const entries=[];
  for(const rel of paths){
    const bytes=git('show',`${VANILLA_UPSTREAM_COMMIT}:${rel}`);JSON.parse(bytes.toString('utf8'));
    const dest=path.join(out,rel.slice('data/'.length));
    await fs.mkdir(path.dirname(dest),{recursive:true});
    await fs.writeFile(dest,bytes);
    entries.push({path:rel.slice('data/'.length),size:bytes.length,sha256:hash(bytes)});
  }
  entries.sort((a,b)=>a.path.localeCompare(b.path));
  await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify({schemaVersion:1,profile:'vanilla',upstreamVersion:VANILLA_UPSTREAM_VERSION,source:VANILLA_UPSTREAM_COMMIT,files:entries},null,2)+'\n');
  console.log(`Preserved ${entries.length} exact upstream v${VANILLA_UPSTREAM_VERSION} data files in data/vanilla.`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await snapshot();
