import {OpenCode} from '@opencode/client';
import {readFileSync,appendFileSync,realpathSync,openSync,fstatSync,readFileSync as read,closeSync,constants} from 'node:fs';
const root='/tmp/flow-v2-server-probe';
const password=readFileSync(root+'/server.stdout','utf8').match(/server password (.+)/)[1];
const c=OpenCode.make({baseUrl:'http://127.0.0.1:47841',headers:{authorization:'Basic '+Buffer.from('opencode:'+password).toString('base64'),'x-opencode-directory':root+'/workspace'}});
const log=(type,data)=>{appendFileSync(root+'/extended.jsonl',JSON.stringify({type,data})+'\n');console.log(type,JSON.stringify(data).slice(0,800))};
const options=()=>({signal:AbortSignal.timeout(15000)});
const create=async(agent,title,parentID)=>c.session.create({title,agent,parentID,model:{providerID:'flowprobe',id:'probe'},location:{directory:root+'/workspace'}});
const actions=[{tool:'probe_plain'},{tool:'probe_declared'},{tool:'probe_explicit'}];
log('reserved-agents',(await c.agent.list()).data.filter(a=>a.id.startsWith('flow-')));
for(const role of ['flow-reviewer','flow-worker']){
 const parent=await create('build','permission parent');const s=await create(role,'permission '+role,parent.id);log(role,s);
 await c.session.prompt({sessionID:s.id,text:'PROBE '+JSON.stringify(actions)},options());await c.session.wait({sessionID:s.id},options());log(role+'-messages',await c.message.list({sessionID:s.id},options()));
}
const s=await create('build','Lifecycle');log('lifecycle-session',s);
const ac=new AbortController();const events=[];const stream=(async()=>{try{for await(const event of c.event.subscribe({signal:ac.signal})){events.push(event)}}catch(e){log('subscriber-error',String(e))}})();
const id='msg_flowprobe_duplicate_'+Date.now();
log('duplicate-admissions',await Promise.allSettled([c.session.prompt({sessionID:s.id,id,text:'PROBE []',metadata:{flowProbe:'duplicate'},delivery:'queue'},options()),c.session.prompt({sessionID:s.id,id,text:'PROBE []',metadata:{flowProbe:'duplicate'},delivery:'queue'},options())]));
await c.session.wait({sessionID:s.id},options());
log('synthetic',await c.session.synthetic({sessionID:s.id,text:'probe synthetic',metadata:{flowProbe:'synthetic'},delivery:'queue'},options()));
await c.session.wait({sessionID:s.id},options());
log('compaction-admission',await c.session.compact({sessionID:s.id,delivery:'queue'},options()));await c.session.wait({sessionID:s.id},options());
log('lifecycle-messages',await c.message.list({sessionID:s.id},options()));
log('session-log',await Array.fromAsync(c.session.log({sessionID:s.id,follow:false},options())));
ac.abort();await stream;log('client-subscriber-ended',true);log('client-events',events);
const lines=readFileSync(root+'/plugin.jsonl','utf8').trim().split('\n').map(JSON.parse);
const large=lines.findLast(x=>x.type==='execute.after'&&x.data.tool==='shell'&&x.data.result?.metadata?.truncated);
const text=large.data.result.content.filter(p=>p.type==='text').map(p=>p.text).join('\n');
const path=text.match(/full output saved to ([^\]\n]+)/)?.[1];
if(!path||!/^\/tmp\/flow-v2-server-probe\/data\/opencode\/shell\/[a-f0-9]+\/sh_[a-zA-Z0-9]+\.out$/.test(path))throw Error('unexpected managed path');
if(!realpathSync(path).startsWith(realpathSync(root+'/data/opencode/shell')+'/'))throw Error('escaped managed directory');
const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const st=fstatSync(fd);if(!st.isFile()||st.size>8*1024*1024)throw Error('unsafe size');const value=read(fd,'utf8');log('full-output',{path,size:st.size,exact:value==='probe-line\n'.repeat(12000)});}finally{closeSync(fd)}
const shellID=path.match(/(sh_[a-zA-Z0-9]+)\.out$/)[1];log('shell-get',await c.shell.get({id:shellID},options()));const full=await c.shell.output({id:shellID,cursor:0,limit:200000},options());log('shell-output',{...full,data:{...full.data,output:undefined,exact:full.data.output==='probe-line\n'.repeat(12000)}});
