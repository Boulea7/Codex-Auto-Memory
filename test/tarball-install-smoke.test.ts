import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as toml from "smol-toml";
import { detectProjectContext } from "../src/lib/domain/project-context.js";
import { MemoryStore } from "../src/lib/domain/memory-store.js";
import { runCommandCapture } from "../src/lib/util/process.js";
import { makeAppConfig, writeCamConfig } from "./helpers/cam-test-fixtures.js";

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function camBinaryPath(installDir: string): string {
  return path.join(
    installDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "cam.cmd" : "cam"
  );
}

function shellQuoteArg(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function isolatedEnv(homeDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: homeDir,
    ...(process.platform === "win32" ? { USERPROFILE: homeDir } : {})
  };
}

describe("tarball install smoke", () => {
  it("installs and runs the packaged cam bin shim from a local tarball", async () => {
    const homeDir = await tempDir("cam-tarball-home-");
    const packDir = await tempDir("cam-tarball-pack-");
    const installDir = await tempDir("cam-tarball-install-");
    const realInstallDir = await fs.realpath(installDir);
    const env = isolatedEnv(homeDir);
    const packageJson = JSON.parse(await fs.readFile(path.resolve("package.json"), "utf8")) as {
      version: string;
    };

    const packResult = runCommandCapture(
      npmCommand(),
      ["pack", "--pack-destination", packDir],
      process.cwd(),
      env
    );
    expect(packResult.exitCode, packResult.stderr).toBe(0);

    const tarballName = packResult.stdout.trim().split(/\r?\n/).at(-1);
    expect(tarballName).toBeTruthy();
    const tarballPath = path.join(packDir, tarballName!);

    const initResult = runCommandCapture(npmCommand(), ["init", "-y"], installDir, env);
    expect(initResult.exitCode).toBe(0);

    const installResult = runCommandCapture(
      npmCommand(),
      ["install", "--no-package-lock", tarballPath],
      installDir,
      env
    );
    expect(installResult.exitCode).toBe(0);

    const versionResult = runCommandCapture(camBinaryPath(installDir), ["--version"], installDir, env);
    expect(versionResult.exitCode).toBe(0);
    expect(versionResult.stdout.trim()).toBe(packageJson.version);

    const envWithBin = {
      ...env,
      PATH: `${path.join(installDir, "node_modules", ".bin")}${path.delimiter}${env.PATH ?? ""}`
    };

    const sessionStatusResult = runCommandCapture(
      camBinaryPath(installDir),
      ["session", "status", "--json"],
      installDir,
      envWithBin
    );
    expect(sessionStatusResult.exitCode).toBe(0);

    const payload = JSON.parse(sessionStatusResult.stdout) as {
      projectLocation: { exists: boolean };
      latestContinuityAuditEntry: object | null;
      pendingContinuityRecovery: object | null;
    };
    expect(payload.projectLocation.exists).toBe(false);
    expect(payload.latestContinuityAuditEntry).toBeNull();
    expect(payload.pendingContinuityRecovery).toBeNull();

    const memoryRoot = await tempDir("cam-tarball-memory-root-");
    const appConfig = makeAppConfig();
    await writeCamConfig(installDir, appConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const project = detectProjectContext(installDir);
    const memoryStore = new MemoryStore(project, {
      ...appConfig,
      autoMemoryDirectory: memoryRoot
    });
    await memoryStore.ensureLayout();
    await memoryStore.remember(
      "project",
      "workflow",
      "prefer-pnpm",
      "Prefer pnpm in this repository.",
      ["Use pnpm instead of npm in this repository."],
      "Manual note."
    );
    await memoryStore.appendSyncAuditEntry({
      appliedAt: "2026-03-27T08:00:00.000Z",
      projectId: project.projectId,
      worktreeId: project.worktreeId,
      rolloutPath: "/tmp/rollout-tarball-recall-contract.jsonl",
      sessionId: "session-tarball-recall-contract",
      configuredExtractorMode: "heuristic",
      configuredExtractorName: "heuristic",
      actualExtractorMode: "heuristic",
      actualExtractorName: "heuristic",
      extractorMode: "heuristic",
      extractorName: "heuristic",
      sessionSource: "rollout-jsonl",
      status: "applied",
      appliedCount: 1,
      scopesTouched: ["project"],
      resultSummary: "1 operation(s) applied",
      operations: [
        {
          action: "upsert",
          scope: "project",
          topic: "workflow",
          id: "prefer-pnpm",
          summary: "Prefer pnpm in this repository.",
          details: ["Use pnpm instead of npm in this repository."],
          reason: "Manual note.",
          sources: ["manual"]
        }
      ]
    });

    const recallSearchResult = runCommandCapture(
      camBinaryPath(installDir),
      ["recall", "search", "prefer pnpm", "--state", "active", "--json"],
      installDir,
      envWithBin
    );
    expect(recallSearchResult.exitCode, recallSearchResult.stderr).toBe(0);
    expect(JSON.parse(recallSearchResult.stdout)).toMatchObject({
      state: "active",
      resolvedState: "active",
      fallbackUsed: false,
      stateFallbackUsed: false,
      markdownFallbackUsed: false,
      retrievalMode: "index",
      diagnostics: {
        anyMarkdownFallback: false,
        fallbackReasons: [],
        checkedPaths: expect.arrayContaining([
          expect.objectContaining({
            scope: "project",
            state: "active",
            retrievalMode: "index",
            matchedCount: 1,
            indexPath: memoryStore.getRetrievalIndexFile("project", "active"),
            generatedAt: expect.any(String)
          })
        ])
      },
      results: [
        expect.objectContaining({
          ref: "project:active:workflow:prefer-pnpm",
          state: "active",
          topic: "workflow"
        })
      ]
    });

    const recallDetailsResult = runCommandCapture(
      camBinaryPath(installDir),
      ["recall", "details", "project:active:workflow:prefer-pnpm", "--json"],
      installDir,
      envWithBin
    );
    expect(recallDetailsResult.exitCode, recallDetailsResult.stderr).toBe(0);
    expect(JSON.parse(recallDetailsResult.stdout)).toMatchObject({
      ref: "project:active:workflow:prefer-pnpm",
      path: memoryStore.getTopicFile("project", "workflow"),
      latestLifecycleAction: "add",
      latestState: "active",
      latestSessionId: null,
      latestRolloutPath: null,
      historyPath: memoryStore.getHistoryPath("project"),
      timelineWarningCount: 0,
      warnings: [],
      lineageSummary: {
        eventCount: 1,
        latestAction: "add",
        latestState: "active",
        latestAuditStatus: null,
        noopOperationCount: 0,
        suppressedOperationCount: 0,
        conflictCount: 0
      },
      latestAudit: null
    });

    const mcpInstallResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "install", "--host", "codex", "--json"],
      installDir,
      envWithBin
    );
    expect(mcpInstallResult.exitCode).toBe(0);
    expect(JSON.parse(mcpInstallResult.stdout)).toMatchObject({
      host: "codex",
      action: "created",
      readOnlyRetrieval: true
    });
    expect(
      await fs.readFile(path.join(installDir, ".codex", "config.toml"), "utf8")
    ).toContain("[mcp_servers.codex_auto_memory]");

    const codexPrintConfigResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "print-config", "--host", "codex", "--json"],
      installDir,
      envWithBin
    );
    expect(codexPrintConfigResult.exitCode).toBe(0);
    const codexPrintConfigPayload = JSON.parse(codexPrintConfigResult.stdout) as {
      host: string;
      readOnlyRetrieval: boolean;
      serverName: string;
      targetFileHint: string;
      workflowContract: {
        recommendedPreset: string;
        routePreference: {
          preferredRoute: string;
        };
        cliFallback: {
          searchCommand: string;
        };
      };
      agentsGuidance: {
        targetFileHint: string;
        snippetFormat: string;
        snippet: string;
      };
    };
    expect(codexPrintConfigPayload).toMatchObject({
      host: "codex",
      readOnlyRetrieval: true,
      serverName: "codex_auto_memory",
      targetFileHint: ".codex/config.toml",
      workflowContract: {
        recommendedPreset: "state=auto, limit=8",
        routePreference: {
          preferredRoute: "mcp-first"
        },
        cliFallback: {
          searchCommand: `cam recall search "<query>" --state auto --limit 8 --cwd ${shellQuoteArg(realInstallDir)}`
        }
      },
      agentsGuidance: {
        targetFileHint: "AGENTS.md",
        snippetFormat: "markdown"
      }
    });
    const claudePrintConfigResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "print-config", "--host", "claude", "--json"],
      installDir,
      envWithBin
    );
    expect(claudePrintConfigResult.exitCode).toBe(0);
    expect(JSON.parse(claudePrintConfigResult.stdout)).toMatchObject({
      host: "claude",
      readOnlyRetrieval: true,
      targetFileHint: ".mcp.json"
    });
    expect(JSON.parse(claudePrintConfigResult.stdout).workflowContract).toBeUndefined();
    const geminiPrintConfigResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "print-config", "--host", "gemini", "--json"],
      installDir,
      envWithBin
    );
    expect(geminiPrintConfigResult.exitCode).toBe(0);
    expect(JSON.parse(geminiPrintConfigResult.stdout)).toMatchObject({
      host: "gemini",
      readOnlyRetrieval: true,
      targetFileHint: ".gemini/settings.json"
    });
    expect(JSON.parse(geminiPrintConfigResult.stdout).workflowContract).toBeUndefined();
    const genericPrintConfigResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "print-config", "--host", "generic", "--json"],
      installDir,
      envWithBin
    );
    expect(genericPrintConfigResult.exitCode).toBe(0);
    expect(JSON.parse(genericPrintConfigResult.stdout)).toMatchObject({
      host: "generic",
      readOnlyRetrieval: true,
      targetFileHint: "Your MCP client's stdio server config"
    });
    expect(JSON.parse(genericPrintConfigResult.stdout).workflowContract).toBeUndefined();
    const applyGuidanceResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "apply-guidance", "--host", "codex", "--json"],
      installDir,
      envWithBin
    );
    expect(applyGuidanceResult.exitCode).toBe(0);
    expect(JSON.parse(applyGuidanceResult.stdout)).toMatchObject({
      host: "codex",
      action: "created",
      managedBlockVersion: "codex-agents-guidance-v1"
    });
    expect(
      await fs.readFile(path.join(installDir, "AGENTS.md"), "utf8")
    ).toContain(codexPrintConfigPayload.agentsGuidance.snippet);

    const shellDir = await tempDir("cam-tarball-shell-");
    const projectWithSpacesDir = path.join(shellDir, "project with spaces");
    await fs.mkdir(projectWithSpacesDir, { recursive: true });
    const realProjectWithSpacesDir = await fs.realpath(projectWithSpacesDir);

    const cwdSkillResult = runCommandCapture(
      camBinaryPath(installDir),
      ["skills", "install", "--surface", "official-project", "--cwd", projectWithSpacesDir],
      shellDir,
      envWithBin
    );
    expect(cwdSkillResult.exitCode).toBe(0);
    expect(
      await fs.readFile(
        path.join(
          realProjectWithSpacesDir,
          ".agents",
          "skills",
          "codex-auto-memory-recall",
          "SKILL.md"
        ),
        "utf8"
    )
    ).toContain("cam:asset-version");

    const cwdHooksResult = runCommandCapture(
      camBinaryPath(installDir),
      ["hooks", "install", "--cwd", projectWithSpacesDir],
      shellDir,
      envWithBin
    );
    expect(cwdHooksResult.exitCode).toBe(0);
    expect(
      await fs.readFile(path.join(homeDir, ".codex-auto-memory", "hooks", "memory-recall.sh"), "utf8")
    ).toContain(`PROJECT_ROOT=${JSON.stringify(realProjectWithSpacesDir)}`);
    expect(
      await fs.readFile(
        path.join(homeDir, ".codex-auto-memory", "hooks", "post-work-memory-review.sh"),
        "utf8"
      )
    ).toContain(`cam sync --cwd ${JSON.stringify(realProjectWithSpacesDir)} "$@"`);

    const cwdApplyGuidanceResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "apply-guidance", "--host", "codex", "--cwd", projectWithSpacesDir, "--json"],
      shellDir,
      envWithBin
    );
    expect(cwdApplyGuidanceResult.exitCode).toBe(0);
    expect(JSON.parse(cwdApplyGuidanceResult.stdout)).toMatchObject({
      host: "codex",
      targetPath: path.join(realProjectWithSpacesDir, "AGENTS.md")
    });

    const cwdIntegrationsResult = runCommandCapture(
      camBinaryPath(installDir),
      ["integrations", "apply", "--host", "codex", "--cwd", projectWithSpacesDir, "--json"],
      shellDir,
      envWithBin
    );
    expect(cwdIntegrationsResult.exitCode).toBe(0);
    expect(JSON.parse(cwdIntegrationsResult.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realProjectWithSpacesDir
    });

    const genericInstallResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "install", "--host", "generic"],
      installDir,
      envWithBin
    );
    expect(genericInstallResult.exitCode).toBe(1);
    expect(genericInstallResult.stderr).toContain("generic");
    expect(genericInstallResult.stderr).toContain("manual-only");

    const geminiInstallResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "install", "--host", "gemini", "--json"],
      installDir,
      envWithBin
    );
    expect(geminiInstallResult.exitCode).toBe(0);
    expect(JSON.parse(geminiInstallResult.stdout)).toMatchObject({
      host: "gemini",
      action: "created",
      targetPath: path.join(realInstallDir, ".gemini", "settings.json"),
      readOnlyRetrieval: true
    });

    const claudeInstallResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "install", "--host", "claude", "--json"],
      installDir,
      envWithBin
    );
    expect(claudeInstallResult.exitCode).toBe(0);
    expect(JSON.parse(claudeInstallResult.stdout)).toMatchObject({
      host: "claude",
      action: "created",
      targetPath: path.join(realInstallDir, ".mcp.json"),
      readOnlyRetrieval: true
    });

    const hooksResult = runCommandCapture(
      camBinaryPath(installDir),
      ["hooks", "install"],
      installDir,
      envWithBin
    );
    expect(hooksResult.exitCode).toBe(0);
    expect(
      await fs.readFile(path.join(homeDir, ".codex-auto-memory", "hooks", "memory-recall.sh"), "utf8")
    ).toContain("cam:asset-version");
    expect(
      await fs.readFile(
        path.join(homeDir, ".codex-auto-memory", "hooks", "post-work-memory-review.sh"),
        "utf8"
      )
    ).toContain("cam memory --recent");

    const skillsResult = runCommandCapture(
      camBinaryPath(installDir),
      ["skills", "install"],
      installDir,
      envWithBin
    );
    expect(skillsResult.exitCode).toBe(0);
    expect(
      await fs.readFile(
        path.join(homeDir, ".codex", "skills", "codex-auto-memory-recall", "SKILL.md"),
        "utf8"
      )
    ).toContain("cam:asset-version");

    const officialSkillsResult = runCommandCapture(
      camBinaryPath(installDir),
      ["skills", "install", "--surface", "official-user"],
      installDir,
      envWithBin
    );
    expect(officialSkillsResult.exitCode).toBe(0);
    expect(
      await fs.readFile(
        path.join(homeDir, ".agents", "skills", "codex-auto-memory-recall", "SKILL.md"),
        "utf8"
      )
    ).toContain("cam:asset-version");

    const officialProjectSkillsResult = runCommandCapture(
      camBinaryPath(installDir),
      ["skills", "install", "--surface", "official-project"],
      installDir,
      envWithBin
    );
    expect(officialProjectSkillsResult.exitCode).toBe(0);
    expect(
      await fs.readFile(
        path.join(installDir, ".agents", "skills", "codex-auto-memory-recall", "SKILL.md"),
        "utf8"
      )
    ).toContain("cam:asset-version");

    const integrationsResult = runCommandCapture(
      camBinaryPath(installDir),
      ["integrations", "install", "--host", "codex", "--json"],
      installDir,
      envWithBin
    );
    expect(integrationsResult.exitCode).toBe(0);
    expect(JSON.parse(integrationsResult.stdout)).toMatchObject({
      host: "codex",
      stackAction: "unchanged",
      skillsSurface: "runtime",
      readOnlyRetrieval: true,
      workflowContract: {
        recommendedPreset: "state=auto, limit=8",
        cliFallback: {
          searchCommand: `cam recall search "<query>" --state auto --limit 8 --cwd ${JSON.stringify(realInstallDir)}`
        }
      },
      subactions: {
        mcp: { action: "unchanged" },
        hooks: { action: "unchanged" },
        skills: { action: "unchanged", surface: "runtime" }
      }
    });

    const integrationsApplyResult = runCommandCapture(
      camBinaryPath(installDir),
      ["integrations", "apply", "--host", "codex", "--json"],
      installDir,
      envWithBin
    );
    expect(integrationsApplyResult.exitCode).toBe(0);
    expect(JSON.parse(integrationsApplyResult.stdout)).toMatchObject({
      host: "codex",
      stackAction: "unchanged",
      skillsSurface: "runtime",
      readOnlyRetrieval: true,
      workflowContract: {
        recommendedPreset: "state=auto, limit=8",
        cliFallback: {
          searchCommand: `cam recall search "<query>" --state auto --limit 8 --cwd ${JSON.stringify(realInstallDir)}`
        }
      },
      subactions: {
        mcp: { action: "unchanged" },
        agents: { action: "unchanged" },
        hooks: { action: "unchanged" },
        skills: { action: "unchanged", surface: "runtime" }
      }
    });

    const integrationsOfficialProjectResult = runCommandCapture(
      camBinaryPath(installDir),
      [
        "integrations",
        "install",
        "--host",
        "codex",
        "--skill-surface",
        "official-project",
        "--json"
      ],
      installDir,
      envWithBin
    );
    expect(integrationsOfficialProjectResult.exitCode).toBe(0);
    expect(JSON.parse(integrationsOfficialProjectResult.stdout)).toMatchObject({
      host: "codex",
      skillsSurface: "official-project",
      subactions: {
        skills: {
          action: "unchanged",
          surface: "official-project",
          targetDir: path.join(realInstallDir, ".agents", "skills", "codex-auto-memory-recall")
        }
      }
    });

    const integrationsOfficialUserResult = runCommandCapture(
      camBinaryPath(installDir),
      [
        "integrations",
        "install",
        "--host",
        "codex",
        "--skill-surface",
        "official-user",
        "--json"
      ],
      installDir,
      envWithBin
    );
    expect(integrationsOfficialUserResult.exitCode).toBe(0);
    expect(JSON.parse(integrationsOfficialUserResult.stdout)).toMatchObject({
      host: "codex",
      skillsSurface: "official-user",
      subactions: {
        skills: {
          action: "unchanged",
          surface: "official-user",
          targetDir: path.join(homeDir, ".agents", "skills", "codex-auto-memory-recall")
        }
      }
    });

    const integrationsApplyOfficialUserResult = runCommandCapture(
      camBinaryPath(installDir),
      [
        "integrations",
        "apply",
        "--host",
        "codex",
        "--skill-surface",
        "official-user",
        "--json"
      ],
      installDir,
      envWithBin
    );
    expect(integrationsApplyOfficialUserResult.exitCode).toBe(0);
    expect(JSON.parse(integrationsApplyOfficialUserResult.stdout)).toMatchObject({
      host: "codex",
      skillsSurface: "official-user",
      subactions: {
        skills: {
          action: "unchanged",
          surface: "official-user",
          targetDir: path.join(homeDir, ".agents", "skills", "codex-auto-memory-recall")
        }
      }
    });

    const integrationsApplyOfficialProjectResult = runCommandCapture(
      camBinaryPath(installDir),
      [
        "integrations",
        "apply",
        "--host",
        "codex",
        "--skill-surface",
        "official-project",
        "--json"
      ],
      installDir,
      envWithBin
    );
    expect(integrationsApplyOfficialProjectResult.exitCode).toBe(0);
    expect(JSON.parse(integrationsApplyOfficialProjectResult.stdout)).toMatchObject({
      host: "codex",
      skillsSurface: "official-project",
      subactions: {
        skills: {
          action: "unchanged",
          surface: "official-project",
          targetDir: path.join(realInstallDir, ".agents", "skills", "codex-auto-memory-recall")
        }
      }
    });

    const integrationsDoctorResult = runCommandCapture(
      camBinaryPath(installDir),
      ["integrations", "doctor", "--host", "codex", "--json"],
      installDir,
      envWithBin
    );
    expect(integrationsDoctorResult.exitCode).toBe(0);
    expect(JSON.parse(integrationsDoctorResult.stdout)).toMatchObject({
      host: "codex",
      readOnlyRetrieval: true,
      status: "ok",
      recommendedRoute: "mcp",
      recommendedPreset: "state=auto, limit=8",
      applyReadiness: {
        status: "safe"
      },
      retrievalSidecar: {
        status: "ok",
        repairCommand: "cam memory reindex --scope all --state all",
        checks: expect.arrayContaining([
          expect.objectContaining({
            scope: "project",
            state: "active",
            status: "ok",
            indexPath: memoryStore.getRetrievalIndexFile("project", "active"),
            generatedAt: expect.any(String),
            topicFileCount: 1
          })
        ])
      },
      workflowContract: {
        version: expect.any(String),
        cliFallback: {
          searchCommand: 'cam recall search "<query>" --state auto --limit 8',
          timelineCommand: 'cam recall timeline "<ref>"',
          detailsCommand: 'cam recall details "<ref>"'
        },
        postWorkSyncReview: {
          helperScript: "post-work-memory-review.sh",
          syncCommand: "cam sync",
          reviewCommand: "cam memory --recent"
        }
      },
      preferredSkillSurface: "runtime",
      recommendedSkillInstallCommand: "cam skills install --surface runtime",
      installedSkillSurfaces: ["runtime", "official-user", "official-project"],
      readySkillSurfaces: ["runtime", "official-user", "official-project"],
      subchecks: {
        mcp: { status: "ok" },
        agents: { status: "ok" },
        hookCapture: { status: "ok" },
        hookRecall: { status: "ok" },
        skill: { status: "ok" },
        workflowConsistency: { status: "ok" }
      }
    });

    const mcpDoctorResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "doctor", "--host", "codex", "--json"],
      installDir,
      envWithBin
    );
    expect(mcpDoctorResult.exitCode).toBe(0);
    expect(JSON.parse(mcpDoctorResult.stdout)).toMatchObject({
      readOnlyRetrieval: true,
      fallbackAssets: {
        runtimeSkillPresent: true,
        postWorkReviewInstalled: true,
        anySkillSurfaceInstalled: true,
        anySkillSurfaceReady: true,
        officialUserSkillMatchesCanonical: true,
        officialProjectSkillMatchesCanonical: true
      },
      retrievalSidecar: {
        status: "ok",
        repairCommand: "cam memory reindex --scope all --state all",
        checks: expect.arrayContaining([
          expect.objectContaining({
            scope: "project",
            state: "active",
            status: "ok",
            indexPath: memoryStore.getRetrievalIndexFile("project", "active"),
            generatedAt: expect.any(String),
            topicFileCount: 1
          })
        ])
      },
      workflowContract: {
        version: expect.any(String),
        cliFallback: {
          searchCommand: 'cam recall search "<query>" --state auto --limit 8',
          timelineCommand: 'cam recall timeline "<ref>"',
          detailsCommand: 'cam recall details "<ref>"'
        },
        postWorkSyncReview: {
          helperScript: "post-work-memory-review.sh",
          syncCommand: "cam sync",
          reviewCommand: "cam memory --recent"
        }
      }
    });

    const blockedProjectDir = await tempDir("cam-tarball-blocked-project-");
    const realBlockedProjectDir = await fs.realpath(blockedProjectDir);
    await fs.writeFile(
      path.join(realBlockedProjectDir, "AGENTS.md"),
      [
        "# Project Notes",
        "",
        "<!-- cam:codex-agents-guidance:start -->",
        "<!-- cam:agents-guidance-version codex-agents-guidance-v0 -->",
        "- stale guidance"
      ].join("\n"),
      "utf8"
    );
    const blockedBefore = await fs.readFile(path.join(realBlockedProjectDir, "AGENTS.md"), "utf8");

    const blockedApplyGuidanceResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "apply-guidance", "--host", "codex", "--json"],
      blockedProjectDir,
      envWithBin
    );
    expect(blockedApplyGuidanceResult.exitCode).toBe(0);
    expect(JSON.parse(blockedApplyGuidanceResult.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realBlockedProjectDir,
      action: "blocked"
    });
    expect(await fs.readFile(path.join(realBlockedProjectDir, "AGENTS.md"), "utf8")).toBe(
      blockedBefore
    );

    const blockedIntegrationsResult = runCommandCapture(
      camBinaryPath(installDir),
      ["integrations", "apply", "--host", "codex", "--json"],
      blockedProjectDir,
      envWithBin
    );
    expect(blockedIntegrationsResult.exitCode).toBe(0);
    expect(JSON.parse(blockedIntegrationsResult.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realBlockedProjectDir,
      stackAction: "blocked",
      preflightBlocked: true,
      blockedStage: "agents-guidance-preflight",
      subactions: {
        mcp: {
          action: "unchanged",
          attempted: false,
          skipped: true,
          skipReason: expect.stringContaining("preflight")
        },
        agents: {
          status: "blocked",
          action: "blocked",
          attempted: true
        },
        hooks: {
          action: "unchanged",
          attempted: false,
          skipped: true,
          skipReason: expect.stringContaining("preflight")
        },
        skills: {
          action: "unchanged",
          attempted: false,
          skipped: true,
          skipReason: expect.stringContaining("preflight")
        }
      }
    });

    const blockedIntegrationsDoctorResult = runCommandCapture(
      camBinaryPath(installDir),
      ["integrations", "doctor", "--host", "codex", "--json"],
      blockedProjectDir,
      envWithBin
    );
    expect(blockedIntegrationsDoctorResult.exitCode).toBe(0);
    expect(JSON.parse(blockedIntegrationsDoctorResult.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realBlockedProjectDir,
      applyReadiness: {
        status: "blocked",
        reason: expect.stringContaining("managed guidance block"),
        recommendedFix: expect.stringContaining("cam mcp apply-guidance --host codex")
      }
    });

    const recallHelpResult = runCommandCapture(
      camBinaryPath(installDir),
      ["recall", "search", "--help"],
      installDir,
      envWithBin
    );
    expect(recallHelpResult.exitCode).toBe(0);
    expect(recallHelpResult.stdout).toContain("Search compact memory candidates without loading full details");
    expect(recallHelpResult.stdout).toContain("Limit memory state: active, archived, all, or auto");

    const hooksHelpResult = runCommandCapture(
      camBinaryPath(installDir),
      ["hooks", "install", "--help"],
      installDir,
      envWithBin
    );
    expect(hooksHelpResult.exitCode).toBe(0);
    expect(hooksHelpResult.stdout).toContain(
      "Generate the local bridge / fallback helper bundle"
    );
    expect(hooksHelpResult.stdout).toContain("Project directory to anchor generated hook helpers to");

    const mcpHelpResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "print-config", "--help"],
      installDir,
      envWithBin
    );
    expect(mcpHelpResult.exitCode).toBe(0);
    expect(mcpHelpResult.stdout).toContain(
      "Print a ready-to-paste MCP config snippet for a supported host"
    );
    expect(mcpHelpResult.stdout).toContain("Target host: codex, claude, gemini, or generic");

    const mcpInstallHelpResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "install", "--help"],
      installDir,
      envWithBin
    );
    expect(mcpInstallHelpResult.exitCode).toBe(0);
    expect(mcpInstallHelpResult.stdout).toContain(
      "Install the recommended project-scoped MCP wiring for a supported host"
    );
    expect(mcpInstallHelpResult.stdout).toContain("Target host: codex, claude, or gemini");

    const mcpApplyGuidanceHelpResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "apply-guidance", "--help"],
      installDir,
      envWithBin
    );
    expect(mcpApplyGuidanceHelpResult.exitCode).toBe(0);
    expect(mcpApplyGuidanceHelpResult.stdout).toContain(
      "Safely create or update the managed Codex Auto Memory block inside AGENTS.md"
    );
    expect(mcpApplyGuidanceHelpResult.stdout).toContain("Target host: codex");

    const mcpDoctorHelpResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "doctor", "--help"],
      installDir,
      envWithBin
    );
    expect(mcpDoctorHelpResult.exitCode).toBe(0);
    expect(mcpDoctorHelpResult.stdout).toContain(
      "Inspect the recommended project-scoped MCP wiring without writing host config"
    );
    expect(mcpDoctorHelpResult.stdout).toContain(
      "Target host: codex, claude, gemini, generic, or all"
    );

    const skillsHelpResult = runCommandCapture(
      camBinaryPath(installDir),
      ["skills", "install", "--help"],
      installDir,
      envWithBin
    );
    expect(skillsHelpResult.exitCode).toBe(0);
    expect(skillsHelpResult.stdout).toMatch(
      /Install a Codex skill that teaches search -> timeline -> details memory\s+retrieval/
    );
    expect(skillsHelpResult.stdout).toMatch(
      /Skill install surface: runtime, official-user, or\s+official-project/
    );

    const integrationsInstallHelpResult = runCommandCapture(
      camBinaryPath(installDir),
      ["integrations", "install", "--help"],
      installDir,
      envWithBin
    );
    expect(integrationsInstallHelpResult.exitCode).toBe(0);
    expect(integrationsInstallHelpResult.stdout).toContain(
      "Install the recommended project-scoped Codex integration stack"
    );
    expect(integrationsInstallHelpResult.stdout).toContain("Target host: codex");
    expect(integrationsInstallHelpResult.stdout).toMatch(
      /Skill install surface: runtime, official-user, or\s+official-project/
    );

    const integrationsApplyHelpResult = runCommandCapture(
      camBinaryPath(installDir),
      ["integrations", "apply", "--help"],
      installDir,
      envWithBin
    );
    expect(integrationsApplyHelpResult.exitCode).toBe(0);
    expect(integrationsApplyHelpResult.stdout).toMatch(
      /Install the recommended Codex integration stack and safely apply the managed\s+AGENTS guidance block/
    );
    expect(integrationsApplyHelpResult.stdout).toContain("Target host: codex");

    const integrationsDoctorHelpResult = runCommandCapture(
      camBinaryPath(installDir),
      ["integrations", "doctor", "--help"],
      installDir,
      envWithBin
    );
    expect(integrationsDoctorHelpResult.exitCode).toBe(0);
    expect(integrationsDoctorHelpResult.stdout).toMatch(
      /Inspect the current Codex integration stack without mutating memory or host\s+config/
    );
    expect(integrationsDoctorHelpResult.stdout).toContain("Target host: codex");
  }, 60_000);

  it("preserves custom fields on the codex_auto_memory install entry from the packed tarball", async () => {
    const homeDir = await tempDir("cam-tarball-preserve-home-");
    const packDir = await tempDir("cam-tarball-preserve-pack-");
    const installDir = await tempDir("cam-tarball-preserve-install-");
    const realInstallDir = await fs.realpath(installDir);
    const env = isolatedEnv(homeDir);

    const packResult = runCommandCapture(
      npmCommand(),
      ["pack", "--pack-destination", packDir],
      process.cwd(),
      env
    );
    expect(packResult.exitCode, packResult.stderr).toBe(0);

    const tarballName = packResult.stdout.trim().split(/\r?\n/).at(-1);
    expect(tarballName).toBeTruthy();
    const tarballPath = path.join(packDir, tarballName!);

    expect(runCommandCapture(npmCommand(), ["init", "-y"], installDir, env).exitCode).toBe(0);
    expect(
      runCommandCapture(
        npmCommand(),
        ["install", "--no-package-lock", tarballPath],
        installDir,
        env
      ).exitCode
    ).toBe(0);

    const envWithBin = {
      ...env,
      PATH: `${path.join(installDir, "node_modules", ".bin")}${path.delimiter}${env.PATH ?? ""}`
    };

    await fs.mkdir(path.join(installDir, ".codex"), { recursive: true });
    await fs.writeFile(
      path.join(installDir, ".codex", "config.toml"),
      [
        "[mcp_servers.codex_auto_memory]",
        'command = "cam"',
        'args = ["mcp", "serve"]',
        `cwd = ${JSON.stringify(realInstallDir)}`,
        'label = "keep-me"'
      ].join("\n"),
      "utf8"
    );

    const result = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "install", "--host", "codex", "--json"],
      installDir,
      envWithBin
    );
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      host: "codex",
      action: "unchanged",
      preservedCustomFields: ["label"]
    });
    expect(
      toml.parse(await fs.readFile(path.join(installDir, ".codex", "config.toml"), "utf8"))
    ).toMatchObject({
      mcp_servers: {
        codex_auto_memory: {
          command: "cam",
          args: ["mcp", "serve"],
          cwd: realInstallDir,
          label: "keep-me"
        }
      }
    });
  }, 60_000);
});
