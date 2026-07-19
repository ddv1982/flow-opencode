import {
	type ActivationPathOptions,
	applyFlowActivation,
} from "../../src/distribution/activation.js";

type CrashFixture = {
	project: string;
	target: string;
	paths: ActivationPathOptions;
};

const serialized = process.argv[2];
const crashPoint = process.argv[3];
if (!serialized || !crashPoint) {
	throw new Error("activation crash fixture requires payload and crash point");
}

const fixture = JSON.parse(serialized) as CrashFixture;
const hardKill = async (): Promise<never> => {
	process.kill(process.pid, "SIGKILL");
	return await new Promise<never>(() => {});
};

await applyFlowActivation({
	project: fixture.project,
	scope: "global",
	target: fixture.target,
	apply: true,
	paths: fixture.paths,
	afterMutation: async (operation) => {
		if (
			crashPoint === "after-cache-stage" &&
			operation.action === "remove-cache"
		) {
			await hardKill();
		}
	},
	afterRemovalCommit: async () => {
		if (crashPoint === "after-removal-commit") await hardKill();
	},
});
