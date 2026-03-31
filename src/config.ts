import { FLOW_AUTO_AGENT_PROMPT, FLOW_CONTROL_AGENT_PROMPT, FLOW_PLANNER_AGENT_PROMPT, FLOW_WORKER_AGENT_PROMPT } from "./prompts/agents";
import {
  FLOW_AUTO_COMMAND_TEMPLATE,
  FLOW_PLAN_COMMAND_TEMPLATE,
  FLOW_RESET_COMMAND_TEMPLATE,
  FLOW_RUN_COMMAND_TEMPLATE,
  FLOW_STATUS_COMMAND_TEMPLATE,
} from "./prompts/commands";

type MutableConfig = {
  agent?: Record<string, unknown>;
  command?: Record<string, unknown>;
};

function buildAgents() {
  return {
    "flow-planner": {
      mode: "primary",
      description: "Create and refine compact Flow plans grounded in repo evidence.",
      prompt: FLOW_PLANNER_AGENT_PROMPT,
      tools: {
        edit: false,
        write: false,
        bash: false,
      },
    },
    "flow-worker": {
      mode: "primary",
      description: "Execute one approved Flow feature with focused validation and review.",
      prompt: FLOW_WORKER_AGENT_PROMPT,
    },
    "flow-auto": {
      mode: "primary",
      description: "Plan, approve, execute, and replan Flow work autonomously.",
      prompt: FLOW_AUTO_AGENT_PROMPT,
    },
    "flow-control": {
      mode: "primary",
      description: "Inspect or reset Flow runtime state without executing work.",
      prompt: FLOW_CONTROL_AGENT_PROMPT,
      tools: {
        edit: false,
        write: false,
        bash: false,
      },
    },
  };
}

function buildCommands() {
  return {
    "flow-plan": {
      description: "Create, update, select, or approve a Flow plan",
      agent: "flow-planner",
      template: FLOW_PLAN_COMMAND_TEMPLATE,
    },
    "flow-run": {
      description: "Run one approved Flow feature",
      agent: "flow-worker",
      template: FLOW_RUN_COMMAND_TEMPLATE,
    },
    "flow-auto": {
      description: "Run Flow autonomously until completion or a real blocker",
      agent: "flow-auto",
      template: FLOW_AUTO_COMMAND_TEMPLATE,
    },
    "flow-status": {
      description: "Inspect the active Flow session",
      agent: "flow-control",
      template: FLOW_STATUS_COMMAND_TEMPLATE,
    },
    "flow-reset": {
      description: "Reset a Flow feature or clear the active session",
      agent: "flow-control",
      template: FLOW_RESET_COMMAND_TEMPLATE,
    },
  };
}

export function applyFlowConfig(config: MutableConfig): void {
  config.agent = {
    ...(config.agent ?? {}),
    ...buildAgents(),
  };

  config.command = {
    ...(config.command ?? {}),
    ...buildCommands(),
  };
}

export function createConfigHook(_ctx: unknown) {
  return async (config: MutableConfig) => {
    applyFlowConfig(config);
  };
}
