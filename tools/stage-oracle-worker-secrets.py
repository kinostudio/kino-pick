"""Fixed B-only secret transition. Credential values never enter receipts or stdout."""
import hashlib,json,os,re,subprocess,sys,urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
WORKER=ROOT/'apps/worker'
PRIVATE=ROOT/'.local/oracle-private'
ACCOUNT='d3e930465c0df7e89b35de3ca65ea36a'
NAME='kino-pic-staging'
SOURCE='e6d4d68c1e3832a934fe0748d30d5a3dd69b3436'
OLD='671c3d15-5320-4d4a-a83e-e2363b962866'
OLD_SECRETS=sorted(['BETTER_AUTH_SECRET','GITHUB_CLIENT_ID','GITHUB_CLIENT_SECRET','R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY'])
NEW_SECRETS=['ORACLE_STORAGE_ACCESS_KEY_ID','ORACLE_STORAGE_SECRET_ACCESS_KEY']
API='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT
script='/workers/scripts/'+NAME
token_config=Path(os.environ['XDG_CONFIG_HOME'])/'.wrangler/config/default.toml'
match=re.search(r'(?m)^oauth_token\s*=\s*("[^"\r\n]*")\s*$',token_config.read_text())
token=json.loads(match.group(1)) if match else None
assert isinstance(token,str) and token, 'Isolated B OAuth unavailable'
def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def get(path):
 assert path.startswith(script) or path=='/workers/scripts?per_page=100', 'Unexpected API scope'
 req=urllib.request.Request(API+path,headers={'Authorization':'Bearer '+token})
 with urllib.request.urlopen(req,timeout=30) as response:
  payload=response.read(8*1024*1024+1);assert len(payload)<=8*1024*1024
 envelope=json.loads(payload);assert envelope.get('success') is True
 return envelope['result']
def public_assets():
 js=r'''import {createHash} from 'node:crypto';
 const origin='https://kino-pic-staging.kino-pick-aaron2026.workers.dev';
 async function read(path){const r=await fetch(origin+path,{redirect:'error',signal:AbortSignal.timeout(30000)});if(r.status!==200)throw Error('PUBLIC_ASSET_HTTP_'+r.status);const b=Buffer.from(await r.arrayBuffer());if(b.length>8*1024*1024)throw Error('PUBLIC_ASSET_TOO_LARGE');return b;}
 const html=await read('/');const paths=[...new Set([...html.toString().matchAll(/(?:src|href)=["'](\/assets\/[^"']+\.(?:js|css))["']/g)].map(m=>m[1]))].sort();
 if(paths.length<1||paths.length>12)throw Error('PUBLIC_ENTRY_ASSETS_MISSING');
 const out=[{path:'/',sha256:createHash('sha256').update(html).digest('hex')}];
 for(const path of paths)out.push({path,sha256:createHash('sha256').update(await read(path)).digest('hex')});console.log(JSON.stringify(out));'''
 result=subprocess.run(['node','--input-type=module','-e',js],capture_output=True,text=True,encoding='utf-8',timeout=120,check=True)
 return json.loads(result.stdout)
def capture():
 deployment=max(get(script+'/deployments')['deployments'],key=lambda item:item['created_on'])
 assert len(deployment['versions'])==1 and deployment['versions'][0]['percentage']==100
 version_id=deployment['versions'][0]['version_id']
 version=get(script+'/versions/'+version_id)
 versions=get(script+'/versions')
 items=versions.get('items',versions.get('versions',[])) if isinstance(versions,dict) else versions
 assert items, 'Latest version unavailable'
 latest=max(items,key=lambda item:item['number'])['id']
 settings=get(script+'/settings')
 bindings=settings.get('bindings',[])
 nonsecret=sorted([b for b in bindings if b.get('type') not in ['secret_text','secret_key','secret']],key=lambda b:b['name'])
 plain={b['name']:b['text'] for b in bindings if b.get('type')=='plain_text'}
 settings_clean={k:v for k,v in settings.items() if k not in ['bindings','annotations','last_deployed_from']}
 secrets=sorted(s['name'] for s in get(script+'/secrets'))
 scripts=get('/workers/scripts?per_page=100');matches=[s for s in scripts if s['id']==NAME];assert len(matches)==1
 routes=matches[0].get('routes');routes=[] if routes is None else routes;assert routes==[]
 out={'versionMetadata':{'id':version_id,'annotations':version.get('annotations',{}),'scriptEtag':version['resources']['script']['etag'],'handlers':version['resources']['script'].get('handlers',[]),'scriptRuntime':version['resources']['script_runtime'],'nonSecretBindings':nonsecret},'deployment':deployment,'latestVersionId':latest,'plainVars':plain,'settingsHash':digest(settings_clean),'secretNames':secrets,'subdomain':get(script+'/subdomain'),'schedules':get(script+'/schedules'),'routes':routes,'publicEntryAssets':public_assets()}
 verify=max(get(script+'/deployments')['deployments'],key=lambda item:item['created_on'])
 assert deployment==verify, 'Deployment changed during capture'
 return out

