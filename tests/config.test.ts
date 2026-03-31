import { describe, expect, test } from "bun:test";
import { applyFlowConfig } from "../src/config";

describe("applyFlowConfig", () => {
  test("injects commands and agents", () => {
    const config: { agent?: Record<string, unknown>; command?: Record<string, unknown> } = {};
    applyFlowConfig(config);

    expect(config.agent).toBeDefined();
    expect(config.command).toBeDefined();
    expect(config.agent?.["flow-planner"]).toBeDefined();
    expect(config.agent?.["flow-worker"]).toBeDefined();
    expect(config.agent?.["flow-auto"]).toBeDefined();
    expect(config.agent?.["flow-control"]).toBeDefined();
    expect(config.command?.["flow-plan"]).toBeDefined();
    expect(config.command?.["flow-run"]).toBeDefined();
    expect(config.command?.["flow-auto"]).toBeDefined();
    expect(config.command?.["flow-status"]).toBeDefined();
    expect(config.command?.["flow-reset"]).toBeDefined();
  });

  test("routes status and reset through the control agent", () => {
    const config: { agent?: Record<string, any>; command?: Record<string, any> } = {};
    applyFlowConfig(config);

    expect(config.command?.["flow-status"]?.agent).toBe("flow-control");
    expect(config.command?.["flow-reset"]?.agent).toBe("flow-control");
  });
});
