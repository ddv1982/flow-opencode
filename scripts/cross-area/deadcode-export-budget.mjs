import { execFileSync } from "node:child_process";

const budgets = {
	exports: 0,
	exportedTypes: 11,
	duplicateExports: 0,
};

function runKnipExportReport() {
	return execFileSync(
		"bunx",
		["knip", "--exports", "--no-exit-code", "--reporter", "compact"],
		{
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
}

function countHeading(report, heading) {
	const match = report.match(new RegExp(`${heading} \\((\\d+)\\)`, "u"));
	return match ? Number(match[1]) : 0;
}

const report = runKnipExportReport();
const counts = {
	exports: countHeading(report, "Unused exports"),
	exportedTypes: countHeading(report, "Unused exported types"),
	duplicateExports: countHeading(report, "Duplicate exports"),
};

const failures = Object.entries(budgets).flatMap(([key, budget]) => {
	const count = counts[key];
	return count > budget ? [`${key}: ${count} > ${budget}`] : [];
});

console.log(
	JSON.stringify(
		{
			budgets,
			counts,
		},
		null,
		2,
	),
);

if (failures.length > 0) {
	console.error(`Deadcode export budget exceeded: ${failures.join(", ")}`);
	process.exit(1);
}
