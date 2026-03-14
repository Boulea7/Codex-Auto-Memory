import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/lib/config/load-config.js";
import { detectProjectContext } from "../src/lib/domain/project-context.js";

const tempPaths: string[] = [];
const originalHome = process.env.HOME;
const originalManagedConfig = process.env.CAM_MANAGED_CONFIG;

async function createTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempPaths.push(dir);
  return dir;
}

afterEach(async () => {
  process.env.HOME = originalHome;
  process.env.CAM_MANAGED_CONFIG = originalManagedConfig;
  await Promise.all(tempPaths.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("loadConfig", () => {
  it("merges user, project, local, override, and managed config with the expected precedence", async () => {
    const homeDir = await createTempDir("cam-home-");
    const projectDir = await createTempDir("cam-project-");
    const managedFile = path.join(homeDir, "managed.json");
    process.env.HOME = homeDir;
    process.env.CAM_MANAGED_CONFIG = managedFile;

    await fs.mkdir(path.join(homeDir, ".config", "codex-auto-memory"), { recursive: true });
    await fs.writeFile(
      path.join(homeDir, ".config", "codex-auto-memory", "config.json"),
      JSON.stringify({
        autoMemoryEnabled: true,
        extractorMode: "heuristic",
        defaultScope: "project"
      })
    );
    await fs.writeFile(
      path.join(projectDir, "codex-auto-memory.json"),
      JSON.stringify({
        extractorMode: "codex",
        autoMemoryDirectory: "~/should-be-ignored",
        maxStartupLines: 180
      })
    );
    await fs.writeFile(
      path.join(projectDir, ".codex-auto-memory.local.json"),
      JSON.stringify({
        autoMemoryEnabled: false,
        autoMemoryDirectory: "~/cam-local-memory"
      })
    );
    await fs.writeFile(
      managedFile,
      JSON.stringify({
        extractorMode: "codex",
        autoMemoryEnabled: true
      })
    );

    const loaded = await loadConfig(detectProjectContext(projectDir), {
      defaultScope: "project-local"
    });

    expect(loaded.config.autoMemoryEnabled).toBe(true);
    expect(loaded.config.extractorMode).toBe("codex");
    expect(loaded.config.defaultScope).toBe("project-local");
    expect(loaded.config.maxStartupLines).toBe(180);
    expect(loaded.config.autoMemoryDirectory).toBe(path.join(homeDir, "cam-local-memory"));
    expect(loaded.warnings.join("\n")).toContain("Ignored autoMemoryDirectory");
  });
});

