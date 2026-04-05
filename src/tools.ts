import { createRuntimeTools } from "./tools/runtime-tools";
import { createSessionTools } from "./tools/session-tools";

export function createTools(_ctx: unknown) {
  return {
    ...createSessionTools(),
    ...createRuntimeTools(),
  };
}
