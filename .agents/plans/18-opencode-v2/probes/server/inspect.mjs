import {OpenCode} from '@opencode/client';
import {readFileSync,writeFileSync} from 'node:fs';
const password=readFileSync('/tmp/flow-v2-server-probe/server.stdout','utf8').match(/server password (.+)/)[1];
export const c=OpenCode.make({baseUrl:'http://127.0.0.1:47841',headers:{authorization:'Basic '+Buffer.from('opencode:'+password).toString('base64'),'x-opencode-directory':'/tmp/flow-v2-server-probe/workspace'}});
await c.location.reload();
console.log('plugins',JSON.stringify(await c.plugin.list()));
console.log('commands',JSON.stringify(await c.command.list()));
console.log('agents',JSON.stringify(await c.agent.list()));
