import json,pathlib
r=pathlib.Path('/tmp/flow-v2-server-probe')
result=json.loads((r/'automatic-extension-result.json').read_text())
plugin=[json.loads(l) for l in (r/'extension-plugin.jsonl').read_text().splitlines()]
raw=[json.loads(l) for l in (r/'plugin.jsonl').read_text().splitlines()]
provider=[json.loads(l) for l in (r/'provider.jsonl').read_text().splitlines()]
checklist=[]
def check(name,value):
 assert value,name
 checklist.append(name)
check('four extension cases passed',result['status']=='PASS' and len(result['cases'])==4)
for case in result['cases']:
 mode=case['mode'];sid=case['sessionID'];hooks=[x for x in plugin if x['data'].get('sessionID')==sid]
 native=[x for x in raw if isinstance(x.get('data'),dict) and (x['data'].get('sessionID')==sid or x['data'].get('execution',{}).get('sessionID')==sid)]
 check(mode+' exact admission receipt',any(x['type']=='ext-admitted' and x['data']['receipt']['id']==case['inputID'] for x in hooks))
 if mode.startswith('compact'):
  check(mode+' genuine automatic compaction',case['compaction']['reason']=='auto' and case['compaction']['status']=='completed')
  control=next(x['data']['control'] for x in hooks if x['type']=='ext-compaction-control')
  check(mode+' synchronous running control identity',control['id']==case['compaction']['id'] and control['status']=='running' and control['reason']=='auto')
  enter=next(x['data'] for x in hooks if x['type']=='ext-compaction-enter')
  check(mode+' compaction consumes original dispatch',enter['consumed']==[case['inputID']] and enter['epoch']==1 and enter['revoked'] is False)
  stream_active=False;generation=0;assistant_generation={}
  for x in native:
   d=x['data']
   if x['type']=='context-snapshot':
    check(mode+' primary context waits for stream end',not stream_active);generation+=1
   elif x['type']=='primary-stream-start':
    check(mode+' primary response streams do not overlap',not stream_active and d['n']==1);stream_active=True
   elif x['type']=='primary-stream-end':stream_active=False
   elif x['type']=='execute.before':assistant_generation.setdefault(d['messageID'],generation)
   if x['type'] in ['execute.before','execute.after']:
    check(mode+' old assistant tools precede next primary context',assistant_generation[d['messageID']]==generation)
  if mode=='compact-uninterrupted':
   carries=[x['data'] for x in hooks if x['type']=='ext-continuity']
   check('same epoch crosses exact compaction control',bool(carries) and all(x['epoch']==1 and x['controlID']==control['id'] and x['priorConsumed']==[case['inputID']] and x['consumed']==[control['id']] and x['summaryAuthority'] is False for x in carries))
   post=next(x['data'] for x in hooks if x['type']=='ext-tool-authorized' and x['data']['execution']['id']=='call_post_compaction')
   check('post-compaction tool retains epoch one',post['epoch']==1)
   before=next(x['data'] for x in hooks if x['type']=='ext-tool-attempt' and x['data']['execution']['id']=='call_post_compaction')
   i=next(i for i,m in enumerate(before['native']) if m['id']==before['execution']['messageID']);assistant=before['native'][i]
   check('post-compaction exact assistant and call',assistant['agent']==before['execution']['agent'] and any(c['type']=='tool' and c['id']=='call_post_compaction' and c['name']==before['execution']['tool'] for c in assistant['content']))
   check('post-compaction prefix matches frozen consumed control',[m['id'] for m in before['native'][:i] if m['type'] in ['user','synthetic','compaction']]==[m['id'] for m in before['primary']['snapshot']['messages'] if m['role']=='user']==[control['id']])
  else:
   revoked=next(i for i,x in enumerate(hooks) if x['type']=='ext-revoked')
   check('real steer occurs inside compaction interval',next(i for i,x in enumerate(hooks) if x['type']=='ext-compaction-enter')<revoked<next(i for i,x in enumerate(hooks) if x['type']=='ext-compaction-exit'))
   check('steer vetoes resumed automatic context',any(x['type']=='ext-context-rejected' for x in hooks[revoked+1:]))
   check('local provider receives no resumed steered request',sum(x.get('sessionID')==sid for x in provider)==1)
   check('no provider dispatch after compaction steer',not any(x['type']=='ext-primary-dispatch' for x in hooks[revoked+1:]) and len([x for x in native if x['type']=='http.request'])==1)
   check('no authority after compaction steer',not any(x['type']=='ext-tool-authorized' for x in hooks[revoked+1:]))
 if mode=='stale-context':
  check('stale synthetic reaches context and is rejected',any(x['type']=='ext-context-rejected' for x in hooks))
  check('local provider receives zero stale-context requests',not any(x.get('sessionID')==sid for x in provider))
  check('stale context prevents every HTTP request',not any(x['type']=='http.request' for x in native))
  check('stale context prevents every tool',not any(x['type']=='execute.before' for x in native))
 if mode=='stale-tool':
  reject=next(x['data']['execution'] for x in hooks if x['type']=='ext-tool-rejected')
  check('before-tool veto targets exact native shell',reject['tool']=='shell' and 'extension-native-effect' in reject['input']['command'])
  effect=reject['input']['command'].split(' > ',1)[1]
  check('rejected native shell effect file absent',not pathlib.Path(effect).exists())
  check('rejected native shell never reaches shell creation',not any(x['type']=='ext-native-shell-created' and effect in x['data']['command'] for x in plugin))
  messages=[json.loads(l) for l in (r/'automatic-extension.jsonl').read_text().splitlines()]
  transcript=next(x['data']['data'] for x in reversed(messages) if x['type']=='stale-tool-messages')
  assistant=next(m for m in transcript if m['id']==reject['messageID'])
  call=next(c for c in assistant['content'] if c['type']=='tool' and c['id']==reject['id'])
  check('native tool reports rejection rather than success',call['state']['status']=='error' and 'EXTENSION_REVOKED_BEFORE_NATIVE_TOOL' in call['state']['error']['message'])
receipt={'status':'PASS','run':result['run'],'host':'OpenCode 2.1.4 Darwin arm64','checks':checklist,'cases':result['cases'],'scope':'Bounded local scripted HTTP provider. No product integration certification.','supportedConditions':['Exact admitted synthetic ID and private live epoch exist before positive authority.','Freeze primary context and Request identity; reject overlap or immutable assistant binding conflicts.','Read and freeze running native auto-compaction ID in the synchronous compaction hook.','At resumed context, require that exact completed auto-compaction ID and unchanged live epoch.','Reject unknown inputs and real steer; do not recover authority from summary text.','Before every native tool, verify exact assistant/call identity, frozen input prefix, and unrevoked epoch.']}
(r/'extension-verification.json').write_text(json.dumps(receipt,indent=2));print('PASS',len(checklist),'extension assertions')
