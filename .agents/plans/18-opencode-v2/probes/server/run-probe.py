import argparse,base64,json,os,pathlib,signal,subprocess,time,urllib.request
r=pathlib.Path('/tmp/flow-v2-server-probe')
parser=argparse.ArgumentParser()
parser.add_argument('--exe',default='/tmp/flow-opencode-v2-plan-host/npm-cache/_npx/2314e955696d2fea/node_modules/@opencode/cli-darwin-arm64/bin/opencode')
parser.add_argument('--extension-only',action='store_true')
a=parser.parse_args()
for name in ['home','config','data','cache','state','workspace','tmp']:(r/name).mkdir(exist_ok=True)
env={'PATH':'/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin','HOME':str(r/'home'),'XDG_CONFIG_HOME':str(r/'config'),'XDG_DATA_HOME':str(r/'data'),'XDG_CACHE_HOME':str(r/'cache'),'XDG_STATE_HOME':str(r/'state'),'TMPDIR':str(r/'tmp')}
if not (r/'node_modules/@opencode/client').exists():subprocess.run(['npm','install','--prefix',str(r),'--cache',str(r/'npm-cache'),'--ignore-scripts','--no-audit','--no-fund','@opencode/client@2.1.4','@opencode/plugin@2.1.4'],env=env,cwd=r,check=True)
for name in ['launch.json','provider.pid']:
 p=r/name
 if p.exists():
  pid=json.loads(p.read_text())['pid'] if name=='launch.json' else int(p.read_text())
  command=subprocess.run(['/bin/ps','-p',str(pid),'-o','command='],capture_output=True,text=True).stdout
  if str(r) in command or a.exe in command:
   try:os.kill(pid,signal.SIGTERM)
   except ProcessLookupError:pass
version=subprocess.run([a.exe,'--version'],env=env,cwd=r,capture_output=True,text=True,check=True).stdout.strip()
assert version=='opencode v2.1.4',version
(r/'version.json').write_text(json.dumps({'stdout':version,'executable':a.exe}))
argv=[a.exe,'serve','--hostname','127.0.0.1','--port','47841']
server=subprocess.Popen(argv,env=env,cwd=r/'workspace',stdout=open(r/'server.stdout','w'),stderr=open(r/'server.stderr','w'),start_new_session=True)
(r/'launch.json').write_text(json.dumps({'pid':server.pid,'argv':argv,'cwd':str(r/'workspace'),'env':env},indent=2))
os.chmod(r/'server.stdout',0o600)
provider=subprocess.Popen(['node',str(r/'fake-provider.mjs')],env=env,cwd=r,stdout=open(r/'provider.stdout','w'),stderr=open(r/'provider.stderr','w'),start_new_session=True)
(r/'provider.pid').write_text(str(provider.pid))
try:
 deadline=time.monotonic()+10
 while time.monotonic()<deadline:
  text=(r/'server.stdout').read_text()
  if 'server password ' in text:break
  assert server.poll() is None,'server exited'
  time.sleep(.02)
 password=text.split('server password ',1)[1].splitlines()[0]
 auth='Basic '+base64.b64encode(('opencode:'+password).encode()).decode()
 request=urllib.request.Request('http://127.0.0.1:47841/api/info',headers={'Authorization':auth})
 with urllib.request.urlopen(request,timeout=3) as response:health=json.load(response)
 assert health['pid']==server.pid and health['version']=='2.1.4',health
 (r/'health.json').write_text(json.dumps(health,indent=2))
 names=['inspect','automatic-extension'] if a.extension_only else ['inspect','run-cases','extended','interleavings','steer','final-edges','static-check','log-check','automatic-extension']
 for name in names:
  with open(r/(name+'.stdout'),'w') as out:subprocess.run(['node',str(r/(name+'.mjs'))],env=env,cwd=r,stdout=out,stderr=subprocess.STDOUT,timeout=35,check=True)
 ready=r/'shutdown-ready'
 if ready.exists():ready.unlink()
 watcher=subprocess.Popen(['node',str(r/'shutdown-watch.mjs')],env=env,cwd=r)
 deadline=time.monotonic()+4
 while time.monotonic()<deadline and not ready.exists():time.sleep(.02)
 assert ready.exists(),'shutdown subscriber did not connect'
 server.terminate();server.wait(timeout=6);watcher.wait(timeout=10)
 assert json.loads((r/'shutdown.json').read_text())['ended']
 if not a.extension_only:subprocess.run(['python3',str(r/'verify.py')],env=env,cwd=r,check=True)
 subprocess.run(['python3',str(r/'verify-extension.py')],env=env,cwd=r,check=True)
 print('PASS isolated runtime probes. See extension-verification.json and report.md.')
finally:
 for process in [provider,server]:
  if process.poll() is None:
   process.terminate()
   try:process.wait(timeout=5)
   except subprocess.TimeoutExpired:process.kill();process.wait()
