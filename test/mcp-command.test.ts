import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as toml from "smol-toml";
import { detectProjectContext } from "../src/lib/domain/project-context.js";
import { MemoryStore } from "../src/lib/domain/memory-store.js";
import { SyncService } from "../src/lib/domain/sync-service.js";
import { RETRIEVAL_INTEGRATION_ASSET_VERSION } from "../src/lib/integration/retrieval-contract.js";
import {
  makeAppConfig,
  makeRolloutFixture,
  writeCamConfig
} from "./helpers/cam-test-fixtures.js";
import { runCli } from "./helpers/cli-runner.js";
import { connectCliMcpClient } from "./helpers/mcp-client.js";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;
const originalCodexHome = process.env.CODEX_HOME;

interface SearchMemoriesResponse {
  query: string;
  scope: string;
  state: string;
  resolvedState: string;
  searchOrder?: string[];
  globalLimitApplied?: boolean;
  truncatedCount?: number;
  fallbackUsed: boolean;
  stateFallbackUsed?: boolean;
  markdownFallbackUsed?: boolean;
  retrievalMode: string;
  retrievalFallbackReason?: string;
  stateResolution?: {
    outcome: string;
    searchedStates: string[];
    resolutionReason: string;
  };
  executionSummary?: {
    mode: string;
    retrievalModes: string[];
    fallbackReasons: string[];
  };
  diagnostics?: {
    anyMarkdownFallback?: boolean;
    fallbackReasons?: string[];
    executionModes?: string[];
    checkedPaths: Array<{
      scope: string;
      state: string;
      retrievalMode: string;
      retrievalFallbackReason?: string;
      matchedCount: number;
      returnedCount?: number;
      droppedCount?: number;
      indexPath: string;
      generatedAt: string | null;
    }>;
  };
  results: Array<{
    ref: string;
    state: string;
    summary: string;
    matchedFields: string[];
    approxReadCost: number;
  }>;
}

interface TimelineMemoriesResponse {
  ref: string;
  warnings: string[];
  lineageSummary: {
    eventCount: number;
    latestAction: string | null;
    latestState: string | null;
    latestAuditStatus: string | null;
    noopOperationCount: number;
    suppressedOperationCount: number;
    conflictCount: number;
  };
  events: Array<{
    action: string;
    state: string;
    sessionId?: string;
    rolloutPath?: string;
  }>;
}

interface MemoryDetailsResponse {
  ref: string;
  path: string;
  latestLifecycleAction: string;
  latestState: string;
  latestSessionId: string | null;
  latestRolloutPath: string | null;
  historyPath: string;
  timelineWarningCount: number;
  lineageSummary: {
    eventCount: number;
    latestAction: string | null;
    latestState: string | null;
    latestAuditStatus: string | null;
    noopOperationCount: number;
    suppressedOperationCount: number;
    conflictCount: number;
  };
  warnings: string[];
  latestAudit?: {
    auditPath: string;
    rolloutPath: string;
    sessionId?: string;
    status: string;
    resultSummary: string;
    noopOperationCount: number;
    suppressedOperationCount: number;
  } | null;
  entry: {
    summary: string;
    details: string[];
  };
}

interface ToolCallResultLike {
  structuredContent?: unknown;
  content?: Array<{ type: string; text?: string }>;
  toolResult?: {
    structuredContent?: unknown;
    content?: Array<{ type: string; text?: string }>;
  };
}

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function pathExists(pathname: string): Promise<boolean> {
  try {
    await fs.access(pathname);
    return true;
  } catch {
    return false;
  }
}

async function readTomlFile(pathname: string): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(pathname, "utf8");
  return toml.parse(raw) as Record<string, unknown>;
}

async function readJsonFile(pathname: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(pathname, "utf8")) as Record<string, unknown>;
}

