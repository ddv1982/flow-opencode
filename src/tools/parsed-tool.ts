import { parseToolArgs } from "../runtime/application";
import type { ToolContext } from "./schemas";

type ParseSchema<T> = {
  parse: (input: unknown) => T;
};

export function withParsedArgs<T>(
  schema: ParseSchema<T>,
  run: (input: T, context: ToolContext) => Promise<string>,
): (args: unknown, context: ToolContext) => Promise<string> {
  return async (args, context) => {
    const parsed = parseToolArgs(schema, args);
    if (!parsed.ok) {
      return parsed.response;
    }

    return run(parsed.value, context);
  };
}
