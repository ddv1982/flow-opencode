import {OpenCode} from '@opencode/client';
import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
const root='/tmp/flow-v2-server-probe';const password=readFileSync(root+'/server.stdout','utf8').match(/server password (.+)/)[1];const c=OpenCode.make({baseUrl:'http://127.0.0.1:47841',headers:{authorization:'Basic '+Buffer.from('opencode:'+password).toString('base64'),'x-opencode-directory':root+'/workspace'}});
const log=(type,data)=>{appendFileSync(root+'/automatic-extension.jsonl',JSON.stringify({type,data})+'\n');console.log(type,JSON.stringify(data).slice(0,800))};const opts=()=>({signal:AbortSignal.timeout(12000)});const run=Date.now().toString();log('run',run);
const rows=()=>existsSync(root+'/extension-plugin.jsonl')?readFileSync(root+'/extension-plugin.jsonl','utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
const waitLog=async(test)=>{const deadline=Date.now()+7000;while(Date.now()<deadline){const found=rows().find(test);if(found)return found;await new Promise(r=>setTimeout(r,20))}throw Error('Required extension hook not observed')};
const results=[];
for(const mode of ['compact-uninterrupted','compact-steer','stale-context','stale-tool']){
 let session;
 try{
  session=await c.session.create({title:'extension '+mode,agent:'build',model:{providerID:'flowprobe',id:'probe'},location:{directory:root+'/workspace'}});log(mode+'-session',session);
  const inputID='msg_ext_'+mode.replaceAll('-','_')+'_'+run;
  const effect=root+'/extension-native-effect-'+run;
  const text=mode.startsWith('compact')?'AUTO_COMPACT_'+mode.replaceAll('-','_').toUpperCase()+'_'+run+' PROBE [{"tool":"probe_plain"}]':mode==='stale-context'?'PROBE [{"tool":"probe_plain"}]':'DELAY PROBE '+JSON.stringify([{tool:'shell',input:{command:'printf forbidden > '+effect}}]);
  await c.session.command({sessionID:session.id,name:'probe-auto',text:JSON.stringify({mode,id:inputID,text})},opts());log(mode+'-command-returned',{inputID});
  if(mode==='compact-steer'){
   await waitLog(x=>x.type==='ext-compaction-enter'&&x.data.sessionID===session.id);
   log(mode+'-steer',await c.session.prompt({sessionID:session.id,text:'Real new direction fences prior automatic authority',metadata:{extensionSteer:true},delivery:'steer'},opts()));
  }
  if(mode==='stale-tool'){
   await waitLog(x=>x.type==='ext-primary-dispatch'&&x.data.sessionID===session.id);
   log(mode+'-steer',await c.session.prompt({sessionID:session.id,text:'Stop automatic native effect',metadata:{extensionSteer:true},delivery:'steer'},opts()));
  }
  await c.session.wait({sessionID:session.id},opts());
  log(mode+'-messages',await c.message.list({sessionID:session.id},opts()));
  const native=await c.session.context({sessionID:session.id},opts());log(mode+'-context',native);
  const hooks=rows().filter(x=>x.data.sessionID===session.id);log(mode+'-hooks',hooks);
  const compact=native.find(m=>m.type==='compaction');
  if(mode==='compact-uninterrupted'){
   if(!compact||compact.reason==='manual'||compact.status!=='completed')throw Error('Automatic compaction did not complete');
   if(!hooks.some(x=>x.type==='ext-continuity'))throw Error('No post-compaction continuity snapshot');
   if(!hooks.some(x=>x.type==='ext-tool-authorized'&&x.data.execution.id==='call_post_compaction'&&x.data.epoch===1))throw Error('No post-compaction authorized tool under original epoch');
  }
  if(mode==='compact-steer'){
   if(!compact||compact.reason==='manual'||compact.status!=='completed')throw Error('Steered automatic compaction did not complete');
   const revoked=hooks.findIndex(x=>x.type==='ext-revoked');
   if(revoked<0||hooks.slice(revoked+1).some(x=>x.type==='ext-primary-dispatch'||x.type==='ext-tool-authorized'))throw Error('Automatic authority survived real steer');
   if(!hooks.some(x=>x.type==='ext-context-rejected'))throw Error('No stale resumed context rejection');
  }
  if(mode==='stale-context'){
   if(!hooks.some(x=>x.type==='ext-context-rejected')||hooks.some(x=>x.type==='ext-primary-dispatch'||x.type==='ext-tool-attempt'))throw Error('Stale synthetic reached provider or tool');
  }
  if(mode==='stale-tool'){
   if(!hooks.some(x=>x.type==='ext-tool-rejected'&&x.data.execution.tool==='shell'))throw Error('Native shell was not rejected at before-tool boundary');
   if(existsSync(effect))throw Error('Rejected native shell still wrote its effect file');
   if(hooks.some(x=>x.type==='ext-native-shell-created'))throw Error('Rejected native shell reached shell-create boundary');
   log('native-effect-absent',{path:effect,absent:!existsSync(effect)});
  }
  results.push({mode,status:'PASS',sessionID:session.id,inputID,compaction:compact?{id:compact.id,reason:compact.reason,status:compact.status}:null});
 }catch(error){const failure={mode,status:'ISSUES',sessionID:session?.id,error:String(error)};results.push(failure);log('case-failed',failure);if(session)try{await c.session.interrupt({sessionID:session.id,resume:false},opts())}catch{}}
}
const result={status:results.every(x=>x.status==='PASS')?'PASS':'ISSUES',run,cases:results};writeFileSync(root+'/automatic-extension-result.json',JSON.stringify(result,null,2));console.log('RESULT',JSON.stringify(result));
