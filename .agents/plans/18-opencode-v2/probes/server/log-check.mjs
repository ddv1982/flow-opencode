import {OpenCode} from '@opencode/client';import {readFileSync,writeFileSync} from 'node:fs';
const root='/tmp/flow-v2-server-probe';const p=readFileSync(root+'/server.stdout','utf8').match(/server password (.+)/)[1];const entries=readFileSync(root+'/interleavings.jsonl','utf8').trim().split('\n').map(JSON.parse);const id=entries.findLast(x=>x.type==='session').data.id;
const c=OpenCode.make({baseUrl:'http://127.0.0.1:47841',headers:{authorization:'Basic '+Buffer.from('opencode:'+p).toString('base64')},fetch:async(url,init)=>{console.log(String(url));return fetch(url,init)}});
const out=[];
for(const after of [undefined,0,1,-1,20]){try{const rows=await Array.fromAsync(c.session.log({sessionID:id,after,follow:false},{signal:AbortSignal.timeout(3000)}));out.push({after,rows});console.log('rows',after,rows.length,rows.map(x=>x.type).slice(0,5))}catch(e){console.log('error',after,String(e));}}
writeFileSync(root+'/log-check.json',JSON.stringify(out,null,2));
