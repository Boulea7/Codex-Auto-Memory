import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendCliCwdFlag,
  buildResolvedCliCommand,
  buildWorkflowContract,
  resolveCliLauncher
} from "../src/lib/integration/retrieval-contract.js";

const tempDirs: string[] = [];
const originalPath = process.env.PATH;
const originalDistCliOverride = process.env.CODEX_AUTO_MEMORY_DIST_CLI_PATH;

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  if (originalPath === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = originalPath;
  }

  if (originalDistCliOverride === undefined) {
    delete process.env.CODEX_AUTO_MEMORY_DIST_CLI_PATH;
  } else {
    process.env.CODEX_AUTO_MEMORY_DIST_CLI_PATH = originalDistCliOverride;
  }

  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("retrieval contract", () => {
  it("shell-quotes cwd values so the shell cannot expand them", () => {
    expect(appendCliCwdFlag("cam recall search \"<query>\"", "/tmp/$HOME/path with spaces")).toBe(
      "cam recall search \"<query>\" --cwd '/tmp/$HOME/path with spaces'"
    );
  });

  it("escapes embedded single quotes in cwd values", () => {
    expect(appendCliCwdFlag("cam recall details \"<ref>\"", "/tmp/it's-safe")).toBe(
      "cam recall details \"<ref>\" --cwd '/tmp/it'\"'\"'s-safe'"
    );
  });

  it("uses an explicit packaged dist launcher override without mutating the real dist artifact", async () => {
    const fakeDistDir = await tempDir("cam-retrieval-contract-dist-");
    const fakeDistCliPath = path.join(fakeDistDir, "cli.js");
    await fs.writeFile(fakeDistCliPath, "#!/usr/bin/env node\nconsole.log('fake dist cli');\n", "utf8");

    process.env.PATH = "";
    process.env.CODEX_AUTO_MEMORY_DIST_CLI_PATH = fakeDistCliPath;

    const workflowContract = buildWorkflowContract({
      cwd: "/tmp/project"
    });

    expect(workflowContract.launcher).toMatchObject({
      resolution: "node-dist",
      verified: true,
      resolvedCommand: `node ${JSON.stringify(fakeDistCliPath)}`
    });
    expect(buildResolvedCliCommand("mcp doctor --host codex")).toContain(fakeDistCliPath);
  });

  it("keeps resolved CLI fallback commands aligned with an explicit launcher override", () => {
    const launcher = resolveCliLauncher({
      pathValue: "",
      distCliPath: "/tmp/custom-dist/cli.js",
      distCliPathExists: true
    });

    const workflowContract = buildWorkflowContract({
      cwd: "/tmp/project",
      launcherOverride: launcher
    });

    expect(workflowContract.launcher).toMatchObject({
      resolution: "node-dist",
      resolvedCommand: 'node "/tmp/custom-dist/cli.js"'
    });
    expect(workflowContract.resolvedCliFallback.searchCommand).toContain("/tmp/custom-dist/cli.js");
    expect(workflowContract.resolvedCliFallback.timelineCommand).toContain("/tmp/custom-dist/cli.js");
    expect(workflowContract.resolvedCliFallback.detailsCommand).toContain("/tmp/custom-dist/cli.js");
  });
});
