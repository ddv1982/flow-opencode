import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { sameGoalSystemOneBody as trunkBody } from "/tmp/flow-jev-overnight-20260924/jev1-trunk/evals/alignment-corpus/jev.js";
import { sameGoalSystemOneBody as headBody } from "/tmp/flow-jev-overnight-20260924/jev1-head/evals/alignment-corpus/jev.js";
const corpus=JSON.parse(await readFile("/tmp/flow-jev-overnight-20260924/jev1-trunk/evals/alignment-corpus/v1.json","utf8"));
const baseline=JSON.parse(await readFile("/tmp/flow-jev-overnight-20260924/jev1-trunk-baseline-measurements.json","utf8"));
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const rows=corpus.cases.map((entry:any,index:number)=>{
 const trunk=trunkBody(entry.activeGoal,entry.userRequest) as any;
 const head=headBody(entry.activeGoal,entry.userRequest) as any;
 const normalizedTrunk={...trunk,model:"<requested-model>"};
 const normalizedHead={...head,model:"<requested-model>"};
 return {id:entry.id,normalizedInputSha256:hash(normalizedTrunk),sameInput:hash(normalizedTrunk)===hash(normalizedHead),trunkRequestSha256:hash(trunk),observedTrunkRequestSha256:baseline.measurements[index]?.requestSha256,headRequestSha256:hash(head),trunkRequestedModel:trunk.model,headRequestedModel:head.model};
});
if(rows.some((row:any)=>!row.sameInput || row.trunkRequestSha256!==row.observedTrunkRequestSha256)) throw new Error("Input mismatch");
await writeFile("/tmp/flow-jev-overnight-20260924/jev1-normalized-packets.json",JSON.stringify({schemaVersion:1,identicalGoalAndRubricInputs:true,rows},null,2)+"\n");
process.stdout.write(JSON.stringify({count:rows.length,identicalGoalAndRubricInputs:true,trunkRequestedModel:rows[0]?.trunkRequestedModel,headRequestedModel:rows[0]?.headRequestedModel})+"\n");
