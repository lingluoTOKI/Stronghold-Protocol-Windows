"""Read-only PC skin audit/export. Export exact named official sprites and prefab-bound models."""
import argparse, json, re, subprocess, hashlib
from pathlib import Path
import aklz4
import UnityPy
from extract import prefab_spine_nodes, write_spine

p=argparse.ArgumentParser();p.add_argument('bundles');p.add_argument('--root',default='.');a=p.parse_args()
root=Path(a.root).resolve();ab=Path(a.bundles);out=root/'public/assets/local';out.mkdir(parents=True,exist_ok=True)
manifest=json.loads((root/'data/assets.json').read_text(encoding='utf-8'))
roster=set(manifest['chars']);chars={};groups={};errors=[];provenance=[]
pattern=re.compile(r'^(char_\d+_[a-z0-9]+)_(.+#\d+)$')
def identity(name):
 m=pattern.fullmatch(name)
 return (m[1],m[1]+'@'+m[2]) if m and m[1] in roster else None
def entry(cid,sid):
 return chars.setdefault(cid,{'skins':{}})['skins'].setdefault(sid,{})
def log(s):
 if 'warn' in s: errors.append(s)
for field,glob in [('portrait','char_portrait_*.ab'),('avatar','ui_char_avatar_*.ab')]:
 for bundle in sorted((ab/'spritepack').glob(glob)):
  try:
   env=UnityPy.load(str(bundle));count=0
   for obj in env.objects:
    if obj.type.name!='Sprite':continue
    d=obj.read();key=identity(d.m_Name)
    if not key:continue
    cid,sid=key;im=d.image;name=d.m_Name.replace('#','_')+'.png'
    folder=out/'official-skins'/field;folder.mkdir(parents=True,exist_ok=True);dest=folder/name
    im.save(dest);entry(cid,sid)[field]='/assets/local/official-skins/'+field+'/'+name
    provenance.append({'skin':sid,'field':field,'bundle':str(bundle.relative_to(ab)),'sprite':d.m_Name,'size':list(im.size),'sha256':hashlib.sha256(dest.read_bytes()).hexdigest()});count+=1
   print(field,bundle.name,count,flush=True)
  except Exception as e:errors.append(str(bundle)+': '+str(e))
for index,cid in enumerate(sorted(roster)):
 bundle=ab/'skinpack'/(cid+'.ab')
 if not bundle.exists():continue
 try:
  env=UnityPy.load(str(bundle));objects={o.path_id:o for o in env.objects}
  for path,ref in env.container.items():
   if '/battle/prefabs/skins/character/' not in path or not path.endswith('.prefab'):continue
   name=Path(path).stem;key=identity(name)
   if not key:continue
   _,sid=key
   nodes=prefab_spine_nodes(ref.read_typetree(),objects)
   for face in ['front','back']:
    node=next((n for n in nodes if n[0].lower()==face),None)
    sda=objects.get(node[2]['m_PathID']) if node and not node[2].get('m_FileID') else None
    if not sda:continue
    sub='official-skins/spine/'+name.replace('#','_')+'/'+face
    if not write_spine(objects,sda.read_typetree(),sub,name,out,groups,log):continue
    files=groups[sub];skel=next(k for k in files if k.endswith('.skel'))
    meta=json.loads(subprocess.check_output(['node',str(root/'tools/local-extract/plugin-art.mjs'),'--spine',str(out/sub/skel)],timeout=30))
    entry(cid,sid).setdefault('spine',{})[face]={**meta,'skel':files[skel]['path'],'atlas':files[skel[:-5]+'.atlas']['path'],'textures':[files[k]['path'] for k in files if k.endswith('.png')]}
   provenance.append({'skin':sid,'field':'spine','bundle':str(bundle.relative_to(ab)),'prefab':path})
  print('models',index+1,cid,flush=True)
 except Exception as e:errors.append(str(bundle)+': '+str(e))
# Sprite names preserve case; prefab container paths are lowercased by Unity.
for cid,c in chars.items():
 skins=c['skins'];canonical={sid.casefold():sid for sid,v in skins.items() if v.get('portrait') or v.get('avatar')}
 for sid in list(skins):
  dest=canonical.get(sid.casefold(),sid)
  if dest!=sid:
   extra=skins.pop(sid)
   if extra.get('spine'):skins[dest]['spine']=extra['spine']
# Literal # in Unity page names must not become URL fragments.
for file in list((out/'official-skins').rglob('*')):
 if not file.is_file():continue
 if file.suffix=='.atlas':file.write_text(file.read_text(encoding='utf-8').replace('#','_'),encoding='utf-8')
 if '#' in file.name:file.rename(file.with_name(file.name.replace('#','_')))
def clean_urls(v):
 if isinstance(v,str) and v.startswith('/assets/'):return v.replace('#','_')
 if isinstance(v,dict):return {k:clean_urls(x) for k,x in v.items()}
 if isinstance(v,list):return [clean_urls(x) for x in v]
 return v
chars=clean_urls(chars)
# Names are supplied by the installed catalogue when known. Never guess another skin's identity.
for cid,c in chars.items():
 for sid,v in c['skins'].items():
  old=manifest['chars'].get(cid,{}).get('skins',{}).get(sid,{})
  v['name']=old.get('name') or sid.split('@')[1];v['group']=old.get('group') or 'Official'
# Preserve explicitly checked contract models when this PC bundle has no extracted model.
fallback_path=root/'tools/assets/contract-skin-models.json'
if fallback_path.exists():
 for sid,model in json.loads(fallback_path.read_text(encoding='utf-8')).items():
  skin=chars.get(sid.split('@')[0],{}).get('skins',{}).get(sid)
  if skin is not None and not skin.get('spine',{}).get('front'):
   skin['spine']=model
report={'operators':len(chars),'skins':sum(len(c['skins']) for c in chars.values()),'errors':errors,'provenance':provenance}
(root/'tools/assets/official-skins.json').write_text(json.dumps(chars,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
r=root/'output/official-skins-audit.json';r.parent.mkdir(exist_ok=True);r.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print('DONE',report['operators'],report['skins'],'errors',len(errors),flush=True)
