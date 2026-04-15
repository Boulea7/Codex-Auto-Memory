import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildResolvedCliCommand,
  buildResolvedCliSearchCommand,
  buildWorkflowContract
} from "../src/lib/integration/retrieval-contract.js";
import { sanitizePublicPath } from "../src/lib/util/public-paths.js";
import { makeAppConfig, writeCamConfig } from "./helpers/cam-test-fixtures.js";
import { runCli } from "./helpers/cli-runner.js";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;
const originalCodexHome = process.env.CODEX_HOME;
const originalPath = process.env.PATH;

function shellQuoteArg(value: string): string {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function withFakePackagedDistCli<T>(callback: () => Promise<T>): Promise<T> {
  const fakeDistDir = await tempDir("cam-fake-dist-cli-");
  const fakeDistCliPath = path.join(fakeDistDir, "cli.js");
  const originalOverride = process.env.CODEX_AUTO_MEMORY_DIST_CLI_PATH;
  await fs.writeFile(
    fakeDistCliPath,
    "#!/usr/bin/env node\nconsole.log('fake dist cli');\n",
    "utf8"
  );
  process.env.CODEX_AUTO_MEMORY_DIST_CLI_PATH = fakeDistCliPath;

  try {
    return await callback();
  } finally {
    if (originalOverride === undefined) {
      delete process.env.CODEX_AUTO_MEMORY_DIST_CLI_PATH;
    } else {
      process.env.CODEX_AUTO_MEMORY_DIST_CLI_PATH = originalOverride;
    }
  }
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

function buildStableCliEnv(
  homeDir: string,
  overrides: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  return {
    HOME: homeDir,
    PATH: originalPath ?? process.env.PATH ?? "",
    CODEX_HOME: originalCodexHome ?? "",
    ...overrides
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  process.env.HOME = originalHome;
  if (originalCodexHome === undefined) {
    delete process.env.CODEX_HOME;
  } else {
    process.env.CODEX_HOME = originalCodexHome;
  }
  if (originalPath === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = originalPath;
  }
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("integrations command", () => {
  it("fails closed when integrations install, apply, and doctor use empty, whitespace-only, or missing --cwd", async () => {
    const homeDir = await tempDir("cam-integrations-empty-cwd-home-");
    const projectDir = await tempDir("cam-integrations-empty-cwd-project-");
    process.env.HOME = homeDir;
    const missingDir = path.join(projectDir, "missing-project");

    for (const command of [
      ["integrations", "install", "--host", "codex"] as const,
      ["integrations", "apply", "--host", "codex"] as const,
      ["integrations", "doctor", "--host", "codex"] as const
    ]) {
      for (const cwd of ["", "   ", missingDir]) {
        const result = runCli(projectDir, [...command, "--cwd", cwd], {
          env: buildStableCliEnv(homeDir)
        });
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("--cwd must be a non-empty path to an existing directory.");
      }
    }
  });
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
      { env: buildStableCliEnv(homeDir) }
    );
    expect(first.exitCode, first.stderr).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realProjectDir,
      stackAction: "created",
      skillsSurface: "runtime",
      readOnlyRetrieval: true,
      workflowContract: {
        recommendedPreset: "state=auto, limit=8",
        cliFallback: {
          searchCommand: `cam recall search "<query>" --state auto --limit 8 --cwd '${realProjectDir}'`
        }
      },
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
      { env: buildStableCliEnv(homeDir) }
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

  it("defaults Codex-only integration commands to host=codex", async () => {
    const homeDir = await tempDir("cam-integrations-default-host-home-");
    const projectDir = await tempDir("cam-integrations-default-host-project-");
    const memoryRoot = await tempDir("cam-integrations-default-host-memory-");
    process.env.HOME = homeDir;

    await writeCamConfig(projectDir, makeAppConfig(), {
      autoMemoryDirectory: memoryRoot
    });

    const installResult = runCli(projectDir, ["integrations", "install", "--json"], {
      env: buildStableCliEnv(homeDir)
    });
    expect(installResult.exitCode, installResult.stderr).toBe(0);
    expect(JSON.parse(installResult.stdout)).toMatchObject({
      host: "codex"
    });

    const applyResult = runCli(projectDir, ["integrations", "apply", "--json"], {
      env: buildStableCliEnv(homeDir)
    });
    expect(applyResult.exitCode, applyResult.stderr).toBe(0);
    expect(JSON.parse(applyResult.stdout)).toMatchObject({
      host: "codex"
    });

    const doctorResult = runCli(projectDir, ["integrations", "doctor", "--json"], {
      env: buildStableCliEnv(homeDir)
    });
    expect(doctorResult.exitCode, doctorResult.stderr).toBe(0);
    expect(JSON.parse(doctorResult.stdout)).toMatchObject({
      host: "codex"
    });
  });

  it("rejects non-codex hosts for the integration stack orchestration surface", async () => {
    const homeDir = await tempDir("cam-integrations-invalid-home-");
    const projectDir = await tempDir("cam-integrations-invalid-project-");
    process.env.HOME = homeDir;

    const result = runCli(projectDir, ["integrations", "install", "--host", "gemini"], {
      env: buildStableCliEnv(homeDir)
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
      projectRoot: sanitizePublicPath(realProjectDir, {
        projectRoot: realProjectDir
      }),
      readOnlyRetrieval: true,
      status: "missing",
      recommendedRoute: "mcp",
      recommendedPreset: "state=auto, limit=8",
      retrievalSidecar: {
        status: "warning",
        repairCommand: buildResolvedCliCommand("memory reindex --scope all --state all"),
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
    expect(JSON.parse(result.stdout).nextSteps).toEqual(
      expect.arrayContaining([
        expect.stringContaining(buildResolvedCliCommand("memory reindex --scope all --state all")),
        expect.stringContaining(buildResolvedCliCommand("integrations apply --host codex --skill-surface runtime")),
        expect.stringContaining(buildResolvedCliCommand("integrations install --host codex")),
        expect.stringContaining(buildResolvedCliSearchCommand("\"<query>\"")),
        expect.stringContaining(buildResolvedCliCommand("mcp print-config --host codex"))
      ])
    );
    expect(JSON.parse(result.stdout).nextSteps).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          `Until the stack is installed, use \`cam recall search "<query>" --state auto --limit 8 --cwd ${JSON.stringify(realProjectDir)}\` directly.`
        )
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
    expect(payload.projectRoot).toBe(
      sanitizePublicPath(await fs.realpath(projectDir), {
        projectRoot: await fs.realpath(projectDir)
      })
    );
    expect(payload.recommendedSkillInstallCommand).toContain(
      buildResolvedCliCommand("skills install --surface runtime")
    );
    expect(payload.recommendedSkillInstallCommand).toContain("<project-root>");
    expect(payload.workflowContract.cliFallback.searchCommand).toBe(
      `cam recall search "<query>" --state auto --limit 8 --cwd '${await fs.realpath(projectDir)}'`
    );
    expect(payload.nextSteps).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          `${buildResolvedCliCommand("integrations apply --host codex --skill-surface runtime")}`
        ),
        expect.stringContaining(
          buildResolvedCliCommand("integrations install --host codex")
        ),
        expect.stringContaining(buildResolvedCliCommand("mcp print-config --host codex")),
        expect.stringContaining(buildResolvedCliSearchCommand("\"<query>\"")),
        expect.stringContaining("<project-root>")
      ])
    );
  });

  it("passes through explicit experimental Codex hooks guidance in integrations doctor output", async () => {
    const homeDir = await tempDir("cam-integrations-doctor-experimental-hooks-home-");
    const projectDir = await tempDir("cam-integrations-doctor-experimental-hooks-project-");
    process.env.HOME = homeDir;

    const result = runCli(projectDir, ["integrations", "doctor", "--host", "codex", "--json"], {
      env: buildStableCliEnv(homeDir)
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      host: "codex",
      experimentalHooks: {
        status: "experimental",
        featureFlag: "codex_hooks",
        targetFileHint: ".codex/config.toml",
        snippet: expect.stringContaining("codex_hooks")
      }
    });
  });

  it("does not recommend integrations apply when only AGENTS guidance is missing but cam is unavailable on PATH", async () => {
    await withFakePackagedDistCli(async () => {
      const homeDir = await tempDir("cam-integrations-doctor-path-home-");
      const projectDir = await tempDir("cam-integrations-doctor-path-project-");
      const emptyPathDir = await tempDir("cam-integrations-doctor-path-empty-");
      process.env.HOME = homeDir;

      const env = {
        HOME: homeDir,
        PATH: await buildPathWithoutCam(emptyPathDir)
      };

      expect(runCli(projectDir, ["mcp", "install", "--host", "codex", "--json"], { env }).exitCode).toBe(0);
      expect(runCli(projectDir, ["hooks", "install", "--json"], { env }).exitCode).toBe(0);
      expect(runCli(projectDir, ["skills", "install", "--json"], { env }).exitCode).toBe(0);

      const result = runCli(projectDir, ["integrations", "doctor", "--host", "codex", "--json"], {
        env
      });
      expect(result.exitCode, result.stderr).toBe(0);

      const payload = JSON.parse(result.stdout) as {
        nextSteps: string[];
        subchecks: {
          hookCapture: { status: string };
          hookRecall: { status: string };
          agents: { status: string };
        };
      };

      expect(payload.subchecks).toMatchObject({
        hookCapture: { status: "ok" },
        hookRecall: { status: "ok" },
        agents: { status: "missing" }
      });
      expect(payload.nextSteps[0]).not.toContain("cam integrations apply --host codex");
      expect(payload.nextSteps).toEqual(
        expect.arrayContaining([
          expect.stringContaining(buildResolvedCliCommand("mcp apply-guidance --host codex"))
        ])
      );
    });
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
          "cam mcp apply-guidance --host codex --cwd '<project-root>'"
        ),
        expect.stringContaining(
          "cam mcp print-config --host codex --cwd '<project-root>'"
        )
      ])
    );
    expect(payload.nextSteps[0]).toContain(
      "cam mcp apply-guidance --host codex --cwd '<project-root>'"
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
        expect.stringContaining("cam hooks install --cwd '<project-root>'")
      ])
    );
  });

  it("pins hook fallback next steps to the inspected project when integrations doctor uses --cwd", async () => {
    await withFakePackagedDistCli(async () => {
      const homeDir = await tempDir("cam-integrations-doctor-hook-fallback-home-");
      const projectDir = await tempDir("cam-integrations-doctor-hook-fallback-project-");
      const shellDir = await tempDir("cam-integrations-doctor-hook-fallback-shell-");
      const emptyPathDir = await tempDir("cam-integrations-doctor-hook-fallback-empty-path-");
      process.env.HOME = homeDir;

      const env = {
        HOME: homeDir,
        PATH: await buildPathWithoutCam(emptyPathDir)
      };

      expect(runCli(projectDir, ["hooks", "install", "--json"], { env }).exitCode).toBe(0);
      expect(runCli(projectDir, ["skills", "install", "--json"], { env }).exitCode).toBe(0);

      const result = runCli(
        shellDir,
        ["integrations", "doctor", "--host", "codex", "--cwd", projectDir, "--json"],
        { env }
      );
      expect(result.exitCode, result.stderr).toBe(0);

      const payload = JSON.parse(result.stdout) as {
        projectRoot: string;
        recommendedRoute: string;
        nextSteps: string[];
      };
      expect(payload.recommendedRoute).toBe("mcp");
      expect(payload.nextSteps).toEqual(
        expect.arrayContaining([
          expect.stringContaining("CAM_PROJECT_ROOT='<project-root>'"),
          expect.stringContaining("memory-recall.sh")
        ])
      );
    });
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
      projectRoot: sanitizePublicPath(realProjectDir, {
        projectRoot: realProjectDir
      }),
      readOnlyRetrieval: true,
      status: "ok",
      recommendedRoute: "mcp",
      currentlyOperationalRoute: "mcp",
      routeKind: "preferred-mcp",
      routeEvidence: expect.arrayContaining([
        "mcp-config-present",
        "cam-command-available",
        "hook-recall-operational",
        "resolved-cli-launcher-verified"
      ]),
      shellDependencyLevel: "required",
      hostMutationRequired: false,
      currentOperationalBlockers: [],
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
          status: "ok",
          summary: expect.stringContaining("guidance")
        },
        workflowConsistency: {
          status: "ok"
        }
      }
    });
    expect(JSON.parse(doctorResult.stdout).routeEvidence).not.toContain("skill-guidance-ready");
    expect(JSON.parse(doctorResult.stdout).subchecks.skill.summary).not.toContain(
      "before direct CLI recall"
    );
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
      env: buildStableCliEnv(homeDir)
    });
    expect(created.exitCode, created.stderr).toBe(0);
    expect(created.stdout).toContain("Installed Codex integration stack.");
    expect(created.stdout).toContain("Run");
    expect(created.stdout).toContain("integrations doctor --host codex");
    expect(created.stdout).toContain("confirm which retrieval route is operational");
    expect(created.stdout).not.toContain("The recommended MCP route is ready");

    const unchanged = runCli(projectDir, ["integrations", "install", "--host", "codex"], {
      env: buildStableCliEnv(homeDir)
    });
    expect(unchanged.exitCode, unchanged.stderr).toBe(0);
    expect(unchanged.stdout).toContain("Codex integration stack is already up to date.");
    expect(unchanged.stdout).toContain("integrations doctor --host codex");
  });

  it("rolls back staged writes when integrations install fails after partial writes", async () => {
    const homeDir = await tempDir("cam-integrations-install-rollback-home-");
    const projectDir = await tempDir("cam-integrations-install-rollback-project-");
    const realProjectDir = await fs.realpath(projectDir);
    const configPath = path.join(realProjectDir, ".codex", "config.toml");
    const recallScriptPath = path.join(
      homeDir,
      ".codex-auto-memory",
      "hooks",
      "memory-recall.sh"
    );
    const skillFilePath = path.join(
      homeDir,
      ".codex",
      "skills",
      "codex-auto-memory-recall",
      "SKILL.md"
    );
    process.env.HOME = homeDir;

    vi.resetModules();
    const mcpInstallModule = await import("../src/lib/integration/mcp-install.js");
    const installAssetsModule = await import("../src/lib/integration/install-assets.js");
    const mcpConfigModule = await import("../src/lib/integration/mcp-config.js");

    vi.spyOn(mcpConfigModule, "resolveMcpProjectRoot").mockReturnValue(realProjectDir);
    vi.spyOn(mcpInstallModule, "installMcpProjectConfig").mockImplementation(async () => {
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, "[mcp_servers.codex_auto_memory]\n", "utf8");
      return {
        host: "codex",
        serverName: "codex_auto_memory",
        projectRoot: realProjectDir,
        targetPath: configPath,
        action: "created",
        projectPinned: true,
        readOnlyRetrieval: true,
        preservedCustomFields: [],
        notes: ["mcp wrote"]
      };
    });
    vi.spyOn(installAssetsModule, "installIntegrationAssets").mockImplementation(
      async (installSurface, options = {}) => {
        if (installSurface === "hooks") {
          await fs.mkdir(path.dirname(recallScriptPath), { recursive: true });
          await fs.writeFile(recallScriptPath, "#!/bin/sh\n", "utf8");
          return {
            installSurface,
            targetDir: path.dirname(recallScriptPath),
            action: "created",
            readOnlyRetrieval: true,
            assetVersion: "retrieval-contract-v1",
            recommendedPreset: "state=auto, limit=8",
            workflowContract: buildWorkflowContract({
              cwd: realProjectDir
            }),
            skillSurface: undefined,
            preferredSkillSurface: undefined,
            notes: ["hooks wrote"],
            assets: []
          };
        }

        const targetSkillDir =
          options.skillSurface === "official-project"
            ? path.join(realProjectDir, ".agents", "skills", "codex-auto-memory-recall")
            : options.skillSurface === "official-user"
              ? path.join(homeDir, ".agents", "skills", "codex-auto-memory-recall")
              : path.dirname(skillFilePath);
        const targetSkillFile =
          options.skillSurface === "runtime" || options.skillSurface === undefined
            ? skillFilePath
            : path.join(targetSkillDir, "SKILL.md");
        await fs.mkdir(path.dirname(targetSkillFile), { recursive: true });
        await fs.writeFile(targetSkillFile, "# partial skill\n", "utf8");
        throw new Error("simulated skill install failure");
      }
    );

    const { runIntegrationsInstall } = await import("../src/lib/commands/integrations.js");

    const payload = JSON.parse(
      await runIntegrationsInstall({
        cwd: realProjectDir,
        host: "codex",
        json: true
      })
    ) as {
      stackAction: string;
      rollbackApplied: boolean;
      rollbackSucceeded: boolean;
      rollbackErrors: string[];
      rollbackReport: Array<{ path: string; action: string }>;
      subactions: {
        mcp: { attempted: boolean; rolledBack?: boolean; effectiveAction?: string };
        hooks: { attempted: boolean; rolledBack?: boolean; effectiveAction?: string };
        skills: { attempted: boolean; surface: string };
      };
      notes: string[];
    };

    expect(payload).toMatchObject({
      stackAction: "failed",
      rollbackApplied: true,
      rollbackSucceeded: true,
      rollbackErrors: [],
      subactions: {
        mcp: {
          attempted: true,
          rolledBack: true,
          effectiveAction: "unchanged"
        },
        hooks: {
          attempted: true,
          rolledBack: true,
          effectiveAction: "unchanged"
        },
        skills: {
          attempted: false,
          surface: "runtime"
        }
      }
    });
    expect(payload.notes).toEqual(
      expect.arrayContaining([expect.stringContaining("simulated skill install failure")])
    );
    expect(payload.rollbackReport).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: configPath, action: "deleted-new" }),
        expect.objectContaining({ path: recallScriptPath, action: "deleted-new" })
      ])
    );

    expect(await pathExists(configPath)).toBe(false);
    expect(await pathExists(recallScriptPath)).toBe(false);
    expect(await pathExists(skillFilePath)).toBe(false);
  });

  it("restores dangling symlink rollback targets during integrations install failure recovery", async () => {
    const homeDir = await tempDir("cam-integrations-install-dangling-symlink-home-");
    const projectDir = await tempDir("cam-integrations-install-dangling-symlink-project-");
    const realProjectDir = await fs.realpath(projectDir);
    const configPath = path.join(realProjectDir, ".codex", "config.toml");
    const recallScriptPath = path.join(
      homeDir,
      ".codex-auto-memory",
      "hooks",
      "memory-recall.sh"
    );
    const danglingHookPath = path.join(
      homeDir,
      ".codex-auto-memory",
      "hooks",
      "post-work-memory-review.sh"
    );
    const danglingTarget = path.join(homeDir, ".tmp", "missing-post-work-memory-review.sh");
    process.env.HOME = homeDir;

    await fs.mkdir(path.dirname(danglingHookPath), { recursive: true });
    await fs.symlink(danglingTarget, danglingHookPath);

    vi.resetModules();
    const mcpInstallModule = await import("../src/lib/integration/mcp-install.js");
    const installAssetsModule = await import("../src/lib/integration/install-assets.js");
    const mcpConfigModule = await import("../src/lib/integration/mcp-config.js");
    vi.spyOn(mcpConfigModule, "resolveMcpProjectRoot").mockReturnValue(realProjectDir);
    vi.spyOn(mcpInstallModule, "installMcpProjectConfig").mockImplementation(async () => {
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, "[mcp_servers.codex_auto_memory]\n", "utf8");
      return {
        host: "codex",
        serverName: "codex_auto_memory",
        projectRoot: realProjectDir,
        targetPath: configPath,
        action: "created",
        projectPinned: true,
        readOnlyRetrieval: true,
        preservedCustomFields: [],
        notes: ["mcp wrote"]
      };
    });
    vi.spyOn(installAssetsModule, "installIntegrationAssets").mockImplementation(
      async (installSurface, options = {}) => {
        if (installSurface === "hooks") {
          await fs.mkdir(path.dirname(recallScriptPath), { recursive: true });
          await fs.writeFile(recallScriptPath, "#!/bin/sh\n", "utf8");
          return {
            installSurface,
            targetDir: path.dirname(recallScriptPath),
            action: "created",
            readOnlyRetrieval: true,
            assetVersion: "retrieval-contract-v1",
            recommendedPreset: "state=auto, limit=8",
            workflowContract: buildWorkflowContract({
              cwd: realProjectDir
            }),
            skillSurface: undefined,
            preferredSkillSurface: undefined,
            notes: ["hooks wrote"],
            assets: []
          };
        }

        const targetSkillDir =
          options.skillSurface === "official-project"
            ? path.join(realProjectDir, ".agents", "skills", "codex-auto-memory-recall")
            : options.skillSurface === "official-user"
              ? path.join(homeDir, ".agents", "skills", "codex-auto-memory-recall")
              : path.join(homeDir, ".codex", "skills", "codex-auto-memory-recall");
        await fs.mkdir(targetSkillDir, { recursive: true });
        throw new Error("simulated skill install failure");
      }
    );

    const { runIntegrationsInstall } = await import("../src/lib/commands/integrations.js");
    const payload = JSON.parse(
      await runIntegrationsInstall({
        cwd: realProjectDir,
        host: "codex",
        json: true
      })
    ) as {
      rollbackReport: Array<{ path: string; action: string }>;
    };

    expect(payload.rollbackReport).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: danglingHookPath,
          action: "restored-existing"
        })
      ])
    );
    expect(await fs.readlink(danglingHookPath)).toBe(danglingTarget);
  });

  it("applies the full Codex integration stack including AGENTS guidance", async () => {
    const homeDir = await tempDir("cam-integrations-apply-home-");
    const projectDir = await tempDir("cam-integrations-apply-project-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    const result = runCli(
      projectDir,
      ["integrations", "apply", "--host", "codex", "--json"],
      { env: buildStableCliEnv(homeDir) }
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
      { env: buildStableCliEnv(homeDir) }
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

  it("returns blocked without touching MCP, hooks, or skills when AGENTS apply blocks after a safe preflight", async () => {
    const projectDir = await tempDir("cam-integrations-apply-late-block-project-");
    const realProjectDir = await fs.realpath(projectDir);

    vi.resetModules();
    const agentsGuidanceModule = await import("../src/lib/integration/agents-guidance.js");
    const mcpInstallModule = await import("../src/lib/integration/mcp-install.js");
    const installAssetsModule = await import("../src/lib/integration/install-assets.js");
    const mcpConfigModule = await import("../src/lib/integration/mcp-config.js");

    vi.spyOn(mcpConfigModule, "resolveMcpProjectRoot").mockReturnValue(realProjectDir);
    vi.spyOn(agentsGuidanceModule, "inspectCodexAgentsGuidanceApplySafety").mockResolvedValue({
      host: "codex",
      projectRoot: realProjectDir,
      targetPath: path.join(realProjectDir, "AGENTS.md"),
      status: "safe",
      recommendedAction: "append",
      notes: ["preflight safe"]
    });
    vi.spyOn(agentsGuidanceModule, "applyCodexAgentsGuidance").mockResolvedValue({
      host: "codex",
      projectRoot: realProjectDir,
      targetPath: path.join(realProjectDir, "AGENTS.md"),
      action: "blocked",
      managedBlockVersion: "codex-agents-guidance-v1",
      createdFile: false,
      blockedReason: "managed guidance block changed after preflight",
      notes: ["late block"]
    });

    const installMcpProjectConfigSpy = vi.spyOn(
      mcpInstallModule,
      "installMcpProjectConfig"
    ).mockResolvedValue({
      host: "codex",
      serverName: "codex_auto_memory",
      projectRoot: realProjectDir,
      targetPath: path.join(realProjectDir, ".codex", "config.toml"),
      action: "created",
      projectPinned: true,
      readOnlyRetrieval: true,
      preservedCustomFields: [],
      notes: ["mcp wrote"]
    });
    const installIntegrationAssetsSpy = vi.spyOn(
      installAssetsModule,
      "installIntegrationAssets"
    ).mockResolvedValue({
      installSurface: "hooks",
      action: "created",
      targetDir: path.join(realProjectDir, ".tmp"),
      readOnlyRetrieval: true,
      assetVersion: "retrieval-contract-v1",
      recommendedPreset: "state=auto, limit=8",
      workflowContract: {
        ...buildWorkflowContract({
          cwd: realProjectDir
        }),
        launcher: {
          ...buildWorkflowContract({
            cwd: realProjectDir
          }).launcher,
          resolution: "cam-path",
          verified: true,
          resolvedCommand: "cam"
        }
      },
      notes: ["asset wrote"],
      assets: []
    });

    const { runIntegrationsApply } = await import("../src/lib/commands/integrations.js");
    const payload = JSON.parse(
      await runIntegrationsApply({
        cwd: realProjectDir,
        host: "codex",
        json: true
      })
    ) as {
      stackAction: string;
      subactions: {
        mcp: {
          attempted: boolean;
          skipped: boolean;
        };
        agents: {
          status: string;
          action: string;
          attempted: boolean;
        };
        hooks: {
          attempted: boolean;
          skipped: boolean;
        };
        skills: {
          attempted: boolean;
          skipped: boolean;
          surface: string;
        };
      };
      rollbackReport?: Array<{
        path: string;
        action: string;
      }>;
      notes: string[];
    };

    expect(payload).toMatchObject({
      stackAction: "blocked",
      rollbackApplied: true,
      rollbackSucceeded: true,
      rollbackErrors: [],
      subactions: {
        mcp: {
          attempted: true,
          rolledBack: true,
          effectiveAction: "unchanged"
        },
        agents: {
          status: "blocked",
          action: "blocked",
          attempted: true
        },
        hooks: {
          attempted: true,
          rolledBack: true,
          effectiveAction: "unchanged"
        },
        skills: {
          attempted: true,
          surface: "runtime",
          rolledBack: true,
          effectiveAction: "unchanged"
        }
      }
    });
    expect(payload.notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "Rollback processed"
        )
      ])
    );
    expect(payload.rollbackReport).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "deleted-new"
        })
      ])
    );
    expect(installMcpProjectConfigSpy).toHaveBeenCalledTimes(1);
    expect(installIntegrationAssetsSpy).toHaveBeenCalledTimes(2);
  });

  it("rolls back MCP, hooks, and skills when AGENTS apply blocks after staged writes", async () => {
    const homeDir = await tempDir("cam-integrations-apply-rollback-home-");
    const projectDir = await tempDir("cam-integrations-apply-rollback-project-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    vi.resetModules();
    const agentsGuidanceModule = await import("../src/lib/integration/agents-guidance.js");
    const { runIntegrationsApply } = await import("../src/lib/commands/integrations.js");

    vi.spyOn(agentsGuidanceModule, "inspectCodexAgentsGuidanceApplySafety").mockResolvedValue({
      host: "codex",
      projectRoot: realProjectDir,
      targetPath: path.join(realProjectDir, "AGENTS.md"),
      status: "safe",
      recommendedAction: "append",
      notes: ["preflight safe"]
    });
    vi.spyOn(agentsGuidanceModule, "applyCodexAgentsGuidance").mockResolvedValue({
      host: "codex",
      projectRoot: realProjectDir,
      targetPath: path.join(realProjectDir, "AGENTS.md"),
      action: "blocked",
      managedBlockVersion: "codex-agents-guidance-v1",
      createdFile: false,
      blockedReason: "managed guidance block changed after preflight",
      notes: ["late block"]
    });

    const payload = JSON.parse(
      await runIntegrationsApply({
        cwd: realProjectDir,
        host: "codex",
        json: true
      })
    ) as {
      stackAction: string;
      rollbackApplied?: boolean;
      rollbackPathCount?: number;
      rollbackReport?: Array<{
        path: string;
        action: string;
      }>;
    };

    expect(payload).toMatchObject({
      stackAction: "blocked",
      rollbackApplied: true,
      rollbackSucceeded: true,
      rollbackErrors: []
    });
    expect((payload.rollbackPathCount ?? 0) > 0).toBe(true);
    expect(payload.rollbackReport).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "deleted-new"
        })
      ])
    );

    expect(await pathExists(path.join(realProjectDir, ".codex", "config.toml"))).toBe(false);
    expect(await pathExists(path.join(realProjectDir, "AGENTS.md"))).toBe(false);
    expect(
      await pathExists(
        path.join(homeDir, ".codex-auto-memory", "hooks", "memory-recall.sh")
      )
    ).toBe(false);
    expect(
      await pathExists(
        path.join(homeDir, ".codex-auto-memory", "hooks", "post-work-memory-review.sh")
      )
    ).toBe(false);
    expect(
      await pathExists(
        path.join(homeDir, ".codex", "skills", "codex-auto-memory-recall", "SKILL.md")
      )
    ).toBe(false);
  });

  it("does not claim staged subactions were rolled back when rollback itself fails", async () => {
    const homeDir = await tempDir("cam-integrations-apply-rollback-failed-home-");
    const projectDir = await tempDir("cam-integrations-apply-rollback-failed-project-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    vi.resetModules();
    await fs.writeFile(path.join(realProjectDir, "AGENTS.md"), "# Existing guidance\n", "utf8");
    vi.doMock("../src/lib/util/fs.js", async () => {
      const actual = await vi.importActual<typeof import("../src/lib/util/fs.js")>(
        "../src/lib/util/fs.js"
      );
      return {
        ...actual,
        writeTextFileAtomic: vi.fn(async (filePath: string, contents: string) => {
          if (filePath === path.join(realProjectDir, "AGENTS.md")) {
            throw new Error("simulated rollback restore failure");
          }
          return actual.writeTextFileAtomic(filePath, contents);
        })
      };
    });
    const agentsGuidanceModule = await import("../src/lib/integration/agents-guidance.js");
    const { runIntegrationsApply } = await import("../src/lib/commands/integrations.js");

    vi.spyOn(agentsGuidanceModule, "inspectCodexAgentsGuidanceApplySafety").mockResolvedValue({
      host: "codex",
      projectRoot: realProjectDir,
      targetPath: path.join(realProjectDir, "AGENTS.md"),
      status: "safe",
      recommendedAction: "append",
      notes: ["preflight safe"]
    });
    vi.spyOn(agentsGuidanceModule, "applyCodexAgentsGuidance").mockResolvedValue({
      host: "codex",
      projectRoot: realProjectDir,
      targetPath: path.join(realProjectDir, "AGENTS.md"),
      action: "blocked",
      managedBlockVersion: "codex-agents-guidance-v1",
      createdFile: false,
      blockedReason: "managed guidance block changed after preflight",
      notes: ["late block"]
    });
    const payload = JSON.parse(
      await runIntegrationsApply({
        cwd: realProjectDir,
        host: "codex",
        json: true
      })
    ) as {
      rollbackSucceeded: boolean;
      rollbackErrors: string[];
      subactions: {
        mcp: {
          action: string;
          attempted: boolean;
          rolledBack?: boolean;
          effectiveAction?: string;
        };
        hooks: {
          action: string;
          attempted: boolean;
          rolledBack?: boolean;
          effectiveAction?: string;
        };
        skills: {
          action: string;
          attempted: boolean;
          rolledBack?: boolean;
          effectiveAction?: string;
        };
      };
    };

    expect(payload.rollbackSucceeded).toBe(false);
    expect(payload.rollbackErrors).toEqual(
      expect.arrayContaining([expect.stringContaining("simulated rollback restore failure")])
    );
    expect(payload.subactions.mcp).toMatchObject({
      action: "created",
      attempted: true
    });
    expect(payload.subactions.mcp.rolledBack).toBe(false);
    expect(payload.subactions.mcp.effectiveAction).toBeUndefined();
    expect(payload.subactions.hooks.rolledBack).toBe(false);
    expect(payload.subactions.skills.rolledBack).toBe(false);
  });

  it("does not apply AGENTS guidance before MCP wiring succeeds", async () => {
    const projectDir = await tempDir("cam-integrations-apply-mcp-fail-project-");
    const realProjectDir = await fs.realpath(projectDir);

    vi.resetModules();
    const agentsGuidanceModule = await import("../src/lib/integration/agents-guidance.js");
    const mcpInstallModule = await import("../src/lib/integration/mcp-install.js");
    const installAssetsModule = await import("../src/lib/integration/install-assets.js");
    const mcpConfigModule = await import("../src/lib/integration/mcp-config.js");

    vi.spyOn(mcpConfigModule, "resolveMcpProjectRoot").mockReturnValue(realProjectDir);
    vi.spyOn(agentsGuidanceModule, "inspectCodexAgentsGuidanceApplySafety").mockResolvedValue({
      host: "codex",
      projectRoot: realProjectDir,
      targetPath: path.join(realProjectDir, "AGENTS.md"),
      status: "safe",
      recommendedAction: "append",
      notes: ["preflight safe"]
    });

    const applyGuidanceSpy = vi.spyOn(
      agentsGuidanceModule,
      "applyCodexAgentsGuidance"
    ).mockResolvedValue({
      host: "codex",
      projectRoot: realProjectDir,
      targetPath: path.join(realProjectDir, "AGENTS.md"),
      action: "created",
      managedBlockVersion: "codex-agents-guidance-v1",
      createdFile: true,
      notes: ["agents wrote"]
    });

    vi.spyOn(mcpInstallModule, "installMcpProjectConfig").mockRejectedValue(
      new Error("broken codex config")
    );
    const installAssetsSpy = vi.spyOn(
      installAssetsModule,
      "installIntegrationAssets"
    ).mockResolvedValue({
      installSurface: "hooks",
      action: "created",
      targetDir: path.join(realProjectDir, ".tmp"),
      readOnlyRetrieval: true,
      assetVersion: "retrieval-contract-v1",
      recommendedPreset: "state=auto, limit=8",
      workflowContract: {
        ...buildWorkflowContract({
          cwd: realProjectDir
        }),
        launcher: {
          ...buildWorkflowContract({
            cwd: realProjectDir
          }).launcher,
          resolution: "cam-path",
          verified: true,
          resolvedCommand: "cam"
        }
      },
      notes: ["asset wrote"],
      assets: []
    });

    const { runIntegrationsApply } = await import("../src/lib/commands/integrations.js");

    const payload = JSON.parse(
      await runIntegrationsApply({
        cwd: realProjectDir,
        host: "codex",
        json: true
      })
    ) as {
      stackAction: string;
      failureStage?: string;
      failureMessage?: string;
      rollbackApplied?: boolean;
      subactions: {
        mcp: { attempted: boolean };
        agents: { attempted: boolean };
        hooks: { attempted: boolean };
        skills: { attempted: boolean };
      };
    };

    expect(payload).toMatchObject({
      stackAction: "failed",
      failureStage: "staged-write",
      failureMessage: expect.stringContaining("broken codex config"),
      rollbackApplied: true,
      subactions: {
        mcp: { attempted: true, status: "blocked", action: "blocked" },
        agents: { attempted: false },
        hooks: { attempted: false },
        skills: { attempted: false }
      }
    });

    expect(applyGuidanceSpy).not.toHaveBeenCalled();
    expect(installAssetsSpy).not.toHaveBeenCalled();
  });

  it("passes an explicit homeDir through integrations apply asset installation paths", async () => {
    const homeDir = await tempDir("cam-integrations-apply-home-dir-home-");
    const projectDir = await tempDir("cam-integrations-apply-home-dir-project-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    const mcpInstallModule = await import("../src/lib/integration/mcp-install.js");
    const installAssetsModule = await import("../src/lib/integration/install-assets.js");
    const agentsGuidanceModule = await import("../src/lib/integration/agents-guidance.js");

    vi.spyOn(agentsGuidanceModule, "inspectCodexAgentsGuidanceApplySafety").mockResolvedValue({
      host: "codex",
      projectRoot: realProjectDir,
      targetPath: path.join(realProjectDir, "AGENTS.md"),
      status: "safe",
      recommendedAction: "append",
      notes: ["preflight safe"]
    });
    vi.spyOn(mcpInstallModule, "installMcpProjectConfig").mockResolvedValue({
      host: "codex",
      serverName: "codex_auto_memory",
      projectRoot: realProjectDir,
      targetPath: path.join(realProjectDir, ".codex", "config.toml"),
      action: "created",
      projectPinned: true,
      readOnlyRetrieval: true,
      preservedCustomFields: [],
      notes: ["mcp wrote"]
    });
    const installAssetsSpy = vi
      .spyOn(installAssetsModule, "installIntegrationAssets")
      .mockResolvedValue({
        installSurface: "hooks",
        action: "created",
        targetDir: path.join(homeDir, ".codex-auto-memory", "hooks"),
        readOnlyRetrieval: true,
        assetVersion: "retrieval-contract-v1",
        recommendedPreset: "state=auto, limit=8",
        workflowContract: buildWorkflowContract({
          cwd: realProjectDir
        }),
        notes: ["asset wrote"],
        assets: []
      });
    vi.spyOn(agentsGuidanceModule, "applyCodexAgentsGuidance").mockResolvedValue({
      host: "codex",
      projectRoot: realProjectDir,
      targetPath: path.join(realProjectDir, "AGENTS.md"),
      action: "created",
      managedBlockVersion: "codex-agents-guidance-v1",
      createdFile: true,
      notes: ["agents wrote"]
    });

    const { runIntegrationsApply } = await import("../src/lib/commands/integrations.js");

    await expect(
      runIntegrationsApply({
        cwd: realProjectDir,
        host: "codex",
        json: true,
        homeDir
      } as any)
    ).resolves.toContain('"stackAction": "created"');

    expect(installAssetsSpy).toHaveBeenNthCalledWith(
      1,
      "hooks",
      expect.objectContaining({
        projectRoot: realProjectDir,
        homeDir
      })
    );
    expect(installAssetsSpy).toHaveBeenNthCalledWith(
      2,
      "skills",
      expect.objectContaining({
        projectRoot: realProjectDir,
        homeDir
      })
    );
  });

  it("returns a failed payload instead of throwing when a staged write target is a directory", async () => {
    const homeDir = await tempDir("cam-integrations-apply-dir-fail-home-");
    const projectDir = await tempDir("cam-integrations-apply-dir-fail-project-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    await fs.mkdir(path.join(realProjectDir, ".codex", "config.toml"), { recursive: true });
    await fs.writeFile(
      path.join(realProjectDir, ".codex", "config.toml", "keep.txt"),
      "do-not-delete",
      "utf8"
    );

    const { runIntegrationsApply } = await import("../src/lib/commands/integrations.js");
    const payload = JSON.parse(
      await runIntegrationsApply({
        cwd: realProjectDir,
        host: "codex",
        json: true
      })
    ) as {
      stackAction: string;
      failureStage?: string;
      failureMessage?: string;
      rollbackApplied?: boolean;
      subactions: {
        mcp: { attempted: boolean };
        agents: { attempted: boolean };
        hooks: { attempted: boolean };
        skills: { attempted: boolean };
      };
    };

    expect(payload).toMatchObject({
      stackAction: "failed",
      failureStage: "staged-write",
      failureMessage: expect.stringContaining("directory"),
      rollbackApplied: true,
      subactions: {
        mcp: { attempted: true, status: "blocked", action: "blocked" },
        agents: { attempted: false },
        hooks: { attempted: false },
        skills: { attempted: false }
      }
    });
    expect(
      await fs.readFile(path.join(realProjectDir, ".codex", "config.toml", "keep.txt"), "utf8")
    ).toBe("do-not-delete");
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
      { env: buildStableCliEnv(homeDir) }
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
      buildResolvedCliCommand("mcp apply-guidance --host codex")
    );
    expect(payload.applyReadiness.recommendedFix).toContain("<project-root>");
    expect(payload.nextSteps).not.toEqual(
      expect.arrayContaining([expect.stringContaining("cam integrations apply --host codex")])
    );
    expect(payload.nextSteps).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          buildResolvedCliCommand("mcp apply-guidance --host codex")
        )
      ])
    );
    expect(payload.nextSteps).toEqual(
      expect.arrayContaining([expect.stringContaining("<project-root>")])
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
      { env: buildStableCliEnv(homeDir) }
    );
    expect(installResult.exitCode, installResult.stderr).toBe(0);
    await expect(fs.access(path.join(realProjectDir, "AGENTS.md"))).rejects.toMatchObject({
      code: "ENOENT"
    });

    const applyResult = runCli(
      projectDir,
      ["integrations", "apply", "--host", "codex", "--json"],
      { env: buildStableCliEnv(homeDir) }
    );
    expect(applyResult.exitCode, applyResult.stderr).toBe(0);
    expect(JSON.parse(applyResult.stdout)).toMatchObject({
      stackAction: "updated",
      workflowContract: {
        recommendedPreset: "state=auto, limit=8",
        cliFallback: {
          searchCommand: `cam recall search "<query>" --state auto --limit 8 --cwd '${realProjectDir}'`
        }
      },
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
      recommendedSkillInstallCommand: expect.stringMatching(
        /(?:cam|node .*dist\/cli\.js) skills install --surface runtime/
      ),
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
      { env: buildStableCliEnv(homeDir) }
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
      { env: buildStableCliEnv(homeDir) }
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
      { env: buildStableCliEnv(homeDir) }
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
      { env: buildStableCliEnv(homeDir) }
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
