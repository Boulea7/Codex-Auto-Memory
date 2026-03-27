import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { restoreOptionalEnv } from "./helpers/env.js";
import { makeAppConfig, writeCamConfig } from "./helpers/cam-test-fixtures.js";
import { runCli } from "./helpers/cli-runner.js";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;
const originalCodexHome = process.env.CODEX_HOME;

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function writeCamShim(binDir: string): Promise<void> {
  if (process.platform === "win32") {
    await fs.writeFile(path.join(binDir, "cam.cmd"), "@echo off\r\nexit /b 0\r\n", "utf8");
    return;
  }

  const shimPath = path.join(binDir, "cam");
  await fs.writeFile(shimPath, "#!/bin/sh\nexit 0\n", "utf8");
  await fs.chmod(shimPath, 0o755);
}

async function pathContainsCam(dir: string): Promise<boolean> {
  const candidates =
    process.platform === "win32"
      ? [path.join(dir, "cam.cmd"), path.join(dir, "cam.exe")]
      : [path.join(dir, "cam")];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return true;
    }
  }

  return false;
}

async function buildPathWithoutCam(extraDir: string): Promise<string> {
  const baseEntries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const filteredEntries: string[] = [];

  for (const entry of baseEntries) {
    if (!(await pathContainsCam(entry))) {
      filteredEntries.push(entry);
    }
  }

  return [extraDir, ...filteredEntries].join(path.delimiter);
}

