import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FLOW_PLUGIN_FILENAME, installBuiltPlugin, resolveInstallTarget, runInstallCommand, runUninstallCommand, shouldShowHelp, INSTALL_USAGE, UNINSTALL_USAGE } from "../src/installer";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "flow-opencode-install-"));
  tempDirs.push(dir);
  return dir;
}

async function writeBuiltPlugin(cwd: string, content = "export default 'flow';\n"): Promise<string> {
  const distDir = join(cwd, "dist");
  const sourceFile = join(distDir, "index.js");
  await mkdir(distDir, { recursive: true });
  await writeFile(sourceFile, content, "utf8");
  return sourceFile;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("installer", () => {
  test("installer only accepts the default command or help", () => {
    expect(shouldShowHelp(["--help"], INSTALL_USAGE)).toBe(true);
    expect(() => shouldShowHelp(["--project", "demo"], INSTALL_USAGE)).toThrow("Unknown argument");
  });

  test("resolveInstallTarget defaults to the global OpenCode plugin directory", () => {
    const homeDir = "/tmp/flow-home";

    expect(resolveInstallTarget({ homeDir })).toBe(
      join(homeDir, ".config", "opencode", "plugins", FLOW_PLUGIN_FILENAME),
    );
  });

  test("installBuiltPlugin creates directories and copies the built artifact", async () => {
    const sourceRoot = makeTempDir();
    const targetRoot = makeTempDir();
    const sourceFile = await writeBuiltPlugin(sourceRoot, "flow-build\n");
    const destinationFile = join(targetRoot, ".config", "opencode", "plugins", FLOW_PLUGIN_FILENAME);
    const logs: string[] = [];

    const installedPath = await installBuiltPlugin({
      sourceFile,
      destinationFile,
      logger: (message) => logs.push(message),
    });

    expect(installedPath).toBe(destinationFile);
    expect(await readFile(destinationFile, "utf8")).toBe("flow-build\n");
    expect(logs).toEqual([`Installed Flow plugin to ${destinationFile}`]);
  });

  test("runInstallCommand installs to the global plugin directory by default", async () => {
    const cwd = makeTempDir();
    const homeDir = makeTempDir();
    const logs: string[] = [];
    let buildCalls = 0;

    await writeBuiltPlugin(cwd, "global-install\n");

    const installedPath = await runInstallCommand([], {
      cwd,
      homeDir,
      build: async () => {
        buildCalls += 1;
      },
      logger: (message) => logs.push(message),
    });

    const expectedPath = join(homeDir, ".config", "opencode", "plugins", FLOW_PLUGIN_FILENAME);

    expect(buildCalls).toBe(1);
    expect(installedPath).toBe(expectedPath);
    expect(await readFile(expectedPath, "utf8")).toBe("global-install\n");
    expect(logs.at(-1)).toBe(`Installed Flow plugin to ${expectedPath}`);
  });

  test("installBuiltPlugin reports a clear error when the build artifact is missing", async () => {
    const destinationFile = join(makeTempDir(), FLOW_PLUGIN_FILENAME);

    await expect(
      installBuiltPlugin({
        sourceFile: join(makeTempDir(), "dist", "index.js"),
        destinationFile,
        logger: () => {},
      }),
    ).rejects.toThrow("Run `bun run build` first");
  });

  test("runUninstallCommand removes the installed plugin file", async () => {
    const homeDir = makeTempDir();
    const destinationFile = resolveInstallTarget({ homeDir });
    const logs: string[] = [];

    await mkdir(join(homeDir, ".config", "opencode", "plugins"), { recursive: true });
    await writeFile(destinationFile, "installed\n", "utf8");

    const removedPath = await runUninstallCommand([], {
      homeDir,
      logger: (message) => logs.push(message),
    });

    await expect(readFile(destinationFile, "utf8")).rejects.toThrow();
    expect(removedPath).toBe(destinationFile);
    expect(logs).toEqual([`Removed Flow plugin from ${destinationFile}`]);
  });

  test("runUninstallCommand accepts help and ignores missing files", async () => {
    const homeDir = makeTempDir();
    const logs: string[] = [];

    await expect(runUninstallCommand(["--project"], { homeDir })).rejects.toThrow("Unknown argument");

    const removedPath = await runUninstallCommand([], {
      homeDir,
      logger: (message) => logs.push(message),
    });

    expect(removedPath).toBe(resolveInstallTarget({ homeDir }));

    logs.length = 0;
    await runUninstallCommand(["--help"], {
      homeDir,
      logger: (message) => logs.push(message),
    });

    expect(logs).toEqual([UNINSTALL_USAGE]);
  });
});
