import {OpenCode} from '@opencode/client';
import {readFileSync,appendFileSync} from 'node:fs';
const root='/tmp/flow-v2-server-probe';
const password=readFileSync(root+'/server.stdout','utf8').match(/server password (.+)/)[1];
const c=OpenCode.make({baseUrl:'http://127.0.0.1:47841',headers:{authorization:'Basic '+Buffer.from('opencode:'+password).toString('base64'),'x-opencode-directory':root+'/workspace'}});
const log=(type,data)=>{appendFileSync(root+'/cases.jsonl',JSON.stringify({type,data})+'\n');console.log(type,JSON.stringify(data).slice(0,1200))};
const req={signal:AbortSignal.timeout(20000)};
log('health',await c.server.info());
log('models',await c.model.list());
const parent=await c.session.create({title:'Native shell',agent:'build',model:{providerID:'flowprobe',id:'probe'},location:{directory:root+'/workspace'}});log('parent',parent);
const child=await c.session.create({title:'Child',agent:'general',parentID:parent.id,model:{providerID:'flowprobe',id:'probe'},location:{directory:root+'/workspace'}});log('child',child);
await c.session.command({sessionID:parent.id,name:'probe',text:'read identity'},req);
for(const [label,session,actions] of [
 ['shell',parent,[{tool:'shell',input:{command:'printf probe-ok',description:'probe success'}},{tool:'shell',input:{command:'printf probe-failed; exit 7',description:'probe nonzero'}},{tool:'shell',input:{command:"/usr/bin/yes probe-line | /usr/bin/head -n 12000",description:'probe large output'}}]],
 ['allow',child,[{tool:'probe_plain'},{tool:'probe_declared'},{tool:'probe_explicit'}]]
]){
 log(label+'-admission',await c.session.prompt({sessionID:session.id,text:'PROBE '+JSON.stringify(actions)},req));
 await c.session.wait({sessionID:session.id},req);
 log(label+'-messages',await c.message.list({sessionID:session.id},req));
}
