import http from 'node:http';
import {appendFileSync} from 'node:fs';
const log=(x)=>appendFileSync('/tmp/flow-v2-server-probe/provider.jsonl',JSON.stringify(x)+'\n');
const compacted=new Set();
const server=http.createServer(async(req,res)=>{
 let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw);log({url:req.url,sessionID:req.headers['x-flow-probe-session'],body});
 const user=body.messages.filter(x=>x.role==='user').at(-1)?.content;
 const text=typeof user==='string'?user:JSON.stringify(user);
 let actions=[];
 try{actions=JSON.parse(text.match(/PROBE (\[.*\])/s)?.[1]??'[]')}catch{}
 const last=body.messages.at(-1);
 const toolCalls=last?.role==='user'?actions.map((x,i)=>({index:i,id:'call_probe_'+i,type:'function',function:{name:x.tool,arguments:JSON.stringify(x.input??{})}})):[];
 const marker=text.match(/AUTO_COMPACT_[A-Z0-9_]+/)?.[0];
 const forceCompaction=!!marker&&!compacted.has(marker)&&toolCalls.length>0;
 if(forceCompaction)compacted.add(marker);
 const hasSummary=JSON.stringify(body.messages).includes('EXTENSION_COMPACTION');
 if(hasSummary&&last?.role!=='tool'&&!toolCalls.length)toolCalls.push({index:0,id:'call_post_compaction',type:'function',function:{name:'probe_plain',arguments:'{}'}});
 const base={id:'chatcmpl-local-probe',object:'chat.completion.chunk',created:1,model:'probe'};
 res.writeHead(200,{'content-type':'text/event-stream'});
 const chunk=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta,finish_reason}]})+'\n\n');
 chunk({role:'assistant',content:text.includes('DELAY')?'Probe started ':''});
 if(text.includes('DELAY'))await new Promise(resolve=>setTimeout(resolve,2000));
 chunk(toolCalls.length?{tool_calls:toolCalls}:{content:'Probe finished'});chunk({},toolCalls.length?'tool_calls':'stop');if(forceCompaction)res.write('data: '+JSON.stringify({...base,choices:[],usage:{prompt_tokens:195000,completion_tokens:10,total_tokens:195010}})+'\n\n');res.end('data: [DONE]\n\n');
});server.listen(47842,'127.0.0.1',()=>log({listening:true}));