function shellQuoteArg(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
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

function readStructuredContent<T>(result: ToolCallResultLike): T {
  const payload = result.toolResult ?? result;

  if (payload.structuredContent) {
    return payload.structuredContent as T;
  }

  const textBlock = payload.content?.find(
    (block): block is { type: "text"; text: string } =>
      block.type === "text" && typeof block.text === "string"
  );
  if (!textBlock) {
    throw new Error("Expected MCP result to contain structuredContent or a text content block.");
  }

  return JSON.parse(textBlock.text) as T;
}

afterEach(async () => {
  process.env.HOME = originalHome;
  if (originalCodexHome === undefined) {
    delete process.env.CODEX_HOME;
  } else {
    process.env.CODEX_HOME = originalCodexHome;
  }
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("mcp command", () => {
  it("installs project-scoped MCP wiring for codex, claude, and gemini without replacing unrelated config", async () => {
    const homeDir = await tempDir("cam-mcp-install-home-");
    const projectDir = await tempDir("cam-mcp-install-project-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    const codexConfigPath = path.join(realProjectDir, ".codex", "config.toml");
    const claudeConfigPath = path.join(realProjectDir, ".mcp.json");
    const geminiConfigPath = path.join(realProjectDir, ".gemini", "settings.json");

    await fs.mkdir(path.dirname(codexConfigPath), { recursive: true });
    await fs.mkdir(path.dirname(geminiConfigPath), { recursive: true });
    await fs.writeFile(
      codexConfigPath,
      [
        'model_reasoning_effort = "high"',
        "",
        "[mcp_servers.other_server]",
        'command = "other"',
        'args = ["serve"]'
      ].join("\n"),
      "utf8"
    );
    await fs.writeFile(
      claudeConfigPath,
      JSON.stringify(
        {
          approvalMode: "project",
          mcpServers: {
            other_server: {
              command: "other",
              args: ["serve"]
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(
      geminiConfigPath,
      JSON.stringify(
        {
          theme: "ocean",
          mcpServers: {
            other_server: {
              command: "other",
              args: ["serve"],
              trust: true
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const codexInstall = runCli(projectDir, ["mcp", "install", "--host", "codex", "--json"], {
      env: { HOME: homeDir }
    });
    const claudeInstall = runCli(projectDir, ["mcp", "install", "--host", "claude", "--json"], {
      env: { HOME: homeDir }
    });
    const geminiInstall = runCli(projectDir, ["mcp", "install", "--host", "gemini", "--json"], {
      env: { HOME: homeDir }
    });

    expect(codexInstall.exitCode, codexInstall.stderr).toBe(0);
    expect(claudeInstall.exitCode, claudeInstall.stderr).toBe(0);
    expect(geminiInstall.exitCode, geminiInstall.stderr).toBe(0);

    expect(JSON.parse(codexInstall.stdout)).toMatchObject({
      host: "codex",
      serverName: "codex_auto_memory",
      action: "created",
      projectPinned: true,
      readOnlyRetrieval: true,
      targetPath: codexConfigPath
    });
    expect(JSON.parse(claudeInstall.stdout)).toMatchObject({
      host: "claude",
      serverName: "codex_auto_memory",
      action: "created",
      projectPinned: true,
      readOnlyRetrieval: true,
      targetPath: claudeConfigPath
    });
    expect(JSON.parse(geminiInstall.stdout)).toMatchObject({
      host: "gemini",
      serverName: "codex_auto_memory",
      action: "created",
      projectPinned: true,
      readOnlyRetrieval: true,
      targetPath: geminiConfigPath
    });

    const codexConfig = await readTomlFile(codexConfigPath);
    expect(codexConfig).toMatchObject({
      model_reasoning_effort: "high",
      mcp_servers: {
        other_server: {
          command: "other",
          args: ["serve"]
        },
        codex_auto_memory: {
          command: "cam",
          args: ["mcp", "serve"],
          cwd: realProjectDir
        }
      }
    });

    const claudeConfig = await readJsonFile(claudeConfigPath);
    expect(claudeConfig).toMatchObject({
      approvalMode: "project",
      mcpServers: {
        other_server: {
          command: "other",
          args: ["serve"]
        },
        codex_auto_memory: {
          command: "cam",
          args: ["mcp", "serve", "--cwd", realProjectDir],
          env: {}
        }
      }
    });

    const geminiConfig = await readJsonFile(geminiConfigPath);
    expect(geminiConfig).toMatchObject({
      theme: "ocean",
      mcpServers: {
        other_server: {
          command: "other",
          args: ["serve"],
          trust: true
        },
        codex_auto_memory: {
          command: "cam",
          args: ["mcp", "serve"],
          cwd: realProjectDir,
          trust: false
        }
      }
    });
  });

  it("reports updated then unchanged on repeated install and makes doctor report ok for installed hosts", async () => {
    const homeDir = await tempDir("cam-mcp-install-repeat-home-");
    const projectDir = await tempDir("cam-mcp-install-repeat-project-");
    process.env.HOME = homeDir;

    await fs.mkdir(path.join(projectDir, ".codex"), { recursive: true });
    await fs.mkdir(path.join(projectDir, ".gemini"), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, ".codex", "config.toml"),
      [
        "[mcp_servers.codex_auto_memory]",
        'command = "cam"',
        'args = ["mcp", "serve"]',
        'cwd = "/tmp/not-this-project"'
      ].join("\n"),
      "utf8"
    );
    await fs.writeFile(
      path.join(projectDir, ".mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            codex_auto_memory: {
              command: "cam",
              args: ["mcp", "serve"],
              env: {
                KEEP_ME: "no"
              }
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(
      path.join(projectDir, ".gemini", "settings.json"),
      JSON.stringify(
        {
          mcpServers: {
            codex_auto_memory: {
              command: "cam",
              args: ["mcp", "serve"],
              cwd: projectDir,
              trust: true
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );

    for (const host of ["codex", "claude", "gemini"] as const) {
      const first = runCli(projectDir, ["mcp", "install", "--host", host, "--json"], {
        env: { HOME: homeDir }
      });
      expect(first.exitCode, first.stderr).toBe(0);
      expect(JSON.parse(first.stdout)).toMatchObject({
        host,
        action: "updated"
      });

      const second = runCli(projectDir, ["mcp", "install", "--host", host, "--json"], {
        env: { HOME: homeDir }
      });
      expect(second.exitCode, second.stderr).toBe(0);
      expect(JSON.parse(second.stdout)).toMatchObject({
        host,
        action: "unchanged",
        projectPinned: true,
        readOnlyRetrieval: true
      });
    }

    const doctor = runCli(projectDir, ["mcp", "doctor", "--json"], {
      env: { HOME: homeDir }
    });
    expect(doctor.exitCode, doctor.stderr).toBe(0);
    const doctorPayload = JSON.parse(doctor.stdout) as {
      hosts: Array<{
        host: string;
        status: string;
        configCheck?: {
          exists: boolean;
          projectPinned: boolean;
        };
      }>;
    };
    expect(doctorPayload.hosts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          host: "codex",
          status: "ok",
          configCheck: expect.objectContaining({
            exists: true,
            projectPinned: true
          })
        }),
        expect.objectContaining({
          host: "claude",
          status: "ok",
          configCheck: expect.objectContaining({
            exists: true,
            projectPinned: true
          })
        }),
        expect.objectContaining({
          host: "gemini",
          status: "ok",
          configCheck: expect.objectContaining({
            exists: true,
            projectPinned: true
          })
        }),
        expect.objectContaining({
          host: "generic",
          status: "manual"
        })
      ])
    );
  });

  it("preserves non-canonical custom fields on an existing codex_auto_memory entry", async () => {
    const homeDir = await tempDir("cam-mcp-install-preserve-home-");
    const projectDir = await tempDir("cam-mcp-install-preserve-project-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    await fs.mkdir(path.join(projectDir, ".codex"), { recursive: true });
    await fs.mkdir(path.join(projectDir, ".gemini"), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, ".codex", "config.toml"),
      [
        "[mcp_servers.codex_auto_memory]",
        'command = "cam"',
        'args = ["mcp", "serve"]',
        `cwd = ${JSON.stringify(realProjectDir)}`,
        'label = "keep-me"'
      ].join("\n"),
      "utf8"
    );
    await fs.writeFile(
      path.join(projectDir, ".mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            codex_auto_memory: {
              command: "cam",
              args: ["mcp", "serve", "--cwd", realProjectDir],
              env: {},
              label: "keep-me"
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(
      path.join(projectDir, ".gemini", "settings.json"),
      JSON.stringify(
        {
          mcpServers: {
            codex_auto_memory: {
              command: "cam",
              args: ["mcp", "serve"],
              cwd: realProjectDir,
              trust: false,
              label: "keep-me"
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );

    for (const host of ["codex", "claude", "gemini"] as const) {
      const result = runCli(projectDir, ["mcp", "install", "--host", host, "--json"], {
        env: { HOME: homeDir }
      });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        host,
        action: "unchanged",
        preservedCustomFields: ["label"]
      });
    }

    const codexConfig = await readTomlFile(path.join(projectDir, ".codex", "config.toml"));
    expect(codexConfig).toMatchObject({
      mcp_servers: {
        codex_auto_memory: {
          command: "cam",
          args: ["mcp", "serve"],
          cwd: realProjectDir,
          label: "keep-me"
        }
      }
    });

    const claudeConfig = await readJsonFile(path.join(projectDir, ".mcp.json"));
    expect(claudeConfig).toMatchObject({
      mcpServers: {
        codex_auto_memory: {
          command: "cam",
          args: ["mcp", "serve", "--cwd", realProjectDir],
          env: {},
          label: "keep-me"
        }
      }
    });

    const geminiConfig = await readJsonFile(path.join(projectDir, ".gemini", "settings.json"));
    expect(geminiConfig).toMatchObject({
      mcpServers: {
        codex_auto_memory: {
          command: "cam",
          args: ["mcp", "serve"],
          cwd: realProjectDir,
          trust: false,
          label: "keep-me"
        }
      }
    });
  });

  it("supports install --cwd for writing another project's host config", async () => {
    const homeDir = await tempDir("cam-mcp-install-cwd-home-");
    const projectDir = await tempDir("cam-mcp-install-cwd-project-");
    const callerDir = await tempDir("cam-mcp-install-cwd-caller-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    const result = runCli(
      callerDir,
      ["mcp", "install", "--host", "claude", "--cwd", projectDir, "--json"],
      { env: { HOME: homeDir } }
    );

    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      host: "claude",
      action: "created",
      projectRoot: realProjectDir,
      targetPath: path.join(realProjectDir, ".mcp.json")
    });

    const claudeConfig = await readJsonFile(path.join(realProjectDir, ".mcp.json"));
    expect(claudeConfig).toMatchObject({
      mcpServers: {
        codex_auto_memory: {
          command: "cam",
          args: ["mcp", "serve", "--cwd", realProjectDir],
          env: {}
        }
      }
    });
  });

  it("supports apply-guidance --cwd for updating another project's AGENTS guidance", async () => {
    const homeDir = await tempDir("cam-mcp-apply-guidance-cwd-home-");
    const projectDir = await tempDir("cam-mcp-apply-guidance-cwd-project-");
    const callerDir = await tempDir("cam-mcp-apply-guidance-cwd-caller-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    const result = runCli(
      callerDir,
      ["mcp", "apply-guidance", "--host", "codex", "--cwd", projectDir, "--json"],
      { env: { HOME: homeDir } }
    );

    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      host: "codex",
      action: "created",
      targetPath: path.join(realProjectDir, "AGENTS.md")
    });

    const agentsContents = await fs.readFile(path.join(realProjectDir, "AGENTS.md"), "utf8");
    expect(agentsContents).toContain("search_memories");
    expect(agentsContents).toContain("cam sync");
  });

  it("prints ready-to-paste host snippets without mutating host config files", async () => {
    const homeDir = await tempDir("cam-mcp-print-home-");
    const projectDir = await tempDir("cam-mcp-print-project-");
    process.env.HOME = homeDir;

    const expectations = [
      {
        host: "codex",
        targetFile: path.join(projectDir, ".codex", "config.toml"),
        expected: [
          "Target file hint: .codex/config.toml",
          "[mcp_servers.codex_auto_memory]",
          "AGENTS.md",
          "search_memories",
          "cam recall search"
        ]
      },
      {
        host: "claude",
        targetFile: path.join(projectDir, ".mcp.json"),
        expected: ['Target file hint: .mcp.json', '"mcpServers"', '"--cwd"']
      },
      {
        host: "gemini",
        targetFile: path.join(projectDir, ".gemini", "settings.json"),
        expected: ['Target file hint: .gemini/settings.json', '"trust": false', '"cwd"']
      },
      {
        host: "generic",
        targetFile: path.join(projectDir, "generic-mcp-config.json"),
        expected: ["Target file hint: Your MCP client's stdio server config", '"command": "cam"']
      }
    ] as const;

    for (const expectation of expectations) {
      const result = runCli(projectDir, ["mcp", "print-config", "--host", expectation.host], {
        env: { HOME: homeDir }
      });

      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toContain("read-only retrieval MCP plane");
      expect(result.stdout).toContain("Server name: codex_auto_memory");
      for (const fragment of expectation.expected) {
        expect(result.stdout).toContain(fragment);
      }
      expect(await pathExists(expectation.targetFile)).toBe(false);
    }
  });

  it("prints a stable JSON contract for host snippets", async () => {
    const homeDir = await tempDir("cam-mcp-json-home-");
    const projectDir = await tempDir("cam-mcp-json-project-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    const result = runCli(projectDir, ["mcp", "print-config", "--host", "codex", "--json"], {
      env: { HOME: homeDir }
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      host: string;
      readOnlyRetrieval: boolean;
      serverName: string;
      transport: string;
      targetFileHint: string;
      projectRoot: string;
      snippetFormat: string;
      snippet: string;
      notes: string[];
      agentsGuidance?: {
        targetFileHint: string;
        snippetFormat: string;
        snippet: string;
        notes: string[];
      };
      workflowContract?: {
        recommendedPreset: string;
        routePreference: {
          preferredRoute: string;
        };
        recallWorkflow: {
          recallFirst: string;
          progressiveDisclosure: string;
        };
        cliFallback: {
          searchCommand: string;
        };
      };
    };

    expect(payload).toMatchObject({
      host: "codex",
      readOnlyRetrieval: true,
      serverName: "codex_auto_memory",
      transport: "stdio",
      targetFileHint: ".codex/config.toml",
      projectRoot: realProjectDir,
      snippetFormat: "toml"
    });
    expect(payload.snippet).toContain('[mcp_servers.codex_auto_memory]');
    expect(payload.notes).toHaveLength(2);
    expect(payload.workflowContract).toMatchObject({
      recommendedPreset: "state=auto, limit=8",
      routePreference: {
        preferredRoute: "mcp-first"
      },
      recallWorkflow: {
        recallFirst: expect.stringContaining("recall durable memory first"),
        progressiveDisclosure: "Use progressive disclosure: search -> timeline -> details."
      },
      cliFallback: {
        searchCommand: `cam recall search "<query>" --state auto --limit 8 --cwd ${shellQuoteArg(realProjectDir)}`
      }
    });
    expect(payload.agentsGuidance).toMatchObject({
      targetFileHint: "AGENTS.md",
      snippetFormat: "markdown"
    });
    expect(payload.agentsGuidance?.snippet).toContain("search_memories");
    expect(payload.agentsGuidance?.snippet).toContain("cam recall search");
    expect(payload.agentsGuidance?.notes).toEqual(
      expect.arrayContaining([expect.stringContaining("local bridge")])
    );
  });

  it("applies the recommended AGENTS guidance by creating a managed block when AGENTS.md is missing", async () => {
    const homeDir = await tempDir("cam-mcp-apply-guidance-create-home-");
    const projectDir = await tempDir("cam-mcp-apply-guidance-create-project-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    const result = runCli(
      projectDir,
      ["mcp", "apply-guidance", "--host", "codex", "--json"],
      {
        env: { HOME: homeDir }
      }
    );
    expect(result.exitCode, result.stderr).toBe(0);

    expect(JSON.parse(result.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realProjectDir,
      targetPath: path.join(realProjectDir, "AGENTS.md"),
      action: "created",
      createdFile: true,
      managedBlockVersion: "codex-agents-guidance-v1"
    });
    const agentsContents = await fs.readFile(path.join(realProjectDir, "AGENTS.md"), "utf8");
    expect(agentsContents).toContain("cam:codex-agents-guidance:start");
    expect(agentsContents).toContain("cam:agents-guidance-version codex-agents-guidance-v1");
    expect(agentsContents).toContain("cam:codex-agents-guidance:end");
    expect(agentsContents).toContain("search_memories");
  });

  it("updates an existing managed AGENTS guidance block without replacing unrelated content", async () => {
    const homeDir = await tempDir("cam-mcp-apply-guidance-update-home-");
    const projectDir = await tempDir("cam-mcp-apply-guidance-update-project-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    await fs.writeFile(
      path.join(realProjectDir, "AGENTS.md"),
      [
        "# Project Notes",
        "",
        "- Keep existing repo guidance.",
        "",
        "<!-- cam:codex-agents-guidance:start -->",
        "<!-- cam:agents-guidance-version codex-agents-guidance-v0 -->",
        "- stale guidance",
        "<!-- cam:codex-agents-guidance:end -->",
        "",
        "- Preserve this trailing note."
      ].join("\n"),
      "utf8"
    );

    const result = runCli(
      projectDir,
      ["mcp", "apply-guidance", "--host", "codex", "--json"],
      {
        env: { HOME: homeDir }
      }
    );
    expect(result.exitCode, result.stderr).toBe(0);

    expect(JSON.parse(result.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realProjectDir,
      action: "updated",
      createdFile: false,
      managedBlockVersion: "codex-agents-guidance-v1"
    });
    const agentsContents = await fs.readFile(path.join(realProjectDir, "AGENTS.md"), "utf8");
    expect(agentsContents).toContain("# Project Notes");
    expect(agentsContents).toContain("- Preserve this trailing note.");
    expect(agentsContents).toContain("cam:agents-guidance-version codex-agents-guidance-v1");
    expect(agentsContents).not.toContain("codex-agents-guidance-v0");
    expect(agentsContents).toContain("search_memories");
  });

  it("ignores managed block markers that appear only inside fenced code blocks", async () => {
    const homeDir = await tempDir("cam-mcp-apply-guidance-fenced-home-");
    const projectDir = await tempDir("cam-mcp-apply-guidance-fenced-project-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    const exampleBlock = [
      "```md",
      "<!-- cam:codex-agents-guidance:start -->",
      "<!-- cam:agents-guidance-version codex-agents-guidance-v0 -->",
      "- example only",
      "<!-- cam:codex-agents-guidance:end -->",
      "```"
    ].join("\n");
    await fs.writeFile(
      path.join(realProjectDir, "AGENTS.md"),
      ["# Project Notes", "", exampleBlock, "", "- Keep this note."].join("\n"),
      "utf8"
    );

    const result = runCli(
      projectDir,
      ["mcp", "apply-guidance", "--host", "codex", "--json"],
      {
        env: { HOME: homeDir }
      }
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realProjectDir,
      action: "updated",
      createdFile: false,
      managedBlockVersion: "codex-agents-guidance-v1"
    });

    const agentsContents = await fs.readFile(path.join(realProjectDir, "AGENTS.md"), "utf8");
    expect(agentsContents).toContain(exampleBlock);
    expect(agentsContents).toContain("- Keep this note.");
    expect(agentsContents).toContain("cam:agents-guidance-version codex-agents-guidance-v1");
  });

  it("reports unchanged when the managed AGENTS guidance block is already current", async () => {
    const homeDir = await tempDir("cam-mcp-apply-guidance-unchanged-home-");
    const projectDir = await tempDir("cam-mcp-apply-guidance-unchanged-project-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    const printConfigResult = runCli(
      projectDir,
      ["mcp", "print-config", "--host", "codex", "--json"],
      { env: { HOME: homeDir } }
    );
    expect(printConfigResult.exitCode, printConfigResult.stderr).toBe(0);
    const printConfigPayload = JSON.parse(printConfigResult.stdout) as {
      agentsGuidance: { snippet: string };
    };
    await fs.writeFile(
      path.join(realProjectDir, "AGENTS.md"),
      [
        "# Project Notes",
        "",
        "<!-- cam:codex-agents-guidance:start -->",
        printConfigPayload.agentsGuidance.snippet,
        "<!-- cam:codex-agents-guidance:end -->"
      ].join("\n"),
      "utf8"
    );

    const before = await fs.readFile(path.join(realProjectDir, "AGENTS.md"), "utf8");
    const result = runCli(
      projectDir,
      ["mcp", "apply-guidance", "--host", "codex", "--json"],
      {
        env: { HOME: homeDir }
      }
    );
    expect(result.exitCode, result.stderr).toBe(0);

    expect(JSON.parse(result.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realProjectDir,
      action: "unchanged",
      createdFile: false,
      managedBlockVersion: "codex-agents-guidance-v1"
    });
    const after = await fs.readFile(path.join(realProjectDir, "AGENTS.md"), "utf8");
    expect(after).toBe(before);
  });

  it("preserves bytes outside the managed block when updating guidance", async () => {
    const homeDir = await tempDir("cam-mcp-apply-guidance-verbatim-home-");
    const projectDir = await tempDir("cam-mcp-apply-guidance-verbatim-project-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    const prefix = "# Intro\r\n\r\nParagraph with trailing spaces.  \r\n\r\n";
    const staleBlock = [
      "<!-- cam:codex-agents-guidance:start -->",
      "<!-- cam:agents-guidance-version codex-agents-guidance-v0 -->",
      "- stale guidance",
      "<!-- cam:codex-agents-guidance:end -->"
    ].join("\r\n");
    const suffix = "\r\n\r\n```md\r\nexample snippet\r\n```\r\n\r\nTail line.  \r\n";

    await fs.writeFile(path.join(realProjectDir, "AGENTS.md"), `${prefix}${staleBlock}${suffix}`, "utf8");

    const result = runCli(
      projectDir,
      ["mcp", "apply-guidance", "--host", "codex", "--json"],
      {
        env: { HOME: homeDir }
      }
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      action: "updated",
      managedBlockVersion: "codex-agents-guidance-v1"
    });

    const agentsContents = await fs.readFile(path.join(realProjectDir, "AGENTS.md"), "utf8");
    expect(agentsContents.startsWith(prefix)).toBe(true);
    expect(agentsContents.endsWith(suffix)).toBe(true);
    expect(agentsContents).toContain("cam:agents-guidance-version codex-agents-guidance-v1");
  });

  it("fails closed when AGENTS.md contains an unsafe managed guidance shape", async () => {
    const homeDir = await tempDir("cam-mcp-apply-guidance-blocked-home-");
    const projectDir = await tempDir("cam-mcp-apply-guidance-blocked-project-");
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

    const before = await fs.readFile(path.join(realProjectDir, "AGENTS.md"), "utf8");
    const result = runCli(
      projectDir,
      ["mcp", "apply-guidance", "--host", "codex", "--json"],
      {
        env: { HOME: homeDir }
      }
    );
    expect(result.exitCode, result.stderr).toBe(0);

    expect(JSON.parse(result.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realProjectDir,
      action: "blocked",
      createdFile: false,
      blockedReason: expect.stringContaining("managed guidance block")
    });
    const after = await fs.readFile(path.join(realProjectDir, "AGENTS.md"), "utf8");
    expect(after).toBe(before);
  });

  it("reports missing AGENTS guidance when the repository has no AGENTS.md", async () => {
    const homeDir = await tempDir("cam-mcp-doctor-agents-missing-home-");
    const projectDir = await tempDir("cam-mcp-doctor-agents-missing-project-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    const result = runCli(projectDir, ["mcp", "doctor", "--host", "codex", "--json"], {
      env: { HOME: homeDir }
    });
    expect(result.exitCode, result.stderr).toBe(0);

    expect(JSON.parse(result.stdout)).toMatchObject({
      agentsGuidance: {
        path: path.join(realProjectDir, "AGENTS.md"),
        exists: false,
        status: "missing"
      }
    });
  });

  it("reports warning when AGENTS.md exists but does not contain the recommended guidance", async () => {
    const homeDir = await tempDir("cam-mcp-doctor-agents-warning-home-");
    const projectDir = await tempDir("cam-mcp-doctor-agents-warning-project-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    await fs.writeFile(
      path.join(realProjectDir, "AGENTS.md"),
      "# Project Notes\n\n- This repo uses Codex.\n",
      "utf8"
    );

    const result = runCli(projectDir, ["mcp", "doctor", "--host", "codex", "--json"], {
      env: { HOME: homeDir }
    });
    expect(result.exitCode, result.stderr).toBe(0);

    expect(JSON.parse(result.stdout)).toMatchObject({
      agentsGuidance: {
        path: path.join(realProjectDir, "AGENTS.md"),
        exists: true,
        status: "warning"
      }
    });
  });

  it("reports ok when AGENTS.md contains the current recommended guidance snippet", async () => {
    const homeDir = await tempDir("cam-mcp-doctor-agents-ok-home-");
    const projectDir = await tempDir("cam-mcp-doctor-agents-ok-project-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    const printConfigResult = runCli(
      projectDir,
      ["mcp", "print-config", "--host", "codex", "--json"],
      { env: { HOME: homeDir } }
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

    const result = runCli(projectDir, ["mcp", "doctor", "--host", "codex", "--json"], {
      env: { HOME: homeDir }
    });
    expect(result.exitCode, result.stderr).toBe(0);

    expect(JSON.parse(result.stdout)).toMatchObject({
      agentsGuidance: {
        path: path.join(realProjectDir, "AGENTS.md"),
        exists: true,
        status: "ok"
      }
    });
  });

  it("does not treat a fenced guidance example as installed AGENTS guidance", async () => {
    const homeDir = await tempDir("cam-mcp-doctor-agents-fenced-home-");
    const projectDir = await tempDir("cam-mcp-doctor-agents-fenced-project-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    const printConfigResult = runCli(
      projectDir,
      ["mcp", "print-config", "--host", "codex", "--json"],
      { env: { HOME: homeDir } }
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

    const result = runCli(projectDir, ["mcp", "doctor", "--host", "codex", "--json"], {
      env: { HOME: homeDir }
    });
    expect(result.exitCode, result.stderr).toBe(0);

    expect(JSON.parse(result.stdout)).toMatchObject({
      agentsGuidance: {
        path: path.join(realProjectDir, "AGENTS.md"),
        exists: true,
        status: "warning"
      }
    });
  });

  it("reports warning when AGENTS.md carries an outdated guidance marker", async () => {
    const homeDir = await tempDir("cam-mcp-doctor-agents-stale-home-");
    const projectDir = await tempDir("cam-mcp-doctor-agents-stale-project-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    await fs.writeFile(
      path.join(realProjectDir, "AGENTS.md"),
      [
        "## Codex Auto Memory",
        "",
        "<!-- cam:agents-guidance-version codex-agents-guidance-v0 -->",
        "- search_memories",
        "- timeline_memories",
        "- get_memory_details",
        "- cam recall search",
        "- cam memory",
        "- cam session",
        "- Hook assets in this repository are local bridge and fallback helpers, not an official Codex hook surface."
      ].join("\n"),
      "utf8"
    );

    const result = runCli(projectDir, ["mcp", "doctor", "--host", "codex", "--json"], {
      env: { HOME: homeDir }
    });
    expect(result.exitCode, result.stderr).toBe(0);

    expect(JSON.parse(result.stdout)).toMatchObject({
      agentsGuidance: {
        path: path.join(realProjectDir, "AGENTS.md"),
        exists: true,
        status: "warning",
        detectedVersion: "codex-agents-guidance-v0"
      }
    });
  });

  it("uses action-aware text output for mcp install", async () => {
    const homeDir = await tempDir("cam-mcp-install-text-home-");
    const projectDir = await tempDir("cam-mcp-install-text-project-");
    process.env.HOME = homeDir;

    const created = runCli(projectDir, ["mcp", "install", "--host", "codex"], {
      env: { HOME: homeDir }
    });
    expect(created.exitCode, created.stderr).toBe(0);
    expect(created.stdout).toContain("Installed project-scoped MCP wiring for codex.");

    await fs.writeFile(
      path.join(projectDir, ".codex", "config.toml"),
      [
        "[mcp_servers.codex_auto_memory]",
        'command = "cam"',
        'args = ["mcp", "serve"]',
        'cwd = "/tmp/not-this-project"'
      ].join("\n"),
      "utf8"
    );

    const updated = runCli(projectDir, ["mcp", "install", "--host", "codex"], {
      env: { HOME: homeDir }
    });
    expect(updated.exitCode, updated.stderr).toBe(0);
    expect(updated.stdout).toContain("Updated project-scoped MCP wiring for codex.");

    const unchanged = runCli(projectDir, ["mcp", "install", "--host", "codex"], {
      env: { HOME: homeDir }
    });
    expect(unchanged.exitCode, unchanged.stderr).toBe(0);
    expect(unchanged.stdout).toContain(
      "Project-scoped MCP wiring for codex is already up to date."
    );
  });

  it("supports print-config --cwd for generating pinned snippets and workflow commands from another directory", async () => {
    const homeDir = await tempDir("cam-mcp-print-cwd-home-");
    const projectDir = await tempDir("cam-mcp-print-cwd-project-");
    const callerDir = await tempDir("cam-mcp-print-cwd-caller-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    const result = runCli(
      callerDir,
      ["mcp", "print-config", "--host", "generic", "--cwd", projectDir, "--json"],
      {
        env: { HOME: homeDir }
      }
    );

    expect(result.exitCode, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      host: string;
      projectRoot: string;
      readOnlyRetrieval: boolean;
      snippet: string;
      workflowContract: {
        cliFallback: {
          searchCommand: string;
          timelineCommand: string;
          detailsCommand: string;
        };
      };
    };
    expect(payload).toMatchObject({
      host: "generic",
      projectRoot: realProjectDir,
      readOnlyRetrieval: true
    });
    expect(payload.snippet).toContain(realProjectDir);
    expect(payload.workflowContract).toBeUndefined();
  });

  it("pins Codex AGENTS guidance fallback commands when print-config uses --cwd", async () => {
    const homeDir = await tempDir("cam-mcp-print-codex-cwd-home-");
    const projectDir = await tempDir("cam-mcp-print-codex-cwd-project-");
    const callerDir = await tempDir("cam-mcp-print-codex-cwd-caller-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    const result = runCli(
      callerDir,
      ["mcp", "print-config", "--host", "codex", "--cwd", projectDir, "--json"],
      {
        env: { HOME: homeDir }
      }
    );

    expect(result.exitCode, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      agentsGuidance: {
        snippet: string;
      };
    };
    expect(payload.agentsGuidance.snippet).toContain(
      `cam recall search "<query>" --state auto --limit 8 --cwd ${shellQuoteArg(realProjectDir)}`
    );
    expect(payload.agentsGuidance.snippet).toContain(
      `cam recall timeline "<ref>" --cwd ${shellQuoteArg(realProjectDir)}`
    );
    expect(payload.agentsGuidance.snippet).toContain(
      `cam recall details "<ref>" --cwd ${shellQuoteArg(realProjectDir)}`
    );
    expect(payload.agentsGuidance.snippet).toContain(
      `post-work-memory-review.sh`
    );
  });

  it("pins the recommended skill install command to the inspected project when mcp doctor uses --cwd", async () => {
    const homeDir = await tempDir("cam-mcp-doctor-cwd-home-");
    const projectParentDir = await tempDir("cam-mcp-doctor-cwd-parent-");
    const projectDir = path.join(projectParentDir, "project with spaces");
    const shellDir = await tempDir("cam-mcp-doctor-cwd-shell-");
    process.env.HOME = homeDir;

    await fs.mkdir(projectDir, { recursive: true });

    const result = runCli(
      shellDir,
      ["mcp", "doctor", "--host", "codex", "--cwd", projectDir, "--json"],
      {
        env: { HOME: homeDir }
      }
    );
    expect(result.exitCode, result.stderr).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      projectRoot: string;
      fallbackAssets: {
        recommendedSkillInstallCommand: string;
      };
    };
    expect(payload.projectRoot).toBe(await fs.realpath(projectDir));
    expect(payload.fallbackAssets.recommendedSkillInstallCommand).toBe(
      `cam skills install --surface runtime --cwd ${shellQuoteArg(payload.projectRoot)}`
    );
  });

  it("inspects project-scoped MCP wiring and fallback bridge assets", async () => {
    const homeDir = await tempDir("cam-mcp-doctor-home-");
    const projectDir = await tempDir("cam-mcp-doctor-project-");
    const callerDir = await tempDir("cam-mcp-doctor-caller-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    const codexSnippetResult = runCli(
      projectDir,
      ["mcp", "print-config", "--host", "codex", "--json"],
      { env: { HOME: homeDir } }
    );
    expect(codexSnippetResult.exitCode, codexSnippetResult.stderr).toBe(0);
    const codexSnippetPayload = JSON.parse(codexSnippetResult.stdout) as { snippet: string };

    const claudeSnippetResult = runCli(
      projectDir,
      ["mcp", "print-config", "--host", "claude", "--json"],
      { env: { HOME: homeDir } }
    );
    expect(claudeSnippetResult.exitCode, claudeSnippetResult.stderr).toBe(0);
    const claudeSnippetPayload = JSON.parse(claudeSnippetResult.stdout) as { snippet: string };

    await fs.mkdir(path.join(projectDir, ".codex"), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, ".codex", "config.toml"),
      codexSnippetPayload.snippet.replace(`cwd = ${JSON.stringify(realProjectDir)}`, ""),
      "utf8"
    );
    await fs.writeFile(path.join(projectDir, ".mcp.json"), `${claudeSnippetPayload.snippet}\n`, "utf8");

    expect(runCli(projectDir, ["hooks", "install"], { env: { HOME: homeDir } }).exitCode).toBe(0);
    expect(runCli(projectDir, ["skills", "install"], { env: { HOME: homeDir } }).exitCode).toBe(0);

    const result = runCli(
      callerDir,
      ["mcp", "doctor", "--cwd", projectDir, "--json"],
      { env: { HOME: homeDir } }
    );
    expect(result.exitCode, result.stderr).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      projectRoot: string;
      serverName: string;
      readOnlyRetrieval: boolean;
      agentsGuidance: {
        path: string;
        exists: boolean;
        status: string;
      };
      commandSurface: {
        install: boolean;
        serve: boolean;
        printConfig: boolean;
        applyGuidance: boolean;
        doctor: boolean;
      };
      fallbackAssets: {
        hookHelpersInstalled: boolean;
        startupDoctorInstalled: boolean;
        postWorkReviewInstalled: boolean;
        skillInstalled: boolean;
        fallbackAvailable: boolean;
        assets: Array<{
          id: string;
          name: string;
          installed: boolean;
          status: string;
          expectedVersion: string;
          detectedVersion: string | null;
          executableExpected: boolean;
          executableOk: boolean | null;
        }>;
      };
      workflowContract: {
        version: string;
        recommendedPreset: string;
        preferredRoute: string;
        recallFirst: string;
        progressiveDisclosure: string;
        cliFallback: {
          searchCommand: string;
          timelineCommand: string;
          detailsCommand: string;
        };
        postWorkSyncReview: {
          helperScript: string;
          syncCommand: string;
          reviewCommand: string;
        };
      };
      codexStack: {
        status: string;
        recommendedRoute: string;
        preset: string;
        assetVersion: string;
        mcpReady: boolean;
        hookCaptureReady: boolean;
        hookRecallReady: boolean;
        skillReady: boolean;
        workflowConsistent: boolean;
      };
      retrievalSidecar: {
        status: string;
        summary: string;
        checks: Array<{
          scope: string;
          state: string;
          status: string;
          fallbackReason?: string;
          indexPath: string;
          generatedAt: string | null;
          topicFileCount: number | null;
        }>;
      };
      hosts: Array<{
        host: string;
        status: string;
        configCheck?: {
          exists: boolean;
          projectPinned: boolean;
        };
      }>;
    };

    expect(payload.projectRoot).toBe(realProjectDir);
    expect(payload.serverName).toBe("codex_auto_memory");
    expect(payload.readOnlyRetrieval).toBe(true);
    expect(payload.commandSurface).toMatchObject({
      install: true,
      serve: true,
      printConfig: true,
      applyGuidance: true,
      doctor: true
    });
    expect(payload.fallbackAssets).toMatchObject({
      hookHelpersInstalled: true,
      startupDoctorInstalled: true,
      postWorkReviewInstalled: true,
      skillInstalled: true,
      fallbackAvailable: true
    });
    expect(payload.fallbackAssets.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "post-session-sync",
          name: "post-session-sync.sh",
          installed: true,
          status: "ok",
          expectedVersion: RETRIEVAL_INTEGRATION_ASSET_VERSION,
          detectedVersion: RETRIEVAL_INTEGRATION_ASSET_VERSION,
          executableExpected: true,
          executableOk: true
        }),
        expect.objectContaining({
          id: "post-work-memory-review",
          name: "post-work-memory-review.sh",
          installed: true,
          status: "ok",
          expectedVersion: RETRIEVAL_INTEGRATION_ASSET_VERSION,
          detectedVersion: RETRIEVAL_INTEGRATION_ASSET_VERSION,
          executableExpected: true,
          executableOk: true
        }),
        expect.objectContaining({
          name: "memory-recall.sh",
          installed: true,
          status: "ok",
          expectedVersion: RETRIEVAL_INTEGRATION_ASSET_VERSION,
          detectedVersion: RETRIEVAL_INTEGRATION_ASSET_VERSION,
          executableExpected: true,
          executableOk: true
        }),
        expect.objectContaining({
          name: "memory-search.sh",
          installed: true,
          status: "ok",
          expectedVersion: RETRIEVAL_INTEGRATION_ASSET_VERSION,
          detectedVersion: RETRIEVAL_INTEGRATION_ASSET_VERSION,
          executableExpected: true,
          executableOk: true
        }),
        expect.objectContaining({
          name: "memory-timeline.sh",
          installed: true,
          status: "ok",
          expectedVersion: RETRIEVAL_INTEGRATION_ASSET_VERSION,
          detectedVersion: RETRIEVAL_INTEGRATION_ASSET_VERSION,
          executableExpected: true,
          executableOk: true
        }),
        expect.objectContaining({
          name: "memory-details.sh",
          installed: true,
          status: "ok",
          expectedVersion: RETRIEVAL_INTEGRATION_ASSET_VERSION,
          detectedVersion: RETRIEVAL_INTEGRATION_ASSET_VERSION,
          executableExpected: true,
          executableOk: true
        }),
        expect.objectContaining({
          name: "recall-bridge.md",
          installed: true,
          status: "ok",
          expectedVersion: RETRIEVAL_INTEGRATION_ASSET_VERSION,
          detectedVersion: RETRIEVAL_INTEGRATION_ASSET_VERSION,
          executableExpected: false,
          executableOk: null
        }),
        expect.objectContaining({
          name: "codex-auto-memory-recall SKILL.md",
          installed: true,
          status: "ok",
          expectedVersion: RETRIEVAL_INTEGRATION_ASSET_VERSION,
          detectedVersion: RETRIEVAL_INTEGRATION_ASSET_VERSION,
          executableExpected: false,
          executableOk: null
        })
      ])
    );
    expect(payload.workflowContract).toMatchObject({
      version: RETRIEVAL_INTEGRATION_ASSET_VERSION,
      recommendedPreset: "state=auto, limit=8",
      preferredRoute: "mcp-first",
      recallFirst: expect.stringContaining("recall durable memory first"),
      progressiveDisclosure: "Use progressive disclosure: search -> timeline -> details.",
      cliFallback: {
        searchCommand: `cam recall search "<query>" --state auto --limit 8 --cwd ${shellQuoteArg(realProjectDir)}`,
        timelineCommand: `cam recall timeline "<ref>" --cwd ${shellQuoteArg(realProjectDir)}`,
        detailsCommand: `cam recall details "<ref>" --cwd ${shellQuoteArg(realProjectDir)}`
      },
      postWorkSyncReview: {
        helperScript: "post-work-memory-review.sh",
        syncCommand: `cam sync --cwd ${shellQuoteArg(realProjectDir)}`,
        reviewCommand: `cam memory --recent --cwd ${shellQuoteArg(realProjectDir)}`
      }
    });
    expect(payload.codexStack).toMatchObject({
      status: "warning",
      recommendedRoute: "cli-direct",
      preset: "state=auto, limit=8",
      assetVersion: RETRIEVAL_INTEGRATION_ASSET_VERSION,
      mcpReady: false,
      hookCaptureReady: true,
      hookRecallReady: true,
      hookRecallOperationalReady: false,
      skillReady: true,
      workflowConsistent: false
    });
    expect(payload.retrievalSidecar).toMatchObject({
      status: "warning",
      summary: expect.stringContaining("Markdown"),
      repairCommand: `cam memory reindex --scope all --state all --cwd ${shellQuoteArg(realProjectDir)}`,
      checks: expect.arrayContaining([
        expect.objectContaining({
          scope: "project",
          state: "active",
          status: "missing",
          fallbackReason: "missing",
          indexPath: expect.stringContaining("retrieval-index.json"),
          generatedAt: null,
          topicFileCount: null
        })
      ])
    });
    expect(payload.agentsGuidance).toMatchObject({
      path: path.join(realProjectDir, "AGENTS.md"),
      exists: false,
      status: "missing"
    });
    const integrationsDoctor = runCli(
      projectDir,
      ["integrations", "doctor", "--host", "codex", "--json"],
      {
        env: { HOME: homeDir }
      }
    );
    expect(integrationsDoctor.exitCode, integrationsDoctor.stderr).toBe(0);
    expect(JSON.parse(integrationsDoctor.stdout)).toMatchObject({
      retrievalSidecar: {
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
        workflowConsistency: {
          status: "warning",
          summary: expect.stringContaining("AGENTS")
        }
      }
    });
    expect(payload.hosts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          host: "codex",
          status: "warning",
          configCheck: expect.objectContaining({
            exists: true,
            projectPinned: false
          })
        }),
        expect.objectContaining({
          host: "claude",
          status: "ok",
          configCheck: expect.objectContaining({
            exists: true,
            projectPinned: true
          })
        }),
        expect.objectContaining({
          host: "gemini",
          status: "missing",
          configCheck: expect.objectContaining({
            exists: false
          })
        }),
        expect.objectContaining({
          host: "generic",
          status: "manual"
        })
      ])
    );
  });

  it("reports alternate global wiring separately from the recommended project-scoped route", async () => {
    const homeDir = await tempDir("cam-mcp-doctor-global-home-");
    const projectDir = await tempDir("cam-mcp-doctor-global-project-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    await fs.mkdir(path.join(homeDir, ".codex"), { recursive: true });
    await fs.writeFile(
      path.join(homeDir, ".codex", "config.toml"),
      [
        "[mcp_servers.codex_auto_memory]",
        'command = "cam"',
        'args = ["mcp", "serve"]',
        `cwd = ${JSON.stringify(realProjectDir)}`
      ].join("\n"),
      "utf8"
    );

    const result = runCli(projectDir, ["mcp", "doctor", "--host", "codex", "--json"], {
      env: { HOME: homeDir }
    });
    expect(result.exitCode, result.stderr).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      hosts: Array<{
        host: string;
        status: string;
        summary: string;
        configScopeSummary?: string;
        recommendedScope?: string;
        detectedScopes?: string[];
        alternateWiring?: {
          detected: boolean;
          valid: boolean;
          scopes: string[];
          issues: Array<{
            scope: string;
            inspection: string;
          }>;
        };
        configCheck?: {
          exists: boolean;
        };
        alternateConfigChecks?: Array<{
          scope: string;
          exists: boolean;
          projectPinned: boolean;
        }>;
      }>;
    };
    expect(payload.hosts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          host: "codex",
          status: "warning",
          summary: expect.stringContaining("global"),
          configScopeSummary: "project-missing-global-alternate",
          recommendedScope: "project",
          detectedScopes: ["global"],
          alternateWiring: {
            detected: true,
            valid: true,
            scopes: ["global"],
            issues: []
          },
          configCheck: expect.objectContaining({
            exists: false
          }),
          alternateConfigChecks: expect.arrayContaining([
            expect.objectContaining({
              scope: "global",
              exists: true,
              projectPinned: true
            })
          ])
        })
      ])
    );
  });

  it("does not treat malformed global config as alternate global wiring", async () => {
    const homeDir = await tempDir("cam-mcp-doctor-global-parse-error-home-");
    const projectDir = await tempDir("cam-mcp-doctor-global-parse-error-project-");
    process.env.HOME = homeDir;

    await fs.mkdir(path.join(homeDir, ".codex"), { recursive: true });
    await fs.writeFile(path.join(homeDir, ".codex", "config.toml"), 'not = "valid', "utf8");

    const result = runCli(projectDir, ["mcp", "doctor", "--host", "codex", "--json"], {
      env: { HOME: homeDir }
    });
    expect(result.exitCode, result.stderr).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      hosts: Array<{
        host: string;
        status: string;
        summary: string;
        configScopeSummary?: string;
        recommendedScope?: string;
        detectedScopes?: string[];
        alternateWiring?: {
          detected: boolean;
          valid: boolean;
          scopes: string[];
          issues: Array<{
            scope: string;
            inspection: string;
          }>;
        };
        alternateConfigChecks?: Array<{
          scope: string;
          exists: boolean;
        }>;
      }>;
    };

    expect(payload.hosts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          host: "codex",
          status: "warning",
          summary: expect.stringContaining("could not be parsed"),
          configScopeSummary: "project-missing-global-invalid",
          recommendedScope: "project",
          detectedScopes: [],
          alternateWiring: expect.objectContaining({
            detected: false,
            valid: false,
            scopes: [],
            issues: expect.arrayContaining([
              expect.objectContaining({
                scope: "global",
                inspection: "parse-error"
              })
            ])
          })
        })
      ])
    );
    expect(
      payload.hosts.find((host) => host.host === "codex")?.alternateConfigChecks ?? []
    ).toEqual([]);
  });

  it("surfaces direct apply safety in mcp doctor when AGENTS guidance is unsafe", async () => {
    const homeDir = await tempDir("cam-mcp-doctor-apply-safety-home-");
    const projectDir = await tempDir("cam-mcp-doctor-apply-safety-project-");
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

    const result = runCli(projectDir, ["mcp", "doctor", "--host", "codex", "--json"], {
      env: { HOME: homeDir }
    });
    expect(result.exitCode, result.stderr).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      applySafety: {
        status: string;
        targetPath: string;
        blockedReason?: string;
        recommendedAction: string;
      };
    };
    expect(payload.applySafety).toMatchObject({
      status: "blocked",
      targetPath: path.join(realProjectDir, "AGENTS.md"),
      recommendedAction: "blocked",
      blockedReason: expect.stringContaining("managed guidance block")
    });
  });

  it("keeps mcp doctor read-only and does not create memory layout", async () => {
    const homeDir = await tempDir("cam-mcp-doctor-readonly-home-");
    const projectDir = await tempDir("cam-mcp-doctor-readonly-project-");
    const memoryRootParent = await tempDir("cam-mcp-doctor-readonly-memory-parent-");
    const memoryRoot = path.join(memoryRootParent, "memory-root");
    process.env.HOME = homeDir;

    await writeCamConfig(projectDir, makeAppConfig(), {
      autoMemoryDirectory: memoryRoot
    });

    const result = runCli(projectDir, ["mcp", "doctor", "--host", "codex", "--json"], {
      env: { HOME: homeDir }
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      hosts: Array<{ host: string; status: string }>;
    };
    expect(payload.hosts).toEqual([
      expect.objectContaining({
        host: "codex",
        status: "missing"
      })
    ]);
    expect(await pathExists(memoryRoot)).toBe(false);
  });

  it("reports CODEX_HOME runtime skills path separately from the official skills path", async () => {
    const homeDir = await tempDir("cam-mcp-doctor-codex-home-home-");
    const codexHome = await tempDir("cam-mcp-doctor-codex-home-codex-home-");
    const projectDir = await tempDir("cam-mcp-doctor-codex-home-project-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;
    process.env.CODEX_HOME = codexHome;

    expect(
      runCli(projectDir, ["skills", "install"], {
        env: { HOME: homeDir, CODEX_HOME: codexHome }
      }).exitCode
    ).toBe(0);

    const result = runCli(projectDir, ["mcp", "doctor", "--json"], {
      env: { HOME: homeDir, CODEX_HOME: codexHome }
    });
    expect(result.exitCode, result.stderr).toBe(0);

    expect(JSON.parse(result.stdout)).toMatchObject({
      fallbackAssets: {
        skillDir: path.join(codexHome, "skills", "codex-auto-memory-recall"),
        runtimeSkillDir: path.join(codexHome, "skills", "codex-auto-memory-recall"),
        runtimeAssetDir: path.join(codexHome, "skills", "codex-auto-memory-recall"),
        runtimeSource: "CODEX_HOME",
        preferredInstallSurface: "runtime",
        recommendedSkillInstallCommand: "cam skills install --surface runtime",
        runtimeSkillPresent: true,
        runtimeSkillInstalled: true,
        runtimeSkillMatchesCanonical: true,
        runtimeSkillReady: true,
        officialUserSkillDir: path.join(
          homeDir,
          ".agents",
          "skills",
          "codex-auto-memory-recall"
        ),
        officialProjectSkillDir: path.join(
          realProjectDir,
          ".agents",
          "skills",
          "codex-auto-memory-recall"
        ),
        officialUserSkillInstalled: false,
        officialProjectSkillInstalled: false,
        officialUserSkillMatchesCanonical: false,
        officialProjectSkillMatchesCanonical: false,
        officialUserSkillMatchesRuntime: false,
        officialProjectSkillMatchesRuntime: false,
        officialUserSkillReady: false,
        officialProjectSkillReady: false,
        anySkillSurfaceInstalled: true,
        anySkillSurfaceReady: true,
        installedSkillSurfaces: ["runtime"],
        readySkillSurfaces: ["runtime"],
        skillPathDrift: true,
        skillInstalled: true
      }
    });
  });

  it("reports explicit official skill copies while keeping runtime as the preferred surface", async () => {
    const homeDir = await tempDir("cam-mcp-doctor-official-surface-home-");
    const projectDir = await tempDir("cam-mcp-doctor-official-surface-project-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    expect(
      runCli(projectDir, ["skills", "install", "--surface", "official-user"], {
        env: { HOME: homeDir }
      }).exitCode
    ).toBe(0);

    const result = runCli(projectDir, ["mcp", "doctor", "--json"], {
      env: { HOME: homeDir }
    });
    expect(result.exitCode, result.stderr).toBe(0);

    expect(JSON.parse(result.stdout)).toMatchObject({
      fallbackAssets: {
        runtimeSkillDir: path.join(homeDir, ".codex", "skills", "codex-auto-memory-recall"),
        preferredInstallSurface: "runtime",
        recommendedSkillInstallCommand: "cam skills install --surface runtime",
        runtimeSkillPresent: false,
        runtimeSkillInstalled: false,
        runtimeSkillReady: false,
        officialUserSkillDir: path.join(
          homeDir,
          ".agents",
          "skills",
          "codex-auto-memory-recall"
        ),
        officialProjectSkillDir: path.join(
          realProjectDir,
          ".agents",
          "skills",
          "codex-auto-memory-recall"
        ),
        officialUserSkillInstalled: true,
        officialUserSkillMatchesCanonical: true,
        officialUserSkillMatchesRuntime: false,
        officialUserSkillReady: true,
        officialProjectSkillInstalled: false,
        officialProjectSkillMatchesCanonical: false,
        officialProjectSkillReady: false,
        anySkillSurfaceInstalled: true,
        anySkillSurfaceReady: true,
        installedSkillSurfaces: ["official-user"],
        readySkillSurfaces: ["official-user"],
        skillInstalled: true
      },
      codexStack: {
        skillReady: true
      }
    });
  });

  it("keeps official-project skill readiness semantics aligned with canonical and runtime state separately", async () => {
    const homeDir = await tempDir("cam-mcp-doctor-official-project-home-");
    const projectDir = await tempDir("cam-mcp-doctor-official-project-project-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    expect(
      runCli(projectDir, ["skills", "install", "--surface", "official-project"], {
        env: { HOME: homeDir }
      }).exitCode
    ).toBe(0);

    const result = runCli(projectDir, ["mcp", "doctor", "--json"], {
      env: { HOME: homeDir }
    });
    expect(result.exitCode, result.stderr).toBe(0);

    expect(JSON.parse(result.stdout)).toMatchObject({
      fallbackAssets: {
        runtimeSkillPresent: false,
        runtimeSkillInstalled: false,
        runtimeSkillReady: false,
        officialUserSkillInstalled: false,
        officialUserSkillMatchesCanonical: false,
        officialUserSkillMatchesRuntime: false,
        officialUserSkillReady: false,
        officialProjectSkillDir: path.join(
          realProjectDir,
          ".agents",
          "skills",
          "codex-auto-memory-recall"
        ),
        officialProjectSkillInstalled: true,
        officialProjectSkillMatchesCanonical: true,
        officialProjectSkillMatchesRuntime: false,
        officialProjectSkillReady: true,
        anySkillSurfaceInstalled: true,
        anySkillSurfaceReady: true,
        installedSkillSurfaces: ["official-project"],
        readySkillSurfaces: ["official-project"],
        skillInstalled: true
      },
      codexStack: {
        skillReady: true
      }
    });
  });

  it("fails closed when CODEX_HOME is a relative path", async () => {
    const homeDir = await tempDir("cam-mcp-doctor-relative-codex-home-home-");
    const projectDir = await tempDir("cam-mcp-doctor-relative-codex-home-project-");
    process.env.HOME = homeDir;
    process.env.CODEX_HOME = "relative-codex-home";

    const result = runCli(projectDir, ["mcp", "doctor", "--json"], {
      env: { HOME: homeDir, CODEX_HOME: "relative-codex-home" }
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("CODEX_HOME");
    expect(result.stderr).toContain("absolute path");
  });

  it("flags stale fallback assets when legacy files are present without the current contract marker", async () => {
    const homeDir = await tempDir("cam-mcp-doctor-stale-home-");
    const projectDir = await tempDir("cam-mcp-doctor-stale-project-");
    process.env.HOME = homeDir;

    const hooksDir = path.join(homeDir, ".codex-auto-memory", "hooks");
    const skillDir = path.join(homeDir, ".codex", "skills", "codex-auto-memory-recall");
    await fs.mkdir(hooksDir, { recursive: true });
    await fs.mkdir(skillDir, { recursive: true });

    for (const fileName of [
      "memory-recall.sh",
      "memory-search.sh",
      "memory-timeline.sh",
      "memory-details.sh",
      "startup-doctor.sh",
      "recall-bridge.md"
    ]) {
      await fs.writeFile(path.join(hooksDir, fileName), "legacy asset without version marker\n", "utf8");
    }
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: codex-auto-memory-recall\n---\nlegacy skill without version marker\n",
      "utf8"
    );

    const result = runCli(projectDir, ["mcp", "doctor", "--json"], {
      env: { HOME: homeDir }
    });
    expect(result.exitCode, result.stderr).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      fallbackAssets: {
        hookHelpersInstalled: boolean;
        postWorkReviewInstalled: boolean;
        startupDoctorInstalled: boolean;
        anySkillSurfaceInstalled: boolean;
        anySkillSurfaceReady: boolean;
        skillInstalled: boolean;
        fallbackAvailable: boolean;
        assets: Array<{
          name: string;
          installed: boolean;
          status: string;
          expectedVersion: string;
          detectedVersion: string | null;
        }>;
      };
    };
    expect(payload.fallbackAssets).toMatchObject({
      hookHelpersInstalled: false,
      postWorkReviewInstalled: false,
      startupDoctorInstalled: false,
      anySkillSurfaceInstalled: true,
      anySkillSurfaceReady: false,
      skillInstalled: false,
      fallbackAvailable: false
    });
    expect(payload.fallbackAssets.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "memory-recall.sh",
          installed: true,
          status: "stale",
          expectedVersion: RETRIEVAL_INTEGRATION_ASSET_VERSION,
          detectedVersion: null
        }),
        expect.objectContaining({
          name: "codex-auto-memory-recall SKILL.md",
          installed: true,
          status: "stale",
          expectedVersion: RETRIEVAL_INTEGRATION_ASSET_VERSION,
          detectedVersion: null
        })
      ])
    );
  });

  it("flags stale fallback assets when version markers remain but key content signatures are missing", async () => {
    const homeDir = await tempDir("cam-mcp-doctor-marker-only-home-");
    const projectDir = await tempDir("cam-mcp-doctor-marker-only-project-");
    process.env.HOME = homeDir;

    const hooksDir = path.join(homeDir, ".codex-auto-memory", "hooks");
    const skillDir = path.join(homeDir, ".codex", "skills", "codex-auto-memory-recall");
    await fs.mkdir(hooksDir, { recursive: true });
    await fs.mkdir(skillDir, { recursive: true });

    const shellMarker = `# cam:asset-version ${RETRIEVAL_INTEGRATION_ASSET_VERSION}\n`;
    const markdownMarker = `<!-- cam:asset-version ${RETRIEVAL_INTEGRATION_ASSET_VERSION} -->\n`;

    await fs.writeFile(
      path.join(hooksDir, "memory-recall.sh"),
      `#!/bin/sh\n${shellMarker}echo broken\n`,
      "utf8"
    );
    await fs.writeFile(
      path.join(hooksDir, "memory-search.sh"),
      `#!/bin/sh\n${shellMarker}echo broken\n`,
      "utf8"
    );
    await fs.writeFile(
      path.join(hooksDir, "memory-timeline.sh"),
      `#!/bin/sh\n${shellMarker}echo broken\n`,
      "utf8"
    );
    await fs.writeFile(
      path.join(hooksDir, "memory-details.sh"),
      `#!/bin/sh\n${shellMarker}echo broken\n`,
      "utf8"
    );
    await fs.writeFile(
      path.join(hooksDir, "startup-doctor.sh"),
      `#!/bin/sh\n${shellMarker}echo broken\n`,
      "utf8"
    );
    await fs.writeFile(
      path.join(hooksDir, "recall-bridge.md"),
      `# Broken Recall Bridge\n\n${markdownMarker}\n`,
      "utf8"
    );
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      `---\nname: codex-auto-memory-recall\n---\n\n${markdownMarker}\n`,
      "utf8"
    );

    const result = runCli(projectDir, ["mcp", "doctor", "--json"], {
      env: { HOME: homeDir }
    });
    expect(result.exitCode, result.stderr).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      fallbackAssets: {
        hookHelpersInstalled: boolean;
        postWorkReviewInstalled: boolean;
        startupDoctorInstalled: boolean;
        anySkillSurfaceInstalled: boolean;
        anySkillSurfaceReady: boolean;
        skillInstalled: boolean;
        fallbackAvailable: boolean;
        assets: Array<{
          name: string;
          installed: boolean;
          status: string;
          expectedVersion: string;
          detectedVersion: string | null;
        }>;
      };
    };
    expect(payload.fallbackAssets).toMatchObject({
      hookHelpersInstalled: false,
      postWorkReviewInstalled: false,
      startupDoctorInstalled: false,
      anySkillSurfaceInstalled: true,
      anySkillSurfaceReady: false,
      skillInstalled: false,
      fallbackAvailable: false
    });
    expect(payload.fallbackAssets.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "memory-recall.sh",
          installed: true,
          status: "stale",
          expectedVersion: RETRIEVAL_INTEGRATION_ASSET_VERSION,
          detectedVersion: RETRIEVAL_INTEGRATION_ASSET_VERSION
        }),
        expect.objectContaining({
          name: "startup-doctor.sh",
          installed: true,
          status: "stale",
          expectedVersion: RETRIEVAL_INTEGRATION_ASSET_VERSION,
          detectedVersion: RETRIEVAL_INTEGRATION_ASSET_VERSION
        }),
        expect.objectContaining({
          name: "recall-bridge.md",
          installed: true,
          status: "stale",
          expectedVersion: RETRIEVAL_INTEGRATION_ASSET_VERSION,
          detectedVersion: RETRIEVAL_INTEGRATION_ASSET_VERSION
        }),
        expect.objectContaining({
          name: "codex-auto-memory-recall SKILL.md",
          installed: true,
          status: "stale",
          expectedVersion: RETRIEVAL_INTEGRATION_ASSET_VERSION,
          detectedVersion: RETRIEVAL_INTEGRATION_ASSET_VERSION
        })
      ])
    );
  });

  it("flags hook assets as stale when executable bits are missing", async () => {
    const homeDir = await tempDir("cam-mcp-doctor-exec-home-");
    const projectDir = await tempDir("cam-mcp-doctor-exec-project-");
    process.env.HOME = homeDir;

    expect(runCli(projectDir, ["hooks", "install"], { env: { HOME: homeDir } }).exitCode).toBe(0);
    expect(runCli(projectDir, ["skills", "install"], { env: { HOME: homeDir } }).exitCode).toBe(0);

    const brokenScriptPath = path.join(homeDir, ".codex-auto-memory", "hooks", "memory-recall.sh");
    await fs.chmod(brokenScriptPath, 0o644);

    const result = runCli(projectDir, ["mcp", "doctor", "--json"], {
      env: { HOME: homeDir }
    });
    expect(result.exitCode, result.stderr).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      fallbackAssets: {
        hookHelpersInstalled: boolean;
        assets: Array<{
          id: string;
          name: string;
          status: string;
          executableExpected: boolean;
          executableOk: boolean | null;
        }>;
      };
      codexStack: {
        status: string;
        recommendedRoute: string;
        hookRecallReady: boolean;
      };
    };
    expect(payload.fallbackAssets.hookHelpersInstalled).toBe(false);
    expect(payload.fallbackAssets.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "memory-recall",
          name: "memory-recall.sh",
          status: "stale",
          executableExpected: true,
          executableOk: false
        })
      ])
    );
    expect(payload.codexStack).toMatchObject({
      status: "warning",
      recommendedRoute: "cli-direct",
      hookRecallReady: false
    });
  });

  it("distinguishes configured MCP wiring from operational readiness when cam is unavailable on PATH", async () => {
    const homeDir = await tempDir("cam-mcp-doctor-command-home-");
    const projectDir = await tempDir("cam-mcp-doctor-command-project-");
    const emptyPathDir = await tempDir("cam-mcp-doctor-command-empty-path-");
    process.env.HOME = homeDir;

    const installResult = runCli(projectDir, ["mcp", "install", "--host", "codex", "--json"], {
      env: {
        HOME: homeDir,
        PATH: await buildPathWithoutCam(emptyPathDir)
      }
    });
    expect(installResult.exitCode, installResult.stderr).toBe(0);

    const doctorResult = runCli(projectDir, ["mcp", "doctor", "--host", "codex", "--json"], {
      env: {
        HOME: homeDir,
        PATH: await buildPathWithoutCam(emptyPathDir)
      }
    });
    expect(doctorResult.exitCode, doctorResult.stderr).toBe(0);

    const payload = JSON.parse(doctorResult.stdout) as {
      codexStack: {
        recommendedRoute: string;
        mcpReady: boolean;
        mcpOperationalReady: boolean;
        camCommandAvailable: boolean;
        hookCaptureOperationalReady: boolean;
        hookRecallOperationalReady: boolean;
      };
      hosts: Array<{
        host: string;
        status: string;
      }>;
    };

    expect(payload.hosts).toEqual([
      expect.objectContaining({
        host: "codex",
        status: "ok"
      })
    ]);
    expect(payload.codexStack).toMatchObject({
      recommendedRoute: "cli-direct",
      mcpReady: true,
      mcpOperationalReady: false,
      camCommandAvailable: false,
      hookCaptureOperationalReady: false,
      hookRecallOperationalReady: false
    });
  });

  it("does not treat hook recall assets as operational when cam is unavailable on PATH", async () => {
    const homeDir = await tempDir("cam-mcp-doctor-hook-op-home-");
    const projectDir = await tempDir("cam-mcp-doctor-hook-op-project-");
    const emptyPathDir = await tempDir("cam-mcp-doctor-hook-op-empty-path-");
    process.env.HOME = homeDir;

    const hooksInstall = runCli(projectDir, ["hooks", "install", "--json"], {
      env: {
        HOME: homeDir,
        PATH: await buildPathWithoutCam(emptyPathDir)
      }
    });
    expect(hooksInstall.exitCode, hooksInstall.stderr).toBe(0);

    const doctorResult = runCli(projectDir, ["mcp", "doctor", "--host", "codex", "--json"], {
      env: {
        HOME: homeDir,
        PATH: await buildPathWithoutCam(emptyPathDir)
      }
    });
    expect(doctorResult.exitCode, doctorResult.stderr).toBe(0);

    const payload = JSON.parse(doctorResult.stdout) as {
      codexStack: {
        recommendedRoute: string;
        camCommandAvailable: boolean;
        hookRecallReady: boolean;
        hookRecallOperationalReady: boolean;
      };
    };

    expect(payload.codexStack).toMatchObject({
      recommendedRoute: "cli-direct",
      camCommandAvailable: false,
      hookRecallReady: true,
      hookRecallOperationalReady: false
    });
  });

  it("suggests the smallest retrieval sidecar repair command when only one scope/state check is degraded", async () => {
    const homeDir = await tempDir("cam-mcp-doctor-min-repair-home-");
    const projectDir = await tempDir("cam-mcp-doctor-min-repair-project-");
    const memoryRoot = await tempDir("cam-mcp-doctor-min-repair-memory-");
    process.env.HOME = homeDir;

    const projectConfig = makeAppConfig();
    await writeCamConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const store = new MemoryStore(detectProjectContext(projectDir), {
      ...projectConfig,
      autoMemoryDirectory: memoryRoot
    });
    await store.ensureLayout();
    await store.remember(
      "project",
      "workflow",
      "prefer-pnpm",
      "Prefer pnpm in this repository.",
      ["Use pnpm instead of npm in this repository."],
      "Manual note."
    );

    const topicPath = store.getTopicFile("project", "workflow");
    const staleAt = new Date(Date.now() + 60_000);
    await fs.utimes(topicPath, staleAt, staleAt);

    const result = runCli(projectDir, ["mcp", "doctor", "--host", "codex", "--json"], {
      env: { HOME: homeDir }
    });
    expect(result.exitCode, result.stderr).toBe(0);

    expect(JSON.parse(result.stdout)).toMatchObject({
      retrievalSidecar: {
        status: "warning",
        repairCommand: "cam memory reindex --scope project --state active",
        checks: expect.arrayContaining([
          expect.objectContaining({
            scope: "project",
            state: "active",
            status: "stale"
          })
        ])
      }
    });
  });

  it("surfaces explicit experimental Codex hooks guidance in print-config and doctor output", async () => {
    const homeDir = await tempDir("cam-mcp-experimental-hooks-home-");
    const projectDir = await tempDir("cam-mcp-experimental-hooks-project-");
    process.env.HOME = homeDir;

    const printConfig = runCli(projectDir, ["mcp", "print-config", "--host", "codex", "--json"], {
      env: { HOME: homeDir }
    });
    const doctor = runCli(projectDir, ["mcp", "doctor", "--host", "codex", "--json"], {
      env: { HOME: homeDir }
    });

    expect(printConfig.exitCode, printConfig.stderr).toBe(0);
    expect(doctor.exitCode, doctor.stderr).toBe(0);

    expect(JSON.parse(printConfig.stdout)).toMatchObject({
      experimentalHooks: {
        status: "experimental",
        featureFlag: "codex_hooks",
        targetFileHint: ".codex/config.toml",
        snippetFormat: "toml",
        snippet: "codex_hooks = true",
        notes: expect.arrayContaining([
          expect.stringContaining("Experimental"),
          expect.stringContaining("Under development"),
          expect.stringContaining("inside an existing [features] table")
        ])
      }
    });
    expect(JSON.parse(doctor.stdout)).toMatchObject({
      experimentalHooks: {
        status: "experimental",
        featureFlag: "codex_hooks",
        targetFileHint: ".codex/config.toml"
      }
    });
  });

  it("keeps workflowContract core fields identical across print-config, mcp doctor, and integrations doctor", async () => {
    const homeDir = await tempDir("cam-workflow-parity-home-");
    const projectDir = await tempDir("cam-workflow-parity-project-");
    const shellDir = await tempDir("cam-workflow-parity-shell-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    const printConfig = runCli(
      shellDir,
      ["mcp", "print-config", "--host", "codex", "--cwd", projectDir, "--json"],
      { env: { HOME: homeDir } }
    );
    const mcpDoctor = runCli(
      shellDir,
      ["mcp", "doctor", "--host", "codex", "--cwd", projectDir, "--json"],
      { env: { HOME: homeDir } }
    );
    const integrationsDoctor = runCli(
      shellDir,
      ["integrations", "doctor", "--host", "codex", "--cwd", projectDir, "--json"],
      { env: { HOME: homeDir } }
    );
    const hooksInstall = runCli(
      shellDir,
      ["hooks", "install", "--cwd", projectDir, "--json"],
      { env: { HOME: homeDir } }
    );
    const skillsInstall = runCli(
      shellDir,
      ["skills", "install", "--cwd", projectDir, "--json"],
      { env: { HOME: homeDir } }
    );

    expect(printConfig.exitCode, printConfig.stderr).toBe(0);
    expect(mcpDoctor.exitCode, mcpDoctor.stderr).toBe(0);
    expect(integrationsDoctor.exitCode, integrationsDoctor.stderr).toBe(0);
    expect(hooksInstall.exitCode, hooksInstall.stderr).toBe(0);
    expect(skillsInstall.exitCode, skillsInstall.stderr).toBe(0);

    const printWorkflow = JSON.parse(printConfig.stdout).workflowContract;
    const mcpWorkflow = JSON.parse(mcpDoctor.stdout).workflowContract;
    const integrationsWorkflow = JSON.parse(integrationsDoctor.stdout).workflowContract;
    const hooksWorkflow = JSON.parse(hooksInstall.stdout).workflowContract;
    const skillsWorkflow = JSON.parse(skillsInstall.stdout).workflowContract;
    const expectedCore = {
      recommendedPreset: "state=auto, limit=8",
      preferredRoute: "mcp-first",
      launcher: {
        commandName: "cam",
        requiresPathResolution: true,
        hookHelpersShellOnly: true
      },
      routePreference: {
        preferredRoute: "mcp-first"
      },
      recallWorkflow: {
        progressiveDisclosure: "Use progressive disclosure: search -> timeline -> details."
      },
      cliFallback: {
        searchCommand: `cam recall search "<query>" --state auto --limit 8 --cwd ${shellQuoteArg(realProjectDir)}`,
        timelineCommand: `cam recall timeline "<ref>" --cwd ${shellQuoteArg(realProjectDir)}`,
        detailsCommand: `cam recall details "<ref>" --cwd ${shellQuoteArg(realProjectDir)}`,
        requiresCamOnPath: true
      },
      postWorkSyncReview: {
        helperScript: "post-work-memory-review.sh",
        syncCommand: `cam sync --cwd ${shellQuoteArg(realProjectDir)}`,
        reviewCommand: `cam memory --recent --cwd ${shellQuoteArg(realProjectDir)}`,
        shellOnly: true,
        requiresCamOnPath: true
      }
    };

    expect(printWorkflow).toMatchObject(expectedCore);
    expect(mcpWorkflow).toMatchObject(expectedCore);
    expect(integrationsWorkflow).toMatchObject(expectedCore);
    expect(hooksWorkflow).toMatchObject(expectedCore);
    expect(skillsWorkflow).toMatchObject(expectedCore);
  });

  it("reports an operational MCP route once cam is available on PATH", async () => {
    const homeDir = await tempDir("cam-mcp-doctor-command-ready-home-");
    const projectDir = await tempDir("cam-mcp-doctor-command-ready-project-");
    const binDir = await tempDir("cam-mcp-doctor-command-ready-bin-");
    process.env.HOME = homeDir;

    await writeCamShim(binDir);

    const env = {
      HOME: homeDir,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`
    };

    const installResult = runCli(projectDir, ["mcp", "install", "--host", "codex", "--json"], {
      env
    });
    expect(installResult.exitCode, installResult.stderr).toBe(0);

    const doctorResult = runCli(projectDir, ["mcp", "doctor", "--host", "codex", "--json"], {
      env
    });
    expect(doctorResult.exitCode, doctorResult.stderr).toBe(0);

    const payload = JSON.parse(doctorResult.stdout) as {
      codexStack: {
        recommendedRoute: string;
        mcpReady: boolean;
        mcpOperationalReady: boolean;
        camCommandAvailable: boolean;
      };
    };

    expect(payload.codexStack).toMatchObject({
      recommendedRoute: "mcp",
      mcpReady: true,
      mcpOperationalReady: true,
      camCommandAvailable: true
    });
  });

  it("does not treat stray config tokens as valid codex wiring", async () => {
    const homeDir = await tempDir("cam-mcp-doctor-false-positive-home-");
    const projectDir = await tempDir("cam-mcp-doctor-false-positive-project-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    await fs.mkdir(path.join(realProjectDir, ".codex"), { recursive: true });
    await fs.writeFile(
      path.join(realProjectDir, ".codex", "config.toml"),
      [
        `note = ${JSON.stringify(`codex_auto_memory cam mcp serve ${realProjectDir}`)}`,
        "",
        "[mcp_servers.other_server]",
        'command = "other"',
        'args = ["serve"]'
      ].join("\n"),
      "utf8"
    );

    const result = runCli(projectDir, ["mcp", "doctor", "--host", "codex", "--json"], {
      env: { HOME: homeDir }
    });
    expect(result.exitCode, result.stderr).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      hosts: Array<{
        host: string;
        status: string;
        configCheck?: {
          exists: boolean;
          hasServerName: boolean;
          hasCamCommand: boolean;
          hasServeInvocation: boolean;
          projectPinned: boolean;
        };
      }>;
    };
    expect(payload.hosts).toEqual([
      expect.objectContaining({
        host: "codex",
        status: "warning",
        configCheck: expect.objectContaining({
          exists: true,
          hasServerName: false,
          hasCamCommand: false,
          hasServeInvocation: false,
          projectPinned: false
        })
      })
    ]);
  });

  it("reports warning when host config exists but cannot be parsed structurally", async () => {
    const homeDir = await tempDir("cam-mcp-doctor-parse-home-");
    const projectDir = await tempDir("cam-mcp-doctor-parse-project-");
    process.env.HOME = homeDir;

    await fs.writeFile(path.join(projectDir, ".mcp.json"), "{ this is not valid json", "utf8");

    const result = runCli(projectDir, ["mcp", "doctor", "--host", "claude", "--json"], {
      env: { HOME: homeDir }
    });
    expect(result.exitCode, result.stderr).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      hosts: Array<{
        host: string;
        status: string;
        configCheck?: {
          exists: boolean;
          hasServerName: boolean;
          hasCamCommand: boolean;
          hasServeInvocation: boolean;
          projectPinned: boolean;
        };
      }>;
    };
    expect(payload.hosts).toEqual([
      expect.objectContaining({
        host: "claude",
        status: "warning",
        configCheck: expect.objectContaining({
          exists: true,
          hasServerName: false,
          hasCamCommand: false,
          hasServeInvocation: false,
          projectPinned: false
        })
      })
    ]);
  });

  it("rejects unsupported MCP hosts", async () => {
    const homeDir = await tempDir("cam-mcp-invalid-home-");
    const projectDir = await tempDir("cam-mcp-invalid-project-");
    process.env.HOME = homeDir;

    const result = runCli(projectDir, ["mcp", "print-config", "--host", "cursor"], {
      env: { HOME: homeDir }
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unsupported MCP host "cursor"');
  });

  it("rejects generic host installs because generic wiring remains manual-only", async () => {
    const homeDir = await tempDir("cam-mcp-install-generic-home-");
    const projectDir = await tempDir("cam-mcp-install-generic-project-");
    process.env.HOME = homeDir;

    const result = runCli(projectDir, ["mcp", "install", "--host", "generic"], {
      env: { HOME: homeDir }
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("generic");
    expect(result.stderr).toContain("manual-only");
  });

  it("serves read-only retrieval MCP tools over stdio", async () => {
    const homeDir = await tempDir("cam-mcp-home-");
    const projectDir = await tempDir("cam-mcp-project-");
    const memoryRoot = await tempDir("cam-mcp-memory-");
    process.env.HOME = homeDir;

    const projectConfig = makeAppConfig();
    await writeCamConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const store = new MemoryStore(detectProjectContext(projectDir), {
      ...projectConfig,
      autoMemoryDirectory: memoryRoot
    });
    await store.ensureLayout();
    await store.remember(
      "project",
      "workflow",
      "prefer-pnpm",
      "Prefer pnpm in this repository.",
      ["Use pnpm instead of npm in this repository."],
      "Manual note."
    );
    await store.forget("project", "pnpm", { archive: true });

    const client = await connectCliMcpClient(projectDir, {
      env: { HOME: homeDir }
    });

    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        "get_memory_details",
        "search_memories",
        "timeline_memories"
      ]);

      const searchResult = await client.callTool({
        name: "search_memories",
        arguments: {
          query: "pnpm",
          state: "archived",
          limit: 5
        }
      });
      const searchPayload = readStructuredContent<SearchMemoriesResponse>(
        searchResult as ToolCallResultLike
      );

      expect(searchPayload).toMatchObject({
        query: "pnpm",
        state: "archived",
        resolvedState: "archived",
        fallbackUsed: false,
        stateFallbackUsed: false,
        markdownFallbackUsed: false,
        retrievalMode: "index"
      });
      expect(searchPayload.results).toHaveLength(1);
      expect(searchPayload.results[0]).toMatchObject({
        ref: "project:archived:workflow:prefer-pnpm",
        state: "archived",
        summary: "Prefer pnpm in this repository."
      });
      expect(searchPayload.results[0]?.matchedFields).toEqual(
        expect.arrayContaining(["summary", "details"])
      );
      expect(JSON.stringify(searchPayload)).not.toContain("Use pnpm instead of npm in this repository.");

      const ref = searchPayload.results[0]!.ref;
      const timelineResult = await client.callTool({
        name: "timeline_memories",
        arguments: { ref }
      });
      const timelinePayload = readStructuredContent<TimelineMemoriesResponse>(
        timelineResult as ToolCallResultLike
      );
      expect(timelinePayload.ref).toBe(ref);
      expect(timelinePayload.warnings).toEqual([]);
      expect(timelinePayload.lineageSummary).toMatchObject({
        eventCount: 2,
        latestAction: "archive",
        latestState: "archived",
        latestAuditStatus: null,
        noopOperationCount: 0,
        suppressedOperationCount: 0,
        conflictCount: 0
      });
      expect(timelinePayload.events.slice(0, 2)).toEqual([
        expect.objectContaining({ action: "archive", state: "archived" }),
        expect.objectContaining({ action: "add", state: "active" })
      ]);

      const detailsResult = await client.callTool({
        name: "get_memory_details",
        arguments: { ref }
      });
      const detailsPayload = readStructuredContent<MemoryDetailsResponse>(
        detailsResult as ToolCallResultLike
      );
      expect(detailsPayload).toMatchObject({
        ref,
        path: store.getArchiveTopicFile("project", "workflow"),
        latestLifecycleAction: "archive",
        latestState: "archived",
        latestSessionId: null,
        latestRolloutPath: null,
        historyPath: store.getHistoryPath("project"),
        timelineWarningCount: 0,
        lineageSummary: {
          eventCount: 2,
          latestAction: "archive",
          latestState: "archived",
          latestAuditStatus: null,
          noopOperationCount: 0,
          suppressedOperationCount: 0,
          conflictCount: 0
        },
        warnings: [],
        entry: {
          summary: "Prefer pnpm in this repository.",
          details: ["Use pnpm instead of npm in this repository."]
        }
      });

      const missingResult = await client.callTool({
          name: "get_memory_details",
          arguments: { ref: "project:active:workflow:missing-entry" }
        });
      expect("isError" in missingResult && missingResult.isError).toBe(true);
      expect(JSON.stringify(missingResult)).toContain("No memory details were found");

      const invalidTimelineResult = await client.callTool({
        name: "timeline_memories",
        arguments: { ref: "not-a-valid-ref" }
      });
      expect("isError" in invalidTimelineResult && invalidTimelineResult.isError).toBe(true);
      expect(JSON.stringify(invalidTimelineResult)).toContain("Invalid memory ref");
    } finally {
      await client.close();
    }
  }, 30_000);

  it("anchors retrieval MCP to an explicit cwd when requested", async () => {
    const homeDir = await tempDir("cam-mcp-cwd-home-");
    const projectDir = await tempDir("cam-mcp-cwd-project-");
    const callerDir = await tempDir("cam-mcp-cwd-caller-");
    const memoryRoot = await tempDir("cam-mcp-cwd-memory-");
    process.env.HOME = homeDir;

    const projectConfig = makeAppConfig();
    await writeCamConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const store = new MemoryStore(detectProjectContext(projectDir), {
      ...projectConfig,
      autoMemoryDirectory: memoryRoot
    });
    await store.ensureLayout();
    await store.remember(
      "project",
      "workflow",
      "prefer-pnpm",
      "Prefer pnpm in this repository.",
      ["Use pnpm instead of npm in this repository."],
      "Manual note."
    );

    const client = await connectCliMcpClient(callerDir, {
      env: { HOME: homeDir },
      serverCwd: projectDir
    });

    try {
      const result = await client.callTool({
        name: "search_memories",
        arguments: { query: "pnpm", limit: 3 }
      });
      const payload = readStructuredContent<SearchMemoriesResponse>(result as ToolCallResultLike);
      expect(payload.results).toEqual([
        expect.objectContaining({
          ref: "project:active:workflow:prefer-pnpm",
          summary: "Prefer pnpm in this repository."
        })
      ]);
    } finally {
      await client.close();
    }
  }, 30_000);

  it("supports auto search state by preferring active results before archived fallback", async () => {
    const homeDir = await tempDir("cam-mcp-auto-home-");
    const projectDir = await tempDir("cam-mcp-auto-project-");
    const memoryRoot = await tempDir("cam-mcp-auto-memory-");
    process.env.HOME = homeDir;

    const projectConfig = makeAppConfig();
    await writeCamConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const store = new MemoryStore(detectProjectContext(projectDir), {
      ...projectConfig,
      autoMemoryDirectory: memoryRoot
    });
    await store.ensureLayout();
    await store.remember(
      "project",
      "workflow",
      "prefer-pnpm",
      "Prefer pnpm in this repository.",
      ["Use pnpm instead of npm in this repository."],
      "Manual note."
    );
    await store.remember(
      "project",
      "workflow",
      "historical-pnpm",
      "Historical pnpm migration note.",
      ["Old pnpm migration note kept for history."],
      "Manual note."
    );
    await store.forget("project", "historical pnpm", { archive: true });

    const client = await connectCliMcpClient(projectDir, {
      env: { HOME: homeDir }
    });

    try {
      const preferredResult = await client.callTool({
        name: "search_memories",
        arguments: {
          query: "pnpm",
          state: "auto",
          limit: 5
        }
      });
      const preferredPayload = readStructuredContent<SearchMemoriesResponse>(
        preferredResult as ToolCallResultLike
      );
      expect(preferredPayload).toMatchObject({
        query: "pnpm",
        state: "auto",
        resolvedState: "active",
        fallbackUsed: false,
        retrievalMode: "index",
        stateResolution: {
          outcome: "active-hit",
          searchedStates: ["active"],
          resolutionReason: "active-match-found"
        },
        executionSummary: {
          mode: "index-only",
          retrievalModes: ["index"],
          fallbackReasons: []
        }
      });
      expect(preferredPayload.results).toEqual([
        expect.objectContaining({
          ref: "project:active:workflow:prefer-pnpm",
          state: "active",
          summary: "Prefer pnpm in this repository."
        })
      ]);

      const fallbackResult = await client.callTool({
        name: "search_memories",
        arguments: {
          query: "historical",
          state: "auto",
          limit: 5
        }
      });
      const fallbackPayload = readStructuredContent<SearchMemoriesResponse>(
        fallbackResult as ToolCallResultLike
      );
      expect(fallbackPayload).toMatchObject({
        query: "historical",
        state: "auto",
        resolvedState: "archived",
        fallbackUsed: true,
        retrievalMode: "index",
        stateResolution: {
          outcome: "archived-hit",
          searchedStates: ["active", "archived"],
          resolutionReason: "active-empty-archived-match-found"
        },
        executionSummary: {
          mode: "index-only",
          retrievalModes: ["index"],
          fallbackReasons: []
        }
      });
      expect(fallbackPayload.results).toEqual([
        expect.objectContaining({
          ref: "project:archived:workflow:historical-pnpm",
          state: "archived",
          summary: "Historical pnpm migration note."
        })
      ]);
    } finally {
      await client.close();
    }
  }, 30_000);

  it("uses the recommended search preset by default when MCP search omits state and limit", async () => {
    const homeDir = await tempDir("cam-mcp-default-preset-home-");
    const projectDir = await tempDir("cam-mcp-default-preset-project-");
    const memoryRoot = await tempDir("cam-mcp-default-preset-memory-");
    process.env.HOME = homeDir;

    const projectConfig = makeAppConfig();
    await writeCamConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const store = new MemoryStore(detectProjectContext(projectDir), {
      ...projectConfig,
      autoMemoryDirectory: memoryRoot
    });
    await store.ensureLayout();
    for (let index = 1; index <= 9; index += 1) {
      await store.remember(
        "project",
        "workflow",
        `historical-pnpm-${index}`,
        `Historical pnpm migration note ${index}.`,
        [`Historical archive note ${index}.`],
        "Manual note."
      );
    }
    await store.forget("project", "Historical pnpm migration note", { archive: true });

    const client = await connectCliMcpClient(projectDir, {
      env: { HOME: homeDir }
    });

    try {
      const result = await client.callTool({
        name: "search_memories",
        arguments: {
          query: "historical"
        }
      });
      const payload = readStructuredContent<SearchMemoriesResponse>(result as ToolCallResultLike);

      expect(payload).toMatchObject({
        query: "historical",
        state: "auto",
        resolvedState: "archived",
        fallbackUsed: true,
        stateFallbackUsed: true,
        markdownFallbackUsed: false,
        retrievalMode: "index",
        stateResolution: {
          outcome: "archived-hit",
          searchedStates: ["active", "archived"],
          resolutionReason: "active-empty-archived-match-found"
        },
        executionSummary: {
          mode: "index-only",
          retrievalModes: ["index"],
          fallbackReasons: []
        }
      });
      expect(payload.results).toHaveLength(8);
      expect(payload.results.every((entry) => entry.state === "archived")).toBe(true);
    } finally {
      await client.close();
    }
  }, 30_000);

  it("surfaces explicit-state contract for state=all MCP searches and keeps checkedPaths ordered", async () => {
    const homeDir = await tempDir("cam-mcp-state-all-home-");
    const projectDir = await tempDir("cam-mcp-state-all-project-");
    const memoryRoot = await tempDir("cam-mcp-state-all-memory-");
    process.env.HOME = homeDir;

    const projectConfig = makeAppConfig();
    await writeCamConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const store = new MemoryStore(detectProjectContext(projectDir), {
      ...projectConfig,
      autoMemoryDirectory: memoryRoot
    });
    await store.ensureLayout();
    await store.remember(
      "project",
      "workflow",
      "prefer-pnpm-active",
      "Active pnpm workflow note.",
      ["Use pnpm in this repository now."],
      "Manual note."
    );
    await store.remember(
      "project",
      "workflow",
      "prefer-pnpm-archived",
      "Archived pnpm migration note.",
      ["Historical pnpm migration note."],
      "Manual note."
    );
    await store.forget("project", "Archived pnpm migration note", { archive: true });

    const client = await connectCliMcpClient(projectDir, {
      env: { HOME: homeDir }
    });

    try {
      const result = await client.callTool({
        name: "search_memories",
        arguments: {
          query: "pnpm",
          state: "all",
          limit: 1
        }
      });
      const payload = readStructuredContent<SearchMemoriesResponse>(result as ToolCallResultLike);
      expect(payload.state).toBe("all");
      expect(payload.resolvedState).toBe("all");
      expect(payload.searchOrder).toEqual([
        "global:active",
        "global:archived",
        "project:active",
        "project:archived",
        "project-local:active",
        "project-local:archived"
      ]);
      expect(payload.globalLimitApplied).toBe(true);
      expect(payload.truncatedCount).toBe(1);
      expect(payload.stateResolution).toMatchObject({
        outcome: "explicit-state",
        searchedStates: ["active", "archived"],
        resolutionReason: "explicit-all-state-requested"
      });
      expect(payload.executionSummary).toMatchObject({
        mode: "index-only",
        retrievalModes: ["index"],
        fallbackReasons: []
      });
      expect(payload.results).toHaveLength(1);
      const returnedState = payload.results[0]?.state;
      expect(returnedState === "active" || returnedState === "archived").toBe(true);
      const projectChecks =
        payload.diagnostics?.checkedPaths.filter((check) => check.scope === "project") ?? [];
      expect(projectChecks).toMatchObject([
        {
          scope: "project",
          state: "active",
          retrievalMode: "index",
          matchedCount: 1
        },
        {
          scope: "project",
          state: "archived",
          retrievalMode: "index",
          matchedCount: 1
        }
      ]);
      const activeCheck = projectChecks.find((check) => check.state === "active");
      const archivedCheck = projectChecks.find((check) => check.state === "archived");
      expect((activeCheck?.returnedCount ?? 0) + (archivedCheck?.returnedCount ?? 0)).toBe(1);
      expect(
        returnedState === "active" ? activeCheck?.returnedCount : archivedCheck?.returnedCount
      ).toBe(1);
      expect(
        returnedState === "active" ? activeCheck?.droppedCount : archivedCheck?.droppedCount
      ).toBe(0);
      expect(
        returnedState === "active" ? archivedCheck?.droppedCount : activeCheck?.droppedCount
      ).toBe(1);
    } finally {
      await client.close();
    }
  }, 30_000);

  it("keeps CLI and MCP retrieval aligned when both use the recommended explicit search preset", async () => {
    const homeDir = await tempDir("cam-mcp-cli-parity-home-");
    const projectDir = await tempDir("cam-mcp-cli-parity-project-");
    const memoryRoot = await tempDir("cam-mcp-cli-parity-memory-");
    process.env.HOME = homeDir;

    const projectConfig = makeAppConfig();
    await writeCamConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const store = new MemoryStore(detectProjectContext(projectDir), {
      ...projectConfig,
      autoMemoryDirectory: memoryRoot
    });
    await store.ensureLayout();
    await store.remember(
      "project",
      "workflow",
      "historical-pnpm-one",
      "Historical pnpm migration note one.",
      ["Old pnpm migration note one kept for history."],
      "Manual note."
    );
    await store.remember(
      "project",
      "workflow",
      "historical-pnpm-two",
      "Historical pnpm migration note two.",
      ["Old pnpm migration note two kept for history."],
      "Manual note."
    );
    await store.forget("project", "historical pnpm", { archive: true });

    const cliResult = runCli(
      projectDir,
      ["recall", "search", "historical", "--state", "auto", "--limit", "8", "--json"],
      {
        env: { HOME: homeDir }
      }
    );
    expect(cliResult.exitCode, cliResult.stderr).toBe(0);
    const cliPayload = JSON.parse(cliResult.stdout) as SearchMemoriesResponse;

    const client = await connectCliMcpClient(projectDir, {
      env: { HOME: homeDir }
    });

    try {
      const mcpResult = await client.callTool({
        name: "search_memories",
        arguments: {
          query: "historical",
          state: "auto",
          limit: 8
        }
      });
      const mcpPayload = readStructuredContent<SearchMemoriesResponse>(mcpResult as ToolCallResultLike);

      expect(mcpPayload.query).toBe(cliPayload.query);
      expect(mcpPayload.state).toBe(cliPayload.state);
      expect(mcpPayload.resolvedState).toBe(cliPayload.resolvedState);
      expect(mcpPayload.fallbackUsed).toBe(cliPayload.fallbackUsed);
      expect(mcpPayload.results.map((result) => result.ref)).toEqual(
        cliPayload.results.map((result) => result.ref)
      );
    } finally {
      await client.close();
    }
  }, 30_000);

  it("keeps retrieval MCP read-only and does not create memory layout on first lookup", async () => {
    const homeDir = await tempDir("cam-mcp-readonly-home-");
    const projectDir = await tempDir("cam-mcp-readonly-project-");
    const memoryRootParent = await tempDir("cam-mcp-readonly-memory-parent-");
    const memoryRoot = path.join(memoryRootParent, "memory-root");
    process.env.HOME = homeDir;

    await writeCamConfig(projectDir, makeAppConfig(), {
      autoMemoryDirectory: memoryRoot
    });

    const client = await connectCliMcpClient(projectDir, {
      env: { HOME: homeDir }
    });

    try {
      const result = await client.callTool({
        name: "search_memories",
        arguments: { query: "pnpm", limit: 3 }
      });
      const payload = readStructuredContent<SearchMemoriesResponse>(result as ToolCallResultLike);
      expect(payload).toMatchObject({
        fallbackUsed: true,
        stateFallbackUsed: true,
        markdownFallbackUsed: true,
        retrievalMode: "markdown-fallback",
        retrievalFallbackReason: "missing",
        stateResolution: {
          outcome: "miss-after-both",
          searchedStates: ["active", "archived"],
          resolutionReason: "no-match-after-auto-search"
        },
        executionSummary: {
          mode: "markdown-fallback-only",
          retrievalModes: ["markdown-fallback"],
          fallbackReasons: ["missing"]
        },
        diagnostics: {
          anyMarkdownFallback: true,
          fallbackReasons: ["missing"],
          executionModes: ["markdown-fallback"],
          checkedPaths: expect.arrayContaining([
            expect.objectContaining({
              scope: "project",
              state: "active",
              retrievalMode: "markdown-fallback",
              retrievalFallbackReason: "missing",
              matchedCount: 0,
              returnedCount: 0
            })
          ])
        },
        results: []
      });
    } finally {
      await client.close();
    }

    expect(await pathExists(memoryRoot)).toBe(false);
  }, 30_000);

  it("keeps mcp install read-only with respect to memory layout", async () => {
    const homeDir = await tempDir("cam-mcp-install-readonly-home-");
    const projectDir = await tempDir("cam-mcp-install-readonly-project-");
    const memoryRootParent = await tempDir("cam-mcp-install-readonly-memory-parent-");
    const memoryRoot = path.join(memoryRootParent, "memory-root");
    process.env.HOME = homeDir;

    await writeCamConfig(projectDir, makeAppConfig(), {
      autoMemoryDirectory: memoryRoot
    });

    const result = runCli(projectDir, ["mcp", "install", "--host", "codex", "--json"], {
      env: { HOME: homeDir }
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      host: "codex",
      action: "created",
      readOnlyRetrieval: true
    });
    expect(await pathExists(memoryRoot)).toBe(false);
  });

  it("surfaces markdown fallback diagnostics for invalid retrieval sidecars over MCP", async () => {
    const homeDir = await tempDir("cam-mcp-invalid-sidecar-home-");
    const projectDir = await tempDir("cam-mcp-invalid-sidecar-project-");
    const memoryRoot = await tempDir("cam-mcp-invalid-sidecar-memory-");
    process.env.HOME = homeDir;

    const projectConfig = makeAppConfig();
    await writeCamConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const store = new MemoryStore(detectProjectContext(projectDir), {
      ...projectConfig,
      autoMemoryDirectory: memoryRoot
    });
    await store.ensureLayout();
    await store.remember(
      "project",
      "workflow",
      "prefer-pnpm",
      "Prefer pnpm in this repository.",
      ["Use pnpm instead of npm in this repository."],
      "Manual note."
    );
    await fs.writeFile(store.getRetrievalIndexFile("project", "active"), "{not-json", "utf8");

    const client = await connectCliMcpClient(projectDir, {
      env: { HOME: homeDir }
    });

    try {
      const result = await client.callTool({
        name: "search_memories",
        arguments: {
          query: "prefer pnpm",
          state: "active",
          limit: 5
        }
      });
      const payload = readStructuredContent<SearchMemoriesResponse>(result as ToolCallResultLike);
      expect(payload).toMatchObject({
        retrievalMode: "markdown-fallback",
        retrievalFallbackReason: "invalid",
        executionSummary: {
          mode: "mixed",
          retrievalModes: ["index", "markdown-fallback"],
          fallbackReasons: ["invalid"]
        },
        diagnostics: {
          executionModes: ["index", "markdown-fallback"],
          checkedPaths: expect.arrayContaining([
            expect.objectContaining({
              scope: "project",
              state: "active",
              retrievalMode: "markdown-fallback",
              retrievalFallbackReason: "invalid",
              matchedCount: 1,
              returnedCount: 1,
              indexPath: store.getRetrievalIndexFile("project", "active"),
              generatedAt: null
            })
          ])
        },
        results: [expect.objectContaining({ ref: "project:active:workflow:prefer-pnpm" })]
      });
    } finally {
      await client.close();
    }
  }, 30_000);

  it("surfaces mixed execution summary over MCP when auto search combines markdown fallback and archived index hits", async () => {
    const homeDir = await tempDir("cam-mcp-mixed-execution-home-");
    const projectDir = await tempDir("cam-mcp-mixed-execution-project-");
    const memoryRoot = await tempDir("cam-mcp-mixed-execution-memory-");
    process.env.HOME = homeDir;

    const projectConfig = makeAppConfig();
    await writeCamConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const store = new MemoryStore(detectProjectContext(projectDir), {
      ...projectConfig,
      autoMemoryDirectory: memoryRoot
    });
    await store.ensureLayout();
    await store.remember(
      "project",
      "workflow",
      "historical-pnpm",
      "Historical pnpm migration note.",
      ["Old pnpm migration note kept for history."],
      "Manual note."
    );
    await store.forget("project", "historical pnpm", { archive: true });
    await fs.writeFile(store.getRetrievalIndexFile("project", "active"), "{not-json", "utf8");

    const client = await connectCliMcpClient(projectDir, {
      env: { HOME: homeDir }
    });

    try {
      const result = await client.callTool({
        name: "search_memories",
        arguments: {
          query: "historical",
          state: "auto",
          limit: 5
        }
      });
      const payload = readStructuredContent<SearchMemoriesResponse>(result as ToolCallResultLike);
      expect(payload).toMatchObject({
        resolvedState: "archived",
        retrievalMode: "index",
        markdownFallbackUsed: true,
        stateResolution: {
          outcome: "archived-hit",
          searchedStates: ["active", "archived"],
          resolutionReason: "active-empty-archived-match-found"
        },
        executionSummary: {
          mode: "mixed",
          retrievalModes: ["index", "markdown-fallback"],
          fallbackReasons: ["invalid"]
        },
        diagnostics: {
          anyMarkdownFallback: true,
          fallbackReasons: ["invalid"],
          executionModes: ["index", "markdown-fallback"],
          checkedPaths: expect.arrayContaining([
            expect.objectContaining({
              scope: "project",
              state: "active",
              retrievalMode: "markdown-fallback",
              retrievalFallbackReason: "invalid",
              matchedCount: 0,
              returnedCount: 0
            }),
            expect.objectContaining({
              scope: "project",
              state: "archived",
              retrievalMode: "index",
              matchedCount: 1,
              returnedCount: 1
            })
          ])
        }
      });
    } finally {
      await client.close();
    }
  }, 30_000);

  it("surfaces latest sync audit provenance through MCP memory details", async () => {
    const homeDir = await tempDir("cam-mcp-details-audit-home-");
    const projectDir = await tempDir("cam-mcp-details-audit-project-");
    const memoryRoot = await tempDir("cam-mcp-details-audit-memory-");
    const rolloutPath = path.join(projectDir, "rollout.jsonl");
    process.env.HOME = homeDir;

    const projectConfig = makeAppConfig();
    await writeCamConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });
    await fs.writeFile(
      rolloutPath,
      makeRolloutFixture(projectDir, "Remember that this repository prefers pnpm.", {
        sessionId: "session-mcp-audit"
      }),
      "utf8"
    );

    const service = new SyncService(detectProjectContext(projectDir), {
      ...projectConfig,
      autoMemoryDirectory: memoryRoot
    });
    await service.syncRollout(rolloutPath, true);

    const client = await connectCliMcpClient(projectDir, {
      env: { HOME: homeDir }
    });

    try {
      const searchResult = await client.callTool({
        name: "search_memories",
        arguments: {
          query: "prefers pnpm",
          limit: 5
        }
      });
      const searchPayload = readStructuredContent<SearchMemoriesResponse>(
        searchResult as ToolCallResultLike
      );
      const ref = searchPayload.results[0]?.ref;
      expect(ref).toBeTruthy();

      const detailsResult = await client.callTool({
        name: "get_memory_details",
        arguments: {
          ref
        }
      });
      const detailsPayload = readStructuredContent<MemoryDetailsResponse>(
        detailsResult as ToolCallResultLike
      );
      expect(detailsPayload).toMatchObject({
        latestState: "active",
        latestSessionId: "session-mcp-audit",
        latestRolloutPath: rolloutPath,
        timelineWarningCount: 0,
        lineageSummary: expect.objectContaining({
          eventCount: 1,
          latestAction: "add",
          latestState: "active",
          latestAuditStatus: "applied"
        }),
        warnings: [],
        latestAudit: {
          auditPath: service.memoryStore.getSyncAuditPath(),
          rolloutPath,
          sessionId: "session-mcp-audit",
          status: "applied",
          resultSummary: expect.stringContaining("operation(s) applied"),
          noopOperationCount: 0,
          suppressedOperationCount: 0
        }
      });
    } finally {
      await client.close();
    }
  }, 30_000);
});
