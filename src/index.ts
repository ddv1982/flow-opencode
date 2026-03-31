import type { Plugin } from "@opencode-ai/plugin";
import { createConfigHook } from "./config";
import { createTools } from "./tools";

const FlowPlugin: Plugin = async (ctx) => {
  return {
    config: createConfigHook(ctx),
    tool: createTools(ctx),
  };
};

export default FlowPlugin;
