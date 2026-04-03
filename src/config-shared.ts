export const FLOW_READ_ONLY_TOOLS = {
  edit: false,
  write: false,
  bash: false,
} as const;

export const FLOW_READ_ONLY_PERMISSION = {
  edit: "deny",
  bash: "deny",
} as const;