assert sys.argv[1:] in [['--prepare'],['--apply'],['--verify']], 'Explicit fixed operation required'
mode=sys.argv[1]
before_path=PRIVATE/'secret-stage-before.json'
if mode=='--prepare':
 before=capture()
 assert before['versionMetadata']['id']==OLD and before['latestVersionId']==OLD
 assert SOURCE in before['versionMetadata']['annotations'].get('workers/message','')
 assert before['secretNames']==OLD_SECRETS
 with before_path.open('x') as stream:json.dump(before,stream)
 print(json.dumps({'status':'prepared','baselineVersion':OLD,'latestEqualsActive':True,'publicEntryAssets':len(before['publicEntryAssets'])}))
 sys.exit(0)
before=json.loads(before_path.read_text())
if mode=='--apply':
 assert capture()==before, 'Live baseline changed; stop before secrets'
 credentials=json.loads((PRIVATE/'storage.json').read_text())
 assert credentials['endpoint']=='https://drive.kinostudio.tw' and credentials['bucketName']=='kino-pick-overflow'
 payload={'ORACLE_STORAGE_ACCESS_KEY_ID':credentials['accessKeyId'],'ORACLE_STORAGE_SECRET_ACCESS_KEY':credentials['secretAccessKey']}
 secret_file=PRIVATE/'worker-secret-bulk.json'
 with secret_file.open('x') as stream:json.dump(payload,stream)
 result=subprocess.run(['node','node_modules/wrangler/bin/wrangler.js','secret','bulk',str(secret_file),'--config','wrangler.collaboration-validation.jsonc'],cwd=WORKER,capture_output=True,text=True,encoding='utf-8',timeout=120)
 (PRIVATE/'secret-stage-cli.log').write_text(result.stdout+'\n'+result.stderr,encoding='utf-8')
 if result.returncode:raise SystemExit('Secret staging failed; private log retained, no values printed')
after=capture()
assert after['secretNames']==sorted(OLD_SECRETS+NEW_SECRETS)
assert after['versionMetadata']['id']!=OLD and after['latestVersionId']==after['versionMetadata']['id']
parity={'latestWasActive':before['latestVersionId']==OLD}
for key in ['scriptEtag','handlers','scriptRuntime','nonSecretBindings']:
 parity[key]=before['versionMetadata'][key]==after['versionMetadata'][key]
for key in ['plainVars','settingsHash','subdomain','schedules','routes','publicEntryAssets']:
 parity[key]=before[key]==after[key]
parity['onlyTwoSecretsAdded']=set(after['secretNames'])-set(before['secretNames'])==set(NEW_SECRETS)
assert all(parity.values()), 'Secret-only transition parity failed; preserve evidence and stop'
receipt=ROOT/'.local/oracle-release-20261106/docs/releases/collaboration-prior-deployment.json'
proof={'schemaVersion':1,'status':'passed_B_secret_only_transition','accountId':ACCOUNT,'workerName':NAME,'sourceSha':SOURCE,'priorVersionId':OLD,'versionId':after['versionMetadata']['id'],'priorDeploymentId':before['deployment']['id'],'deploymentId':after['deployment']['id'],'priorReceiptSha256':hashlib.sha256(receipt.read_bytes().replace(b'\r\n',b'\n')).hexdigest(),'before':before,'after':after,'parity':parity,'expectedNewSecrets':NEW_SECRETS,'assetScope':'Known public entry JS/CSS plus homepage parity; full asset manifest identity unavailable'}
out=ROOT/'docs/releases/oracle-secret-stage-baseline.json'
with out.open('x') as stream:json.dump(proof,stream,indent=2)
print(json.dumps({'status':proof['status'],'versionId':proof['versionId'],'parity':parity,'secretValuesPrinted':False}))
