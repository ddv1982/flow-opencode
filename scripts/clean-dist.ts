import { rm } from "node:fs/promises";

const distributionDirectory = new URL("../dist", import.meta.url);

await rm(distributionDirectory, { recursive: true, force: true });
