import {appendFileSync} from 'node:fs';
export async function setupExtension(ctx,log,snapshots,current){
 const states=new Map();
 const bindings=new Map();
 const ids=messages=>messages.filter(m=>m.role==='user'&&m.id).map(m=>m.id);
 const nativeInputs=messages=>messages.filter(m=>m.type==='user'||m.type==='synthetic').map(m=>({id:m.id,type:m.type,metadata:m.metadata}));
 const record=(type,data)=>{log(type,data);appendFileSync('/tmp/flow-v2-server-probe/extension-plugin.jsonl',JSON.stringify({type,data})+'\n')};
 await ctx.command.transform(editor=>editor.add({name:'probe-auto',description:'Disposable authority probe',execute:async input=>{
  const data=JSON.parse(input.prompt.text);
  let admitted;const admission=new Promise(resolve=>admitted=resolve);
  const state={mode:data.mode,epoch:1,revoked:data.mode==='stale-context',inputID:data.id,admission,receipt:null,compaction:null};states.set(input.sessionID,state);
  record('ext-registered',{sessionID:input.sessionID,mode:state.mode,epoch:1,inputID:data.id});
  try{const receipt=await ctx.session.synthetic({sessionID:input.sessionID,id:data.id,text:data.text,metadata:{extension:true,epoch:1},delivery:'queue',resume:true});state.receipt=receipt;admitted(receipt.id===data.id);record('ext-admitted',{sessionID:input.sessionID,receipt})}catch(error){admitted(false);throw error}
 }}));
 await ctx.session.hook('prompt',input=>{const state=states.get(input.sessionID);if(state&&input.metadata?.extensionSteer){state.revoked=true;record('ext-revoked',{sessionID:input.sessionID,inputID:input.messageID,epoch:state.epoch,mode:state.mode})}});
 await ctx.session.hook('compaction',async input=>{
  const state=states.get(input.sessionID);if(!state)return;
  const snapshot=snapshots.get(input.sessionID);
  const native=await ctx.session.context({sessionID:input.sessionID});const control=native.findLast(m=>m.type==='compaction');
  state.compaction={epoch:state.epoch,prior:structuredClone(snapshot),done:false,revokedAtEntry:state.revoked,nativeID:control?.id,reason:control?.reason};
  record('ext-compaction-control',{sessionID:input.sessionID,control,native});
  if(!control||control.reason!=='auto'||control.status!=='running')throw new Error('EXTENSION_UNPROVEN_COMPACTION_CONTROL');
  if(ids(input.messages).some(id=>id!==state.inputID&&id!==state.compaction.nativeID))throw new Error('EXTENSION_UNKNOWN_COMPACTION_INPUT');
  record('ext-compaction-enter',{sessionID:input.sessionID,epoch:state.epoch,revoked:state.revoked,consumed:ids(input.messages),snapshot,messages:input.messages});
  if(state.mode==='compact-steer')await new Promise(resolve=>setTimeout(resolve,1200));
  input.result={summary:'EXTENSION_COMPACTION deterministic summary',tokens:{input:0,output:0,reasoning:0,cache:{read:0,write:0}}};
  state.compaction.done=true;
  record('ext-compaction-exit',{sessionID:input.sessionID,epoch:state.epoch,revoked:state.revoked});
 });
 await ctx.session.hook('context',async input=>{
  const state=states.get(input.sessionID);if(!state)return;
  const accepted=await state.admission;
  const native=await ctx.session.context({sessionID:input.sessionID});
  const consumed=ids(input.messages);
  record('ext-context-attempt',{sessionID:input.sessionID,mode:state.mode,epoch:state.epoch,accepted,revoked:state.revoked,consumed,nativeInputs:nativeInputs(native),messages:input.messages,native});
  if(!accepted||state.revoked){record('ext-context-rejected',{sessionID:input.sessionID,mode:state.mode,consumed});throw new Error('EXTENSION_STALE_SYNTHETIC')}
  if(state.compaction?.done){
   const control=native.findLast(m=>m.type==='compaction');
   if(!control||control.id!==state.compaction.nativeID||control.reason!=='auto'||control.status!=='completed'||state.compaction.epoch!==state.epoch||state.compaction.revokedAtEntry)throw new Error('EXTENSION_COMPACTION_IDENTITY_CHANGED');
   if(consumed.some(id=>id!==state.compaction.nativeID&&id!==state.inputID))throw new Error('EXTENSION_UNKNOWN_RESUMED_INPUT');
   const after=native.slice(native.findLastIndex(m=>m.type==='compaction')+1);
   if(nativeInputs(after).some(m=>m.id!==state.inputID)){record('ext-context-rejected',{sessionID:input.sessionID,mode:state.mode,reason:'unknown post-compaction input'});throw new Error('EXTENSION_UNKNOWN_POST_COMPACTION_INPUT')}
   record('ext-continuity',{sessionID:input.sessionID,epoch:state.epoch,priorConsumed:ids(state.compaction.prior?.messages??[]),consumed,nativeInputs:nativeInputs(native),controlID:state.compaction.nativeID,summaryAuthority:false});
  }else if(!consumed.includes(state.inputID)){throw new Error('EXTENSION_MISSING_OWN_INPUT')}
  record('ext-context-authorized',{sessionID:input.sessionID,mode:state.mode,epoch:state.epoch,contextSeq:snapshots.get(input.sessionID)?.contextSeq,consumed});
 });
 await ctx.session.hook('http.request',input=>{const state=states.get(input.sessionID);if(state&&input.kind==='primary'){input.request.headers.set('x-flow-probe-session',input.sessionID);record('ext-primary-dispatch',{sessionID:input.sessionID,mode:state.mode,epoch:state.epoch,request:current.get(input.sessionID)})}});
 await ctx.tool.hook('execute.before',async input=>{
  const state=states.get(input.sessionID);if(!state)return;
  const primary=current.get(input.sessionID);const key=input.sessionID+'/'+input.messageID;const known=bindings.get(key);
  const native=await ctx.session.context({sessionID:input.sessionID});const assistant=native.find(m=>m.id===input.messageID);
  if(!assistant||assistant.type!=='assistant'||assistant.agent!==input.agent||!assistant.content.some(p=>p.type==='tool'&&p.id===input.id&&p.name===input.tool))throw new Error('EXTENSION_IDENTITY_MISMATCH');
  if(known&&known!==primary)throw new Error('EXTENSION_ASSISTANT_REBOUND');
  const i=native.findIndex(m=>m.id===input.messageID);const actual=native.slice(0,i).filter(m=>m.type==='user'||m.type==='synthetic'||m.type==='compaction'&&m.status==='completed').map(m=>m.id);
  const frozen=ids(primary.snapshot.messages);if(JSON.stringify(actual)!==JSON.stringify(frozen))throw new Error('EXTENSION_INPUT_PREFIX_MISMATCH');
  bindings.set(key,primary);
  record('ext-tool-attempt',{sessionID:input.sessionID,mode:state.mode,epoch:state.epoch,revoked:state.revoked,execution:input,primary,native});
  if(state.revoked){record('ext-tool-rejected',{sessionID:input.sessionID,mode:state.mode,execution:input});throw new Error('EXTENSION_REVOKED_BEFORE_NATIVE_TOOL')}
  record('ext-tool-authorized',{sessionID:input.sessionID,mode:state.mode,epoch:state.epoch,execution:input,primary});
 });
 await ctx.shell.hook('create.before',input=>{if(input.command.includes('extension-native-effect'))record('ext-native-shell-created',{command:input.command,cwd:input.cwd})});
}
