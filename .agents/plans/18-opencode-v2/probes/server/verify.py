import collections,json,pathlib
r=pathlib.Path('/tmp/flow-v2-server-probe')
def rows(name):return [json.loads(line) for line in (r/name).read_text().splitlines() if line.strip()]
def last(xs,kind):return next(x['data'] for x in reversed(xs) if x['type']==kind)
p=rows('plugin.jsonl');extended=rows('extended.jsonl');inter=rows('interleavings.jsonl');steer=rows('steer.jsonl');edges=rows('edges.jsonl');checks=[]
def check(name,value):
 assert value,name
 checks.append(name)
check('exact host health',json.loads((r/'health.json').read_text())['version']=='2.1.4')
check('plugin options and lifecycle',any(x['type']=='setup' and x['data']['options']=={'receipt':'isolated-options'} for x in p) and any(x['type']=='cleanup' for x in p))
check('missing update invokes callback',any(x['type']=='missing-callback' and x['data'] is True for x in p))
check('reserved agents created',{'flow-planner','flow-worker','flow-reviewer'} <= {a['id'] for a in last(extended,'reserved-agents')})
check('native child parentage',last(extended,'flow-worker')['parentID'] is not None)
worker=last(extended,'flow-worker')['id'];reviewer=last(extended,'flow-reviewer')['id']
check('allowed custom effects',{'plain-effect','declared-effect','explicit-effect'} <= {x['type'] for x in p if isinstance(x.get('data'),dict) and x['data'].get('sessionID')==reviewer})
check('denied custom effects absent',not any(x['type'] in ['plain-effect','declared-effect','explicit-effect'] and x['data']['sessionID']==worker for x in p))
check('explicit denial has native error',any(x['type']=='execute.after' and x['data']['sessionID']==worker and x['data']['tool']=='probe_explicit' and x['data']['status']=='error' for x in p))
check('shell nonzero remains completed',any(x['type']=='execute.after' and x['data']['tool']=='shell' and x['data']['status']=='completed' and x['data']['result'].get('metadata',{}).get('exit')==7 for x in p))
check('shell execution error',any(x['type']=='execute.after' and x['data']['tool']=='shell' and x['data']['status']=='error' for x in p))
check('shell timeout lacks exit',any(x['type']=='execute.after' and x['data']['tool']=='shell' and x['data']['status']=='completed' and x['data']['result'].get('metadata',{}).get('timeout') is True and 'exit' not in x['data']['result']['metadata'] for x in p))
check('exact full output file',last(extended,'full-output')['exact'] and last(extended,'full-output')['size']==132000)
check('exact full output API',last(extended,'shell-output')['data']['exact'] and last(extended,'shell-output')['data']['truncated'] is False)
race=last(inter,'race');raceid=race[0]['value']['id'];session=last(inter,'session')['id'];events=last(inter,'all-events')
check('duplicate admission converges',all(x['status']=='fulfilled' and x['value']['id']==raceid for x in race))
check('duplicate hooks run twice',sum(x['type']=='prompt' and x['data']['messageID']==raceid for x in p)==2)
check('duplicate creates one enqueue',sum(e['type']=='session.inbox.enqueued' and e['data']['inboxID']==raceid for e in events)==1)
check('rejected hook prevents admission',last(inter,'rejected-admission')[0]['status']=='rejected')
check('real interruption',last(inter,'interrupt')['interrupted'] is True and any(m['type']=='idle' and m['outcome']=='interrupted' for m in last(inter,'interrupt-messages')['data']))
check('compaction retained post input',any(m['type']=='user' and m.get('metadata',{}).get('owned')=='after-compaction' for m in last(edges,'compacted-context')))
check('static agent public lookup',last(edges,'static-agent')['data']['id']=='flow-static-probe' and last(edges,'static-listed') is True)
joined=[]
for phase in ['http-pending','tool-running']:
 s=last(steer,phase+'-session')['id'];initial=last(steer,phase+'-initial')['id'];human=last(steer,phase+'-steer')['id']
 starts=[x['data'] for x in p if x['type']=='primary-stream-start' and x['data']['sessionID']==s]
 check(phase+' primary streams do not overlap',bool(starts) and all(x['n']==1 for x in starts))
 check(phase+' response joins same Request',all(x['data']['requestMatched'] for x in p if x['type']=='http.response' and x['data']['sessionID']==s))
 joins=[x['data'] for x in p if x['type']=='execute.before-context' and isinstance(x.get('data'),dict) and x['data']['execution']['sessionID']==s]
 origins={}
 for j in joins:
  execution=j['execution'];messages=j['messages'];i=next(i for i,m in enumerate(messages) if m['id']==execution['messageID']);assistant=messages[i];inputs=[m['id'] for m in messages[:i] if m['type'] in ['user','synthetic']];consumed=[m['id'] for m in j['current']['snapshot']['messages'] if m['role']=='user']
  check(phase+' exact assistant and call '+execution['tool'],assistant['type']=='assistant' and assistant['agent']==execution['agent'] and any(c['type']=='tool' and c['id']==execution['id'] and c['name']==execution['tool'] for c in assistant['content']))
  check(phase+' frozen inputs equal assistant prefix '+execution['tool'],inputs==consumed)
  origins[execution['tool']]=consumed[-1]
  joined.append({'phase':phase,'assistant':execution['messageID'],'call':execution['id'],'tool':execution['tool'],'requestSeq':j['current']['requestSeq'],'consumedInputIDs':consumed})
 check(phase+' old execution not relabeled',origins.get('probe_plain' if phase=='http-pending' else 'probe_hold')==initial and origins.get('probe_explicit')==human)
 local=[x for x in p if isinstance(x.get('data'),dict) and (x['data'].get('sessionID')==s or x['data'].get('execution',{}).get('sessionID')==s)]
 active=False;context_generation=0;assistant_generation={}
 for x in local:
  d=x['data']
  if x['type']=='context-snapshot':
   check(phase+' context waits for preceding primary stream',not active);context_generation+=1
  elif x['type']=='primary-stream-start':active=True
  elif x['type']=='primary-stream-end':active=False
  elif x['type']=='execute.before':assistant_generation.setdefault(d['messageID'],context_generation)
  if x['type'] in ['execute.before','execute.after']:
   check(phase+' old assistant tool stays before next primary context',assistant_generation[d['messageID']]==context_generation)
check('client subscriber terminates on host shutdown',json.loads((r/'shutdown.json').read_text())['ended'])
result={'status':'PASS','meaning':'Disposable assertions passed. This is not an integrated Flow certification.','checks':checks,'causalJoins':joined,'limitations':['Only scripted local OpenAI-compatible provider and Darwin arm64 tested.','No general primary-request serialization guarantee claimed. Fail closed on overlap or unknown joins.','No complete async event prefix or durable replay established.','Automatic compaction during a live automatic turn remains unverified.','Revocation of an already running operation requires parent integration design and checks.']}
(r/'verification.json').write_text(json.dumps(result,indent=2));print('PASS',len(checks),'runtime assertions')
