import { run } from "mitata";

import "./session-save-round-trip.bench";
import "./transition-reducer.bench";
import "./markdown-render.bench";
import "./zod-parse-hot-paths.bench";
import "./full-save-session-cycle.bench";

await run();