function shellQuoteArg(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

afterEach(async () => {
  restoreOptionalEnv("HOME", originalHome);
  restoreOptionalEnv("CODEX_HOME", originalCodexHome);
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("integrations command", () => {
  it("installs the recommended Codex integration stack without creating memory layout", async () => {
    const homeDir = await tempDir("cam-integrations-home-");
    const projectDir = await tempDir("cam-integrations-project-");
    const memoryRootParent = await tempDir("cam-integrations-memory-parent-");
    const memoryRoot = path.join(memoryRootParent, "memory-root");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    await writeCamConfig(projectDir, makeAppConfig(), {
      autoMemoryDirectory: memoryRoot
    });

    const first = runCli(
      projectDir,
      ["integrations", "install", "--host", "codex", "--json"],
      { env: { HOME: homeDir } }
    );
    expect(first.exitCode, first.stderr).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realProjectDir,
      stackAction: "created",
      skillsSurface: "runtime",
      readOnlyRetrieval: true,
      subactions: {
        mcp: {
          status: "ok",
          action: "created",
          targetPath: path.join(realProjectDir, ".codex", "config.toml"),
          projectPinned: true,
          readOnlyRetrieval: true
        },
        hooks: {
          status: "ok",
          action: "created",
          targetDir: path.join(homeDir, ".codex-auto-memory", "hooks"),
          readOnlyRetrieval: true
        },
        skills: {
          status: "ok",
          action: "created",
          targetDir: path.join(homeDir, ".codex", "skills", "codex-auto-memory-recall"),
          surface: "runtime",
          readOnlyRetrieval: true
        }
      }
    });

    expect(
      await fs.readFile(path.join(realProjectDir, ".codex", "config.toml"), "utf8")
    ).toContain("[mcp_servers.codex_auto_memory]");
    expect(
      await fs.readFile(path.join(homeDir, ".codex-auto-memory", "hooks", "memory-recall.sh"), "utf8")
    ).toContain("cam:asset-version");
    expect(
      await fs.readFile(
        path.join(homeDir, ".codex", "skills", "codex-auto-memory-recall", "SKILL.md"),
        "utf8"
      )
    ).toContain("cam:asset-version");
    expect(await pathExists(memoryRoot)).toBe(false);

    const second = runCli(
      projectDir,
      ["integrations", "install", "--host", "codex", "--json"],
      { env: { HOME: homeDir } }
    );
    expect(second.exitCode, second.stderr).toBe(0);
    expect(JSON.parse(second.stdout)).toMatchObject({
      host: "codex",
      stackAction: "unchanged",
      subactions: {
        mcp: { action: "unchanged" },
        hooks: { action: "unchanged" },
        skills: { action: "unchanged" }
      }
    });
  });

  it("rejects non-codex hosts for the integration stack orchestration surface", async () => {
    const homeDir = await tempDir("cam-integrations-invalid-home-");
    const projectDir = await tempDir("cam-integrations-invalid-project-");
    process.env.HOME = homeDir;

    const result = runCli(projectDir, ["integrations", "install", "--host", "gemini"], {
      env: { HOME: homeDir }
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Codex-only");
    expect(result.stderr).toContain("codex");
  });

  it("surfaces the missing Codex integration stack through integrations doctor without creating memory layout", async () => {
    const homeDir = await tempDir("cam-integrations-doctor-missing-home-");
    const projectDir = await tempDir("cam-integrations-doctor-missing-project-");
    const emptyPathDir = await tempDir("cam-integrations-doctor-empty-path-");
    const memoryRootParent = await tempDir("cam-integrations-doctor-missing-memory-parent-");
    const memoryRoot = path.join(memoryRootParent, "memory-root");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    await writeCamConfig(projectDir, makeAppConfig(), {
      autoMemoryDirectory: memoryRoot
    });

    const result = runCli(
      projectDir,
      ["integrations", "doctor", "--host", "codex", "--json"],
      {
        env: {
          HOME: homeDir,
          PATH: await buildPathWithoutCam(emptyPathDir)
        }
      }
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realProjectDir,
      readOnlyRetrieval: true,
      status: "missing",
      recommendedRoute: "cli-direct",
      recommendedPreset: "state=auto, limit=8",
      retrievalSidecar: {
        status: "warning",
        checks: expect.arrayContaining([
          expect.objectContaining({
            scope: "project",
            state: "active",
            status: "missing",
            fallbackReason: "missing"
          })
        ])
      },
      subchecks: {
        mcp: {
          status: "missing"
        },
        agents: {
          status: "missing"
        },
        hookCapture: {
          status: "missing"
        },
        hookRecall: {
          status: "missing"
        },
        skill: {
          status: "missing"
        },
        workflowConsistency: {
          status: "missing"
        }
      }
    });
    expect(JSON.parse(result.stdout).nextSteps[0]).toContain(
      "cam integrations apply --host codex"
    );
    expect(JSON.parse(result.stdout).nextSteps).toEqual(
      expect.arrayContaining([
        expect.stringContaining("cam mcp print-config --host codex")
      ])
    );
    expect(await pathExists(memoryRoot)).toBe(false);
  });

  it("keeps doctor next steps pinned to the inspected project when --cwd targets another directory", async () => {
    const homeDir = await tempDir("cam-integrations-doctor-cwd-home-");
    const projectParentDir = await tempDir("cam-integrations-doctor-cwd-project-parent-");
    const projectDir = path.join(projectParentDir, "project with spaces");
    const shellDir = await tempDir("cam-integrations-doctor-cwd-shell-");
    const emptyPathDir = await tempDir("cam-integrations-doctor-cwd-empty-path-");
    process.env.HOME = homeDir;

    await fs.mkdir(projectDir, { recursive: true });

    const result = runCli(
      shellDir,
      ["integrations", "doctor", "--host", "codex", "--cwd", projectDir, "--json"],
      {
        env: {
          HOME: homeDir,
          PATH: await buildPathWithoutCam(emptyPathDir)
        }
      }
    );
    expect(result.exitCode, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      projectRoot: string;
      recommendedSkillInstallCommand: string;
      workflowContract: {
        cliFallback: {
          searchCommand: string;
        };
      };
      nextSteps: string[];
    };
    expect(payload.projectRoot).toBe(await fs.realpath(projectDir));
    expect(payload.recommendedSkillInstallCommand).toBe(
      `cam skills install --surface runtime --cwd ${shellQuoteArg(payload.projectRoot)}`
    );
    expect(payload.workflowContract.cliFallback.searchCommand).toBe(
      `cam recall search "<query>" --state auto --limit 8 --cwd ${shellQuoteArg(payload.projectRoot)}`
    );
    expect(payload.nextSteps).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          `cam integrations apply --host codex --skill-surface runtime --cwd ${shellQuoteArg(payload.projectRoot)}`
        ),
        expect.stringContaining(
          `cam integrations install --host codex --cwd ${shellQuoteArg(payload.projectRoot)}`
        ),
        expect.stringContaining(
          `cam mcp print-config --host codex --cwd ${shellQuoteArg(payload.projectRoot)}`
        ),
        expect.stringContaining(
          `cam recall search "<query>" --state auto --limit 8 --cwd ${shellQuoteArg(payload.projectRoot)}`
        )
      ])
    );
  });

  it("keeps the AGENTS-only repair step pinned to the inspected project when --cwd targets another directory", async () => {
    const homeDir = await tempDir("cam-integrations-doctor-agents-cwd-home-");
    const projectDir = await tempDir("cam-integrations-doctor-agents-cwd-project-");
    const shellDir = await tempDir("cam-integrations-doctor-agents-cwd-shell-");
    const binDir = await tempDir("cam-integrations-doctor-agents-cwd-bin-");
    process.env.HOME = homeDir;

    await writeCamShim(binDir);
    const env = {
      HOME: homeDir,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`
    };

    const installResult = runCli(
      projectDir,
      ["integrations", "install", "--host", "codex", "--json"],
      { env }
    );
    expect(installResult.exitCode, installResult.stderr).toBe(0);

    const result = runCli(
      shellDir,
      ["integrations", "doctor", "--host", "codex", "--cwd", projectDir, "--json"],
      { env }
    );
    expect(result.exitCode, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      projectRoot: string;
      nextSteps: string[];
    };
    expect(payload.nextSteps).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          `cam mcp apply-guidance --host codex --cwd ${shellQuoteArg(payload.projectRoot)}`
        ),
        expect.stringContaining(
          `cam mcp print-config --host codex --cwd ${shellQuoteArg(payload.projectRoot)}`
        )
      ])
    );
    expect(payload.nextSteps).not.toEqual(
      expect.arrayContaining([expect.stringContaining("cam hooks install")])
    );
    expect(payload.nextSteps).not.toEqual(
      expect.arrayContaining([expect.stringContaining("cam skills install")])
    );
  });

  it("suggests a project-pinned hooks install command when hook helpers are missing", async () => {
    const homeDir = await tempDir("cam-integrations-doctor-hooks-home-");
    const projectDir = await tempDir("cam-integrations-doctor-hooks-project-");
    const shellDir = await tempDir("cam-integrations-doctor-hooks-shell-");
    const binDir = await tempDir("cam-integrations-doctor-hooks-bin-");
    process.env.HOME = homeDir;

    await writeCamShim(binDir);
    const env = {
      HOME: homeDir,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`
    };

    const installResult = runCli(
      projectDir,
      ["integrations", "install", "--host", "codex", "--json"],
      { env }
    );
    expect(installResult.exitCode, installResult.stderr).toBe(0);

    await fs.rm(path.join(homeDir, ".codex-auto-memory", "hooks"), {
      recursive: true,
      force: true
    });

    const result = runCli(
      shellDir,
      ["integrations", "doctor", "--host", "codex", "--cwd", projectDir, "--json"],
      { env }
    );
    expect(result.exitCode, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      projectRoot: string;
      nextSteps: string[];
    };
    expect(payload.nextSteps).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          `cam hooks install --cwd ${JSON.stringify(payload.projectRoot)}`
        )
      ])
    );
  });

  it("surfaces a ready Codex integration stack through integrations doctor", async () => {
    const homeDir = await tempDir("cam-integrations-doctor-ready-home-");
    const projectDir = await tempDir("cam-integrations-doctor-ready-project-");
    const binDir = await tempDir("cam-integrations-doctor-ready-bin-");
    const memoryRootParent = await tempDir("cam-integrations-doctor-ready-memory-parent-");
    const memoryRoot = path.join(memoryRootParent, "memory-root");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    await writeCamShim(binDir);
    await writeCamConfig(projectDir, makeAppConfig(), {
      autoMemoryDirectory: memoryRoot
    });

    const env = {
      HOME: homeDir,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`
    };

    const installResult = runCli(
      projectDir,
      ["integrations", "install", "--host", "codex", "--json"],
      { env }
    );
    expect(installResult.exitCode, installResult.stderr).toBe(0);

    const printConfigResult = runCli(
      projectDir,
      ["mcp", "print-config", "--host", "codex", "--json"],
      { env }
    );
    expect(printConfigResult.exitCode, printConfigResult.stderr).toBe(0);
    const printConfigPayload = JSON.parse(printConfigResult.stdout) as {
      agentsGuidance: { snippet: string };
    };
    await fs.writeFile(
      path.join(realProjectDir, "AGENTS.md"),
      `${printConfigPayload.agentsGuidance.snippet}\n`,
      "utf8"
    );

    const doctorResult = runCli(
      projectDir,
      ["integrations", "doctor", "--host", "codex", "--json"],
      { env }
    );
    expect(doctorResult.exitCode, doctorResult.stderr).toBe(0);
    expect(JSON.parse(doctorResult.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realProjectDir,
      readOnlyRetrieval: true,
      status: "ok",
      recommendedRoute: "mcp",
      recommendedPreset: "state=auto, limit=8",
      workflowContract: {
        version: expect.any(String),
        postWorkSyncReview: {
          helperScript: "post-work-memory-review.sh",
          syncCommand: "cam sync",
          reviewCommand: "cam memory --recent"
        }
      },
      subchecks: {
        mcp: {
          status: "ok"
        },
        agents: {
          status: "ok"
        },
        hookCapture: {
          status: "ok"
        },
        hookRecall: {
          status: "ok"
        },
        skill: {
          status: "ok"
        },
        workflowConsistency: {
          status: "ok"
        }
      }
    });
    expect(JSON.parse(doctorResult.stdout).nextSteps).toEqual(
      expect.arrayContaining([
        expect.stringContaining("cam mcp print-config --host codex"),
        expect.stringContaining("Prefer retrieval MCP")
      ])
    );
    expect(await pathExists(memoryRoot)).toBe(false);
  });

  it("does not let a fenced AGENTS guidance example satisfy integrations doctor", async () => {
    const homeDir = await tempDir("cam-integrations-doctor-fenced-home-");
    const projectDir = await tempDir("cam-integrations-doctor-fenced-project-");
    const binDir = await tempDir("cam-integrations-doctor-fenced-bin-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    await writeCamShim(binDir);
    const env = {
      HOME: homeDir,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`
    };

    const installResult = runCli(
      projectDir,
      ["integrations", "install", "--host", "codex", "--json"],
      { env }
    );
    expect(installResult.exitCode, installResult.stderr).toBe(0);

    const printConfigResult = runCli(
      projectDir,
      ["mcp", "print-config", "--host", "codex", "--json"],
      { env }
    );
    expect(printConfigResult.exitCode, printConfigResult.stderr).toBe(0);
    const printConfigPayload = JSON.parse(printConfigResult.stdout) as {
      agentsGuidance: { snippet: string };
    };
    await fs.writeFile(
      path.join(realProjectDir, "AGENTS.md"),
      ["# Example", "", "```md", printConfigPayload.agentsGuidance.snippet, "```"].join("\n"),
      "utf8"
    );

    const doctorResult = runCli(
      projectDir,
      ["integrations", "doctor", "--host", "codex", "--json"],
      { env }
    );
    expect(doctorResult.exitCode, doctorResult.stderr).toBe(0);
    expect(JSON.parse(doctorResult.stdout)).toMatchObject({
      subchecks: {
        agents: {
          status: "warning"
        }
      }
    });
    expect(JSON.parse(doctorResult.stdout).nextSteps).toEqual(
      expect.arrayContaining([
        expect.stringContaining("cam mcp apply-guidance --host codex")
      ])
    );
  });

  it("uses action-aware text output for integrations install", async () => {
    const homeDir = await tempDir("cam-integrations-text-home-");
    const projectDir = await tempDir("cam-integrations-text-project-");
    process.env.HOME = homeDir;

    const created = runCli(projectDir, ["integrations", "install", "--host", "codex"], {
      env: { HOME: homeDir }
    });
    expect(created.exitCode, created.stderr).toBe(0);
    expect(created.stdout).toContain("Installed Codex integration stack.");

    const unchanged = runCli(projectDir, ["integrations", "install", "--host", "codex"], {
      env: { HOME: homeDir }
    });
    expect(unchanged.exitCode, unchanged.stderr).toBe(0);
    expect(unchanged.stdout).toContain("Codex integration stack is already up to date.");
  });

  it("applies the full Codex integration stack including AGENTS guidance", async () => {
    const homeDir = await tempDir("cam-integrations-apply-home-");
    const projectDir = await tempDir("cam-integrations-apply-project-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    const result = runCli(
      projectDir,
      ["integrations", "apply", "--host", "codex", "--json"],
      { env: { HOME: homeDir } }
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realProjectDir,
      stackAction: "created",
      skillsSurface: "runtime",
      readOnlyRetrieval: true,
      subactions: {
        mcp: {
          status: "ok",
          action: "created"
        },
        agents: {
          status: "ok",
          action: "created",
          targetPath: path.join(realProjectDir, "AGENTS.md")
        },
        hooks: {
          status: "ok",
          action: "created"
        },
        skills: {
          status: "ok",
          action: "created",
          surface: "runtime"
        }
      }
    });
    expect(await fs.readFile(path.join(realProjectDir, "AGENTS.md"), "utf8")).toContain(
      "cam:codex-agents-guidance:start"
    );
  });

  it("keeps integrations apply fail-closed for the AGENTS subaction when managed guidance is unsafe", async () => {
    const homeDir = await tempDir("cam-integrations-apply-blocked-home-");
    const projectDir = await tempDir("cam-integrations-apply-blocked-project-");
    const realProjectDir = await fs.realpath(projectDir);
    const configPath = path.join(realProjectDir, ".codex", "config.toml");
    const hooksDir = path.join(homeDir, ".codex-auto-memory", "hooks");
    const skillDir = path.join(homeDir, ".codex", "skills", "codex-auto-memory-recall");
    process.env.HOME = homeDir;

    await fs.writeFile(
      path.join(realProjectDir, "AGENTS.md"),
      [
        "# Project Notes",
        "",
        "<!-- cam:codex-agents-guidance:start -->",
        "<!-- cam:agents-guidance-version codex-agents-guidance-v0 -->",
        "- stale guidance"
      ].join("\n"),
      "utf8"
    );

    const before = await fs.readFile(path.join(realProjectDir, "AGENTS.md"), "utf8");
    const result = runCli(
      projectDir,
      ["integrations", "apply", "--host", "codex", "--json"],
      { env: { HOME: homeDir } }
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realProjectDir,
      stackAction: "blocked",
      preflightBlocked: true,
      blockedStage: "agents-guidance-preflight",
      subactions: {
        mcp: {
          status: "ok",
          action: "unchanged",
          attempted: false,
          skipped: true,
          skipReason: expect.stringContaining("preflight")
        },
        agents: {
          status: "blocked",
          action: "blocked",
          attempted: true,
          targetPath: path.join(realProjectDir, "AGENTS.md")
        },
        hooks: {
          status: "ok",
          action: "unchanged",
          attempted: false,
          skipped: true,
          skipReason: expect.stringContaining("preflight")
        },
        skills: {
          status: "ok",
          action: "unchanged",
          attempted: false,
          skipped: true,
          skipReason: expect.stringContaining("preflight"),
          surface: "runtime"
        }
      }
    });
    expect(await fs.readFile(path.join(realProjectDir, "AGENTS.md"), "utf8")).toBe(before);
    expect(await pathExists(configPath)).toBe(false);
    expect(await pathExists(hooksDir)).toBe(false);
    expect(await pathExists(skillDir)).toBe(false);
  });

  it("withholds integrations apply from doctor next steps when AGENTS guidance is unsafe", async () => {
    const homeDir = await tempDir("cam-integrations-doctor-blocked-home-");
    const projectDir = await tempDir("cam-integrations-doctor-blocked-project-");
    const shellDir = await tempDir("cam-integrations-doctor-blocked-shell-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    await fs.writeFile(
      path.join(realProjectDir, "AGENTS.md"),
      [
        "# Project Notes",
        "",
        "<!-- cam:codex-agents-guidance:start -->",
        "<!-- cam:agents-guidance-version codex-agents-guidance-v0 -->",
        "- stale guidance"
      ].join("\n"),
      "utf8"
    );

    const result = runCli(
      shellDir,
      ["integrations", "doctor", "--host", "codex", "--cwd", projectDir, "--json"],
      { env: { HOME: homeDir } }
    );
    expect(result.exitCode, result.stderr).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      applyReadiness: {
        status: string;
        reason: string;
        recommendedFix: string;
      };
      nextSteps: string[];
    };
    expect(payload.applyReadiness).toMatchObject({
      status: "blocked",
      reason: expect.stringContaining("managed guidance block"),
      recommendedFix: expect.stringContaining("Repair")
    });
    expect(payload.applyReadiness.recommendedFix).toContain(
      `cam mcp apply-guidance --host codex --cwd ${shellQuoteArg(realProjectDir)}`
    );
    expect(payload.nextSteps).not.toEqual(
      expect.arrayContaining([expect.stringContaining("cam integrations apply --host codex")])
    );
    expect(payload.nextSteps).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          `cam mcp apply-guidance --host codex --cwd ${shellQuoteArg(realProjectDir)}`
        )
      ])
    );
  });

  it("keeps integrations install non-mutating for AGENTS.md while integrations apply writes it", async () => {
    const homeDir = await tempDir("cam-integrations-apply-boundary-home-");
    const projectDir = await tempDir("cam-integrations-apply-boundary-project-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    const installResult = runCli(
      projectDir,
      ["integrations", "install", "--host", "codex", "--json"],
      { env: { HOME: homeDir } }
    );
    expect(installResult.exitCode, installResult.stderr).toBe(0);
    await expect(fs.access(path.join(realProjectDir, "AGENTS.md"))).rejects.toMatchObject({
      code: "ENOENT"
    });

    const applyResult = runCli(
      projectDir,
      ["integrations", "apply", "--host", "codex", "--json"],
      { env: { HOME: homeDir } }
    );
    expect(applyResult.exitCode, applyResult.stderr).toBe(0);
    expect(JSON.parse(applyResult.stdout)).toMatchObject({
      stackAction: "updated",
      subactions: {
        mcp: { action: "unchanged" },
        agents: { action: "created" },
        hooks: { action: "unchanged" },
        skills: { action: "unchanged" }
      }
    });
  });

  it("uses CODEX_HOME as the runtime skill location for integrations install and doctor", async () => {
    const homeDir = await tempDir("cam-integrations-codex-home-home-");
    const codexHome = await tempDir("cam-integrations-codex-home-codex-home-");
    const projectDir = await tempDir("cam-integrations-codex-home-project-");
    const binDir = await tempDir("cam-integrations-codex-home-bin-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;
    process.env.CODEX_HOME = codexHome;

    await writeCamShim(binDir);
    const env = {
      HOME: homeDir,
      CODEX_HOME: codexHome,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`
    };

    const installResult = runCli(
      projectDir,
      ["integrations", "install", "--host", "codex", "--json"],
      { env }
    );
    expect(installResult.exitCode, installResult.stderr).toBe(0);
    expect(JSON.parse(installResult.stdout)).toMatchObject({
      subactions: {
        skills: {
          targetDir: path.join(codexHome, "skills", "codex-auto-memory-recall"),
          surface: "runtime"
        }
      }
    });

    const printConfigResult = runCli(
      projectDir,
      ["mcp", "print-config", "--host", "codex", "--json"],
      { env }
    );
    expect(printConfigResult.exitCode, printConfigResult.stderr).toBe(0);
    const printConfigPayload = JSON.parse(printConfigResult.stdout) as {
      agentsGuidance: { snippet: string };
    };
    await fs.writeFile(
      path.join(realProjectDir, "AGENTS.md"),
      `${printConfigPayload.agentsGuidance.snippet}\n`,
      "utf8"
    );

    const doctorResult = runCli(
      projectDir,
      ["integrations", "doctor", "--host", "codex", "--json"],
      { env }
    );
    expect(doctorResult.exitCode, doctorResult.stderr).toBe(0);
    expect(JSON.parse(doctorResult.stdout)).toMatchObject({
      subchecks: {
        agents: {
          status: "ok"
        },
        skill: {
          status: "ok"
        }
      },
      preferredSkillSurface: "runtime",
      recommendedSkillInstallCommand: "cam skills install --surface runtime",
      installedSkillSurfaces: ["runtime"],
      readySkillSurfaces: ["runtime"]
    });
  });

  it("passes through an explicit official user skill surface for integrations install and apply", async () => {
    const homeDir = await tempDir("cam-integrations-official-surface-home-");
    const projectDir = await tempDir("cam-integrations-official-surface-project-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    const installResult = runCli(
      projectDir,
      ["integrations", "install", "--host", "codex", "--skill-surface", "official-user", "--json"],
      { env: { HOME: homeDir } }
    );
    expect(installResult.exitCode, installResult.stderr).toBe(0);
    expect(JSON.parse(installResult.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realProjectDir,
      skillsSurface: "official-user",
      subactions: {
        skills: {
          action: "created",
          surface: "official-user",
          targetDir: path.join(homeDir, ".agents", "skills", "codex-auto-memory-recall")
        }
      }
    });

    const applyResult = runCli(
      projectDir,
      ["integrations", "apply", "--host", "codex", "--skill-surface", "official-user", "--json"],
      { env: { HOME: homeDir } }
    );
    expect(applyResult.exitCode, applyResult.stderr).toBe(0);
    expect(JSON.parse(applyResult.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realProjectDir,
      skillsSurface: "official-user",
      subactions: {
        skills: {
          surface: "official-user",
          targetDir: path.join(homeDir, ".agents", "skills", "codex-auto-memory-recall")
        }
      }
    });
    expect(
      await fs.readFile(
        path.join(homeDir, ".agents", "skills", "codex-auto-memory-recall", "SKILL.md"),
        "utf8"
      )
    ).toContain("cam:asset-version");
  });

  it("passes through an explicit official project skill surface for integrations install and apply", async () => {
    const homeDir = await tempDir("cam-integrations-official-project-home-");
    const projectDir = await tempDir("cam-integrations-official-project-project-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    const installResult = runCli(
      projectDir,
      [
        "integrations",
        "install",
        "--host",
        "codex",
        "--skill-surface",
        "official-project",
        "--json"
      ],
      { env: { HOME: homeDir } }
    );
    expect(installResult.exitCode, installResult.stderr).toBe(0);
    const installPayload = JSON.parse(installResult.stdout) as {
      host: string;
      projectRoot: string;
      skillsSurface: string;
      subactions: {
        skills: {
          action: string;
          surface: string;
          targetDir: string;
        };
      };
      notes: string[];
    };
    expect(installPayload).toMatchObject({
      host: "codex",
      projectRoot: realProjectDir,
      skillsSurface: "official-project",
      subactions: {
        skills: {
          action: "created",
          surface: "official-project",
          targetDir: path.join(realProjectDir, ".agents", "skills", "codex-auto-memory-recall")
        }
      }
    });
    expect(installPayload.notes).toEqual(
      expect.arrayContaining([expect.stringContaining("project-scoped official .agents/skills copy")])
    );

    const applyResult = runCli(
      projectDir,
      [
        "integrations",
        "apply",
        "--host",
        "codex",
        "--skill-surface",
        "official-project",
        "--json"
      ],
      { env: { HOME: homeDir } }
    );
    expect(applyResult.exitCode, applyResult.stderr).toBe(0);
    const applyPayload = JSON.parse(applyResult.stdout) as {
      host: string;
      projectRoot: string;
      skillsSurface: string;
      subactions: {
        skills: {
          surface: string;
          targetDir: string;
        };
      };
      notes: string[];
    };
    expect(applyPayload).toMatchObject({
      host: "codex",
      projectRoot: realProjectDir,
      skillsSurface: "official-project",
      subactions: {
        skills: {
          surface: "official-project",
          targetDir: path.join(realProjectDir, ".agents", "skills", "codex-auto-memory-recall")
        }
      }
    });
    expect(applyPayload.notes).toEqual(
      expect.arrayContaining([expect.stringContaining("project-scoped official .agents/skills copy")])
    );
    expect(
      await fs.readFile(
        path.join(realProjectDir, ".agents", "skills", "codex-auto-memory-recall", "SKILL.md"),
        "utf8"
      )
    ).toContain("cam:asset-version");
  });
});
