import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OpenCodeStartup } from '/Users/vriesd/projects/flow-opencode/evals/opencode-host.ts';
const base='/tmp/flow-v2-http-contract';
const executable='/tmp/flow-opencode-v2-plan-host/npm-cache/_npx/2314e955696d2fea/node_modules/@opencode/cli-darwin-arm64/bin/opencode';
const results=[];
for(const mode of ["bare","hooked","forced"]) {
 const hooked=mode!=="bare";
 const root=join(base,mode+'-3');
 for(const leaf of ['home','config/opencode','data','state','cache','tmp','project','plugin']) await mkdir(join(root,leaf),{recursive:true});
 let upgrades=0,http=0,frames=0;
 const completed={type:'response.completed',response:{id:'resp_local',object:'response',created_at:1,status:'completed',model:'gpt-6.1-sol',output:[{type:'message',id:'message_local',role:'assistant',status:'completed',content:[{type:'output_text',text:'OK',annotations:[]}]}],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}};
 const provider=Bun.serve({hostname:'127.0.0.1',port:0,fetch(request,server){
  if(request.headers.get('upgrade')?.toLowerCase()==='websocket'){upgrades++; if(server.upgrade(request))return;return new Response('no upgrade',{status:400});}
  http++; return new Response(`data: ${JSON.stringify(completed)}\n\n`,{headers:{'content-type':'text/event-stream'}});
 },websocket:{message(ws,message){frames++;ws.send(JSON.stringify(completed));}}});
 const code=`import {Plugin,Provider,Model} from '@opencode/plugin';
import {registerHttpTransport} from '/Users/vriesd/projects/flow-opencode/src/platform/opencode/http-transport.ts';
export default Plugin.define({id:'flow.transport.probe',async setup(ctx){
 const id=Provider.ID.make('flow-transport');const model=Model.Info.default(id,Model.ID.make('gpt-6.1-sol'));
 await ctx.provider.transform(e=>e.add({info:{...Provider.Info.empty(id),activation:'enabled',package:'@opencode/ai/providers/openai/responses',settings:{baseURL:${JSON.stringify(provider.url+'v1')},apiKey:'local-synthetic-key',transport:'websocket'}},models:[{...model,variants:[{id:'force-ws',settings:{transport:'websocket'}}],settings:{transport:'websocket'},capabilities:{...model.capabilities,tools:true}}]}));
 await ctx.session.hook('title',i=>{i.result='Local transport proof'});
 ${mode==="forced"?"await registerHttpTransport(ctx.provider);":""}
 ${hooked?"const hook=await ctx.session.hook('http.request',()=>{});return ()=>hook.dispose();":""}
}});`;
 await writeFile(join(root,'plugin/index.ts'),code);
 await writeFile(join(root,'project/opencode.json'),JSON.stringify({plugins:[{package:join(root,'plugin')}]}));
 const link=Bun.spawnSync(['ln','-s','/Users/vriesd/projects/flow-opencode/node_modules',join(root,'node_modules')]);
 const listener=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>new Response()});const port=listener.port;listener.stop(true);
 const env={PATH:process.env.PATH,HOME:join(root,'home'),XDG_CONFIG_HOME:join(root,'config'),XDG_DATA_HOME:join(root,'data'),XDG_CACHE_HOME:join(root,'cache'),XDG_STATE_HOME:join(root,'state'),TMPDIR:join(root,'tmp')};
 const child=spawn(executable,['serve','--hostname','127.0.0.1','--port',String(port)],{cwd:join(root,'project'),env,stdio:['ignore','pipe','pipe']});
 const startup=new OpenCodeStartup();child.stdout.on('data',c=>startup.consume(String(c)));child.stderr.on('data',c=>startup.consume(String(c),'stderr'));
 let result;
 try{
  let client=null;const deadline=Date.now()+10000;
  while(Date.now()<deadline){client=startup.client(`http://127.0.0.1:${port}`,join(root,'project'));if(client)break;await Bun.sleep(25);}
  if(!client)throw Error('No private authentication');
  const info=await client.server.info();
  const session=await client.session.create({agent:'build',location:{directory:join(root,'project')},model:{providerID:'flow-transport',id:'gpt-6.1-sol',variant:'force-ws'}});
  await client.session.prompt({sessionID:session.id,text:'Reply OK only.'});
  let waitError=null;try{await client.session.wait({sessionID:session.id},{signal:AbortSignal.timeout(10000)});}catch(e){waitError=String(e);}
  const native=await client.message.list({sessionID:session.id,order:'asc'});
  result={mode,hooked,host:info.version,pid:info.pid,upgrades,http,frames,waitError,native:native.data};
  await writeFile(join(root,'native.json'),JSON.stringify(result,null,2));
 }finally{child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));provider.stop(true);}
 results.push(result);
}
await writeFile(join(base,'verification.json'),JSON.stringify({results,pass:results[0].upgrades>0&&results[2].upgrades===0&&results[2].http>0},null,2));
console.log(JSON.stringify(results.map(({native,...r})=>r)));
if(!(results[0].upgrades>0&&results[2].upgrades===0&&results[2].http>0))process.exitCode=1;
