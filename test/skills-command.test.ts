import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { restoreOptionalEnv } from "./helpers/env.js";
import { runCli } from "./helpers/cli-runner.js";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;
const originalCodexHome = process.env.CODEX_HOME;

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function shellQuoteArg(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

afterEach(async () => {
  restoreOptionalEnv("HOME", originalHome);
  restoreOptionalEnv("CODEX_HOME", originalCodexHome);
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("skills command", () => {
  it("installs a Codex skill for progressive durable memory retrieval", async () => {
    const homeDir = await tempDir("cam-skills-home-");
    const projectDir = await tempDir("cam-skills-project-");
    process.env.HOME = homeDir;
    delete process.env.CODEX_HOME;

    const result = runCli(projectDir, ["skills", "install"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("codex-auto-memory-recall");
    expect(result.stdout).toContain("search -> timeline -> details");
    expect(result.stdout).toContain("read-only");
    expect(result.stdout).toContain("search_memories");
    expect(result.stdout).toContain('state: "auto"');
    expect(result.stdout).toContain("limit: 8");
    expect(result.stdout).toContain("memory-recall.sh");
    expect(result.stdout).toContain("recall-bridge.md");
    expect(result.stdout).toContain("cam mcp doctor");
    expect(result.stdout).toContain("cam memory");
    expect(result.stdout).toContain("cam session");

    const skillDir = path.join(homeDir, ".codex", "skills", "codex-auto-memory-recall");
    const skillFile = await fs.readFile(path.join(skillDir, "SKILL.md"), "utf8");

    expect(skillFile).toContain("search_memories");
    expect(skillFile).toContain("timeline_memories");
    expect(skillFile).toContain("get_memory_details");
    expect(skillFile).toContain('state: "auto"');
    expect(skillFile).toContain("limit: 8");
    expect(skillFile).toContain("cam recall search");
    expect(skillFile).toContain("--state auto");
    expect(skillFile).toContain(`--cwd ${shellQuoteArg(await fs.realpath(projectDir))}`);
    expect(skillFile).toContain("cam recall timeline");
    expect(skillFile).toContain("cam recall details");
    expect(skillFile).toContain("cam mcp doctor");
    expect(skillFile).toContain("cam hooks install");
    expect(skillFile).toContain(`cam sync --cwd ${shellQuoteArg(await fs.realpath(projectDir))}`);
    expect(skillFile).toContain(
      `cam memory --recent --cwd ${shellQuoteArg(await fs.realpath(projectDir))}`
    );
    expect(skillFile).toContain("cam memory");
    expect(skillFile).toContain("cam session");
  });

  it("emits a structured workflow contract in skills install --json", async () => {
    const homeDir = await tempDir("cam-skills-json-home-");
    const projectDir = await tempDir("cam-skills-json-project-");
    process.env.HOME = homeDir;
    delete process.env.CODEX_HOME;

    const result = runCli(projectDir, ["skills", "install", "--json"]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      action: "created",
      targetDir: path.join(homeDir, ".codex", "skills", "codex-auto-memory-recall"),
      surface: "runtime",
      preferredSkillSurface: "runtime",
      readOnlyRetrieval: true,
      workflowContract: {
        recommendedPreset: "state=auto, limit=8",
        cliFallback: {
          searchCommand: `cam recall search "<query>" --state auto --limit 8 --cwd ${shellQuoteArg(await fs.realpath(projectDir))}`
        },
        postWorkSyncReview: {
          helperScript: "post-work-memory-review.sh"
        }
      },
      assets: expect.arrayContaining([
        expect.objectContaining({
          id: "codex-memory-skill"
        })
      ])
    });
  });

  it("installs skill assets under CODEX_HOME when it is set", async () => {
    const homeDir = await tempDir("cam-skills-codex-home-home-");
    const codexHome = await tempDir("cam-skills-codex-home-codex-home-");
    const projectDir = await tempDir("cam-skills-codex-home-project-");
    process.env.HOME = homeDir;
    process.env.CODEX_HOME = codexHome;

    const result = runCli(projectDir, ["skills", "install"]);
    expect(result.exitCode).toBe(0);

    const skillDir = path.join(
      codexHome,
      "skills",
      "codex-auto-memory-recall"
    );
    const skillFile = await fs.readFile(path.join(skillDir, "SKILL.md"), "utf8");

    expect(skillFile).toContain("cam:asset-version");
    expect(skillFile).toContain("search_memories");
    await expect(
      fs.access(
        path.join(
          homeDir,
          ".codex",
          "skills",
          "codex-auto-memory-recall",
          "SKILL.md"
        )
      )
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("installs an explicit official user skill copy without changing the runtime default", async () => {
    const homeDir = await tempDir("cam-skills-official-user-home-");
    const projectDir = await tempDir("cam-skills-official-user-project-");
    process.env.HOME = homeDir;
    delete process.env.CODEX_HOME;

    const result = runCli(projectDir, ["skills", "install", "--surface", "official-user"]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("Skill surface: official-user");
    expect(result.stdout).toContain("official .agents/skills copy");

    const officialSkillPath = path.join(
      homeDir,
      ".agents",
      "skills",
      "codex-auto-memory-recall",
      "SKILL.md"
    );
    const skillFile = await fs.readFile(officialSkillPath, "utf8");
    expect(skillFile).toContain("cam:asset-version");
    expect(skillFile).toContain("search_memories");

    await expect(
      fs.access(
        path.join(
          homeDir,
          ".codex",
          "skills",
          "codex-auto-memory-recall",
          "SKILL.md"
        )
      )
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("installs an explicit official project skill copy inside the project root", async () => {
    const homeDir = await tempDir("cam-skills-official-project-home-");
    const projectDir = await tempDir("cam-skills-official-project-project-");
    process.env.HOME = homeDir;
    delete process.env.CODEX_HOME;

    const result = runCli(projectDir, ["skills", "install", "--surface", "official-project"]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("Skill surface: official-project");

    const officialSkillPath = path.join(
      projectDir,
      ".agents",
      "skills",
      "codex-auto-memory-recall",
      "SKILL.md"
    );
    const skillFile = await fs.readFile(officialSkillPath, "utf8");
    expect(skillFile).toContain("cam:asset-version");
    expect(skillFile).toContain("timeline_memories");

    await expect(
      fs.access(
        path.join(
          homeDir,
          ".codex",
          "skills",
          "codex-auto-memory-recall",
          "SKILL.md"
        )
      )
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("trims CODEX_HOME before choosing the runtime skill directory", async () => {
    const homeDir = await tempDir("cam-skills-trimmed-codex-home-home-");
    const codexHome = await tempDir("cam-skills-trimmed-codex-home-codex-home-");
    const projectDir = await tempDir("cam-skills-trimmed-codex-home-project-");
    process.env.HOME = homeDir;
    process.env.CODEX_HOME = `  ${codexHome}  `;

    const result = runCli(projectDir, ["skills", "install"], {
      env: { HOME: homeDir, CODEX_HOME: `  ${codexHome}  ` }
    });
    expect(result.exitCode, result.stderr).toBe(0);

    const trimmedSkillPath = path.join(codexHome, "skills", "codex-auto-memory-recall", "SKILL.md");
    const spacedSkillPath = path.join(`  ${codexHome}  `, "skills", "codex-auto-memory-recall", "SKILL.md");
    await expect(fs.access(trimmedSkillPath)).resolves.toBeUndefined();
    await expect(fs.access(spacedSkillPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails closed when CODEX_HOME is relative", async () => {
    const homeDir = await tempDir("cam-skills-relative-codex-home-home-");
    const projectDir = await tempDir("cam-skills-relative-codex-home-project-");
    process.env.HOME = homeDir;
    process.env.CODEX_HOME = "relative-codex-home";

    const result = runCli(projectDir, ["skills", "install"], {
      env: { HOME: homeDir, CODEX_HOME: "relative-codex-home" }
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("CODEX_HOME");
    expect(result.stderr).toContain("absolute path");
  });
});
