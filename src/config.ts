import { FLOW_AUTO_AGENT_PROMPT, FLOW_CONTROL_AGENT_PROMPT, FLOW_PLANNER_AGENT_PROMPT, FLOW_REVIEWER_AGENT_PROMPT, FLOW_WORKER_AGENT_PROMPT } from "./prompts/agents";
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

const FLOW_READ_ONLY_TOOLS = {
  edit: false,
  write: false,
  bash: false,
} as const;

const FLOW_AGENTS = {
  "flow-planner": {
    mode: "primary",
    description: "Create and refine compact Flow plans grounded in repo evidence.",
    prompt: FLOW_PLANNER_AGENT_PROMPT,
    tools: FLOW_READ_ONLY_TOOLS,
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
  "flow-reviewer": {
    mode: "primary",
    description: "Review Flow work and decide whether it may advance.",
    prompt: FLOW_REVIEWER_AGENT_PROMPT,
    tools: FLOW_READ_ONLY_TOOLS,
  },
  "flow-control": {
    mode: "primary",
    description: "Inspect or reset Flow runtime state without executing work.",
    prompt: FLOW_CONTROL_AGENT_PROMPT,
    tools: FLOW_READ_ONLY_TOOLS,
  },
};

const FLOW_COMMANDS = {
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

function cloneAgentConfig(agent: (typeof FLOW_AGENTS)[keyof typeof FLOW_AGENTS]) {
  if (!("tools" in agent)) {
    return { ...agent };
  }

  return {
    ...agent,
    tools: { ...agent.tools },
  };
}

function cloneCommandConfig(command: (typeof FLOW_COMMANDS)[keyof typeof FLOW_COMMANDS]) {
  return {
    ...command,
  };
}

export function applyFlowConfig(config: MutableConfig): void {
  config.agent = {
    ...(config.agent ?? {}),
    ...Object.fromEntries(Object.entries(FLOW_AGENTS).map(([name, agent]) => [name, cloneAgentConfig(agent)])),
  };

  config.command = {
    ...(config.command ?? {}),
    ...Object.fromEntries(Object.entries(FLOW_COMMANDS).map(([name, command]) => [name, cloneCommandConfig(command)])),
  };
}

export function createConfigHook(_ctx: unknown) {
  return async (config: MutableConfig) => {
    applyFlowConfig(config);
  };
}
