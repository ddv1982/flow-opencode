#!/usr/bin/env bun
import {
	defaultEvalMatrixForCi,
	parseEvalModelList,
} from "./default-models.js";

const requested = process.env.FLOW_EVAL_MODEL?.trim();
const models = requested
	? parseEvalModelList(requested)
	: defaultEvalMatrixForCi(process.env);
process.stdout.write(`${models.join(",")}\n`);
