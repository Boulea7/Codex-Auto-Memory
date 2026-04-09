import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseRolloutEvidence } from "../src/lib/domain/rollout.js";
import { CodexExtractor } from "../src/lib/extractor/codex-extractor.js";
import { reviewExtractedMemoryOperations } from "../src/lib/extractor/contradiction-review.js";
import { HeuristicExtractor } from "../src/lib/extractor/heuristic-extractor.js";
import {
  filterMemoryOperations,
  filterMemoryOperationsWithDiagnostics
} from "../src/lib/extractor/safety.js";
import type { MemoryEntry, RolloutEvidence } from "../src/lib/types.js";

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function baseEvidence(partial: Partial<RolloutEvidence> = {}): RolloutEvidence {
  return {
    sessionId: "session-1",
    createdAt: "2026-03-14T00:00:00.000Z",
    cwd: process.cwd(),
    userMessages: [],
    agentMessages: [],
    toolCalls: [],
    rolloutPath: "/tmp/rollout.jsonl",
    ...partial
  };
}

describe("HeuristicExtractor", () => {
  it("creates upserts for explicit corrections and deletes overlapping stale entries", async () => {
    const extractor = new HeuristicExtractor();
    const existingEntries: MemoryEntry[] = [
      {
        id: "use-npm",
        scope: "project",
        topic: "preferences",
        summary: "Use npm in this repository.",
        details: ["Use npm instead of pnpm in this repo."],
        updatedAt: "2026-03-14T00:00:00.000Z",
        sources: ["old"]
      },
      {
        id: "redis-workaround",
        scope: "project",
        topic: "debugging",
        summary: "API tests require a local Redis instance.",
        details: ["Start Redis before integration tests."],
        updatedAt: "2026-03-14T00:00:00.000Z",
        sources: ["old"]
      }
    ];

    const operations = await extractor.extract(
      baseEvidence({
        userMessages: [
          "remember that we use pnpm, not npm",
          "forget redis workaround"
        ]
      }),
      existingEntries
    );

    expect(
      operations.some(
        (operation) =>
          operation.action === "delete" &&
          operation.id === "use-npm"
      )
    ).toBe(true);
    expect(
      operations.some(
        (operation) =>
          operation.action === "delete" &&
          operation.id === "redis-workaround"
      )
    ).toBe(true);
    expect(
      operations.some(
        (operation) =>
          operation.action === "upsert" &&
          operation.summary?.includes("we use pnpm, not npm")
      )
    ).toBe(true);
  });

  it("treats direct Chinese corrections with 先别用... as high-confidence replacements", async () => {
    const extractor = new HeuristicExtractor();
    const existingEntries: MemoryEntry[] = [
      {
        id: "use-npm",
        scope: "project",
        topic: "preferences",
        summary: "Use npm in this repository.",
        details: ["Use npm instead of pnpm in this repo."],
        updatedAt: "2026-03-14T00:00:00.000Z",
        sources: ["old"]
      }
    ];

    const operations = await extractor.extract(
      baseEvidence({
        userMessages: ["先别用 npm，用 pnpm。"]
      }),
      existingEntries
    );

    expect(
      operations.some(
        (operation) => operation.action === "delete" && operation.id === "use-npm"
      )
    ).toBe(true);
    expect(
      operations.some(
        (operation) =>
          operation.action === "upsert" &&
          operation.summary?.includes("先别用 npm，用 pnpm")
      )
    ).toBe(true);
  });

  it("does not save commands with no output (output undefined)", async () => {
    const extractor = new HeuristicExtractor();
    const operations = await extractor.extract(
      baseEvidence({
        toolCalls: [
          {
            callId: "call-no-output",
            name: "exec_command",
            arguments: "{\"cmd\":\"pnpm build\"}",
            output: undefined
          }
        ]
      }),
      []
    );
    const upserts = operations.filter((op) => op.action === "upsert");
    expect(upserts.every((op) => !op.summary?.includes("pnpm build"))).toBe(true);
  });

  it("extracts only successful reusable commands and deduplicates them", async () => {
    const extractor = new HeuristicExtractor();
    const operations = await extractor.extract(
      baseEvidence({
        toolCalls: [
          {
            callId: "call-1",
            name: "exec_command",
            arguments: "{\"cmd\":\"pnpm test\"}",
            output: "Process exited with code 0"
          },
          {
            callId: "call-2",
            name: "exec_command",
            arguments: "{\"cmd\":\"pnpm test\"}",
            output: "Process exited with code 0"
          },
          {
            callId: "call-3",
            name: "exec_command",
            arguments: "{\"cmd\":\"npm install\"}",
            output: "Process exited with code 1"
          }
        ]
      }),
      []
    );

    const upserts = operations.filter((operation) => operation.action === "upsert");
    expect(upserts).toHaveLength(1);
    expect(upserts[0]?.summary).toContain("pnpm test");
    expect(upserts[0]?.summary).not.toContain("npm install");
  });

  it("classifies external systems and docs pointers as reference memories", async () => {
    const extractor = new HeuristicExtractor();
    const operations = await extractor.extract(
      baseEvidence({
        userMessages: [
          "remember that pipeline bugs are tracked in Linear project INGEST",
          "remember that the latency dashboard lives at https://grafana.example.com/d/api-latency"
        ]
      }),
      []
    );

    expect(
      operations.filter(
        (operation) => operation.action === "upsert" && operation.topic === "reference"
      )
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          summary: "pipeline bugs are tracked in Linear project INGEST"
        }),
        expect.objectContaining({
          summary:
            "the latency dashboard lives at https://grafana.example.com/d/api-latency"
        })
      ])
    );
  });

  it("extracts stable directive-style memories for reference, architecture, debugging, and patterns", async () => {
    const extractor = new HeuristicExtractor();
    const operations = await extractor.extract(
      baseEvidence({
        userMessages: [
          "The auth runbook lives at https://docs.example.com/auth-runbook.",
          "Keep Markdown-first as the canonical store, not database-first.",
          "Redis must be running before integration tests.",
          "Use search -> timeline -> details for recall.",
          "Use MCP -> local bridge -> resolved CLI for retrieval."
        ]
      }),
      []
    );

    expect(operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "upsert",
          topic: "reference",
          summary: "The auth runbook lives at https://docs.example.com/auth-runbook"
        }),
        expect.objectContaining({
          action: "upsert",
          topic: "architecture",
          summary: "Keep Markdown-first as the canonical store, not database-first"
        }),
        expect.objectContaining({
          action: "upsert",
          topic: "debugging",
          summary: "Redis must be running before integration tests"
        }),
        expect.objectContaining({
          action: "upsert",
          topic: "patterns",
          summary: "Use search -> timeline -> details for recall"
        }),
        expect.objectContaining({
          action: "upsert",
          topic: "patterns",
          summary: "Use MCP -> local bridge -> resolved CLI for retrieval"
        })
      ])
    );
  });

  it("extracts stable directive-style preferences and commands without an explicit remember prefix", async () => {
    const extractor = new HeuristicExtractor();
    const operations = await extractor.extract(
      baseEvidence({
        userMessages: [
          "Use pnpm instead of npm in this repository.",
          "Run `pnpm test` to verify this repository."
        ]
      }),
      []
    );

    expect(operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "upsert",
          topic: "preferences",
          summary: "Use pnpm instead of npm in this repository"
        }),
        expect.objectContaining({
          action: "upsert",
          topic: "commands",
          summary: "Run `pnpm test` to verify this repository"
        })
      ])
    );
  });

  it("treats bash-named tool calls with expanded success output as reusable commands", async () => {
    const extractor = new HeuristicExtractor();
    const operations = await extractor.extract(
      baseEvidence({
        toolCalls: [
          {
            callId: "call-bash-success",
            name: "Bash",
            arguments: "{\"cmd\":\"pnpm lint\"}",
            output: "Tests passed"
          }
        ]
      }),
      []
    );

    const upserts = operations.filter((operation) => operation.action === "upsert");
    expect(upserts).toHaveLength(1);
    expect(upserts[0]?.topic).toBe("commands");
    expect(upserts[0]?.summary).toContain("pnpm lint");
  });

  it("treats wrapped successful verification commands as reusable commands", async () => {
    const extractor = new HeuristicExtractor();
    const operations = await extractor.extract(
      baseEvidence({
        toolCalls: [
          {
            callId: "call-pnpm-exec-vitest",
            name: "exec_command",
            arguments: "{\"cmd\":\"pnpm exec vitest run test/session-command.test.ts\"}",
            output: "Process exited with code 0"
          },
          {
            callId: "call-uv-run-pytest",
            name: "exec_command",
            arguments: "{\"cmd\":\"uv run pytest tests/test_memory.py\"}",
            output: "Process exited with code 0"
          }
        ]
      }),
      []
    );

    expect(operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "upsert",
          topic: "commands",
          summary: "Run `pnpm exec vitest run test/session-command.test.ts` to verify this repository."
        }),
        expect.objectContaining({
          action: "upsert",
          topic: "commands",
          summary: "Run `uv run pytest tests/test_memory.py` to verify this repository."
        })
      ])
    );
  });

  it("extracts stable assistant summaries without pulling in reviewer chatter", async () => {
    const extractor = new HeuristicExtractor();
    const operations = await extractor.extract(
      baseEvidence({
        agentMessages: [
          "Confirmed durable memory stays Markdown-first; retrieval sidecars are rebuildable acceleration only.",
          "I will ask a reviewer subagent to check docs wording before I continue."
        ]
      }),
      []
    );

    expect(operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "upsert",
          topic: "architecture",
          summary:
            "durable memory stays Markdown-first; retrieval sidecars are rebuildable acceleration only"
        })
      ])
    );
    expect(
      operations.some((operation) => /reviewer subagent/i.test(operation.summary ?? ""))
    ).toBe(false);
  });

  it("does not extract hedged stable assistant summaries into durable memory", async () => {
    const extractor = new HeuristicExtractor();
    const operations = await extractor.extract(
      baseEvidence({
        agentMessages: [
          "Confirmed maybe use bun instead of pnpm in this repository for now."
        ]
      }),
      []
    );

    expect(operations).toEqual([]);
  });

  it("adds a newer command memory from a real rollout fixture without deleting a different toolchain command", async () => {
    const extractor = new HeuristicExtractor();
    const evidence = await parseRolloutEvidence(
      path.join(process.cwd(), "test/fixtures/rollouts/memory-correction.jsonl")
    );

    expect(evidence).not.toBeNull();

    const operations = await extractor.extract(evidence!, [
      {
        id: "npm-test",
        scope: "project",
        topic: "commands",
        summary: "Run `npm test` to verify this repository.",
        details: ["Use `npm test` as a repeatable verification command for this project."],
        updatedAt: "2026-03-14T00:00:00.000Z",
        sources: ["old"]
      }
    ]);

    expect(
      operations.some(
        (operation) =>
          operation.action === "delete" &&
          operation.id === "npm-test"
      )
    ).toBe(false);
    expect(
      operations.some(
        (operation) =>
          operation.action === "upsert" &&
          operation.summary?.includes("pnpm test")
      )
    ).toBe(true);
  });

  it("does not treat npm test and pnpm test as the same command signature", async () => {
    const extractor = new HeuristicExtractor();
    const operations = await extractor.extract(
      baseEvidence({
        toolCalls: [
          {
            callId: "call-pnpm-test",
            name: "exec_command",
            arguments: "{\"cmd\":\"pnpm test\"}",
            output: "Process exited with code 0"
          }
        ]
      }),
      [
        {
          id: "npm-test",
          scope: "project",
          topic: "commands",
          summary: "Run `npm test` to verify this repository.",
          details: ["Use `npm test` as a repeatable verification command for this project."],
          updatedAt: "2026-03-14T00:00:00.000Z",
          sources: ["old"]
        }
      ]
    );

    expect(
      operations.some((operation) => operation.action === "delete" && operation.id === "npm-test")
    ).toBe(false);
    expect(
      operations.some(
        (operation) => operation.action === "upsert" && operation.summary?.includes("pnpm test")
      )
    ).toBe(true);
  });

  it("does not silently truncate heuristic operations before later reviewer stages", async () => {
    const extractor = new HeuristicExtractor();
    const operations = await extractor.extract(
      baseEvidence({
        toolCalls: [
          {
            callId: "call-pnpm-test",
            name: "exec_command",
            arguments: "{\"cmd\":\"pnpm test\"}",
            output: "Process exited with code 0"
          },
          {
            callId: "call-pnpm-lint",
            name: "exec_command",
            arguments: "{\"cmd\":\"pnpm lint\"}",
            output: "Process exited with code 0"
          },
          {
            callId: "call-pnpm-build",
            name: "exec_command",
            arguments: "{\"cmd\":\"pnpm build\"}",
            output: "Process exited with code 0"
          },
          {
            callId: "call-npm-install",
            name: "exec_command",
            arguments: "{\"cmd\":\"npm install\"}",
            output: "Process exited with code 0"
          },
          {
            callId: "call-cargo-test",
            name: "exec_command",
            arguments: "{\"cmd\":\"cargo test\"}",
            output: "Process exited with code 0"
          },
          {
            callId: "call-cargo-build",
            name: "exec_command",
            arguments: "{\"cmd\":\"cargo build\"}",
            output: "Process exited with code 0"
          },
          {
            callId: "call-pytest",
            name: "exec_command",
            arguments: "{\"cmd\":\"pytest\"}",
            output: "Process exited with code 0"
          },
          {
            callId: "call-jest",
            name: "exec_command",
            arguments: "{\"cmd\":\"jest\"}",
            output: "Process exited with code 0"
          },
          {
            callId: "call-vitest",
            name: "exec_command",
            arguments: "{\"cmd\":\"vitest\"}",
            output: "Process exited with code 0"
          },
          {
            callId: "call-make",
            name: "exec_command",
            arguments: "{\"cmd\":\"make\"}",
            output: "Process exited with code 0"
          }
        ]
      }),
      []
    );

    expect(operations.length).toBeGreaterThan(8);
    expect(
      operations.some(
        (operation) => operation.action === "upsert" && operation.summary?.includes("make")
      )
    ).toBe(true);
  });

  it("deletes stale preferences after an explicit correction rollout", async () => {
    const extractor = new HeuristicExtractor();
    const evidence = await parseRolloutEvidence(
      path.join(process.cwd(), "test/fixtures/rollouts/preferences-correction.jsonl")
    );

    expect(evidence).not.toBeNull();

    const operations = await extractor.extract(evidence!, [
      {
        id: "use-npm",
        scope: "project",
        topic: "preferences",
        summary: "Use npm in this repository.",
        details: ["Use npm instead of pnpm in this repository."],
        updatedAt: "2026-03-14T00:00:00.000Z",
        sources: ["old"]
      }
    ]);

    expect(
      operations.some(
        (operation) => operation.action === "delete" && operation.id === "use-npm"
      )
    ).toBe(true);
    expect(
      operations.some(
        (operation) =>
          operation.action === "upsert" &&
          operation.topic === "preferences" &&
          operation.summary?.includes("We use pnpm, not npm")
      )
    ).toBe(true);
  });

  it("deletes stale preferences after a prefer-over correction rollout", async () => {
    const extractor = new HeuristicExtractor();
    const evidence = await parseRolloutEvidence(
      path.join(process.cwd(), "test/fixtures/rollouts/preferences-prefer-over-correction.jsonl")
    );

    expect(evidence).not.toBeNull();

    const operations = await extractor.extract(evidence!, [
      {
        id: "use-npm",
        scope: "project",
        topic: "preferences",
        summary: "Use npm in this repository.",
        details: ["Use npm instead of pnpm in this repository."],
        updatedAt: "2026-03-14T00:00:00.000Z",
        sources: ["old"]
      }
    ]);

    expect(
      operations.some(
        (operation) => operation.action === "delete" && operation.id === "use-npm"
      )
    ).toBe(true);
    expect(
      operations.some(
        (operation) =>
          operation.action === "upsert" &&
          operation.topic === "preferences" &&
          operation.summary?.includes("Prefer pnpm over npm")
      )
    ).toBe(true);
  });

  it("deletes stale workflow notes after an explicit correction rollout", async () => {
    const extractor = new HeuristicExtractor();
    const evidence = await parseRolloutEvidence(
      path.join(process.cwd(), "test/fixtures/rollouts/workflow-correction.jsonl")
    );

    expect(evidence).not.toBeNull();

    const operations = await extractor.extract(evidence!, [
      {
        id: "use-grep-search",
        scope: "project",
        topic: "workflow",
        summary: "Use grep for repo search.",
        details: ["Use grep when searching the repository."],
        updatedAt: "2026-03-14T00:00:00.000Z",
        sources: ["old"]
      }
    ]);

    expect(
      operations.some(
        (operation) => operation.action === "delete" && operation.id === "use-grep-search"
      )
    ).toBe(true);
    expect(
      operations.some(
        (operation) =>
          operation.action === "upsert" &&
          operation.topic === "workflow" &&
          operation.summary?.includes("Not grep, use rg")
      )
    ).toBe(true);
  });

  it("does not delete stale preferences for hedged prefer-over wording", async () => {
    const extractor = new HeuristicExtractor();
    const evidence = await parseRolloutEvidence(
      path.join(
        process.cwd(),
        "test/fixtures/rollouts/ambiguous-preferences-prefer-over-correction.jsonl"
      )
    );

    expect(evidence).not.toBeNull();

    const operations = await extractor.extract(evidence!, [
      {
        id: "use-npm",
        scope: "project",
        topic: "preferences",
        summary: "Use npm in this repository.",
        details: ["Use npm instead of pnpm in this repository."],
        updatedAt: "2026-03-14T00:00:00.000Z",
        sources: ["old"]
      }
    ]);

    expect(operations.some((operation) => operation.action === "delete")).toBe(false);
    expect(operations.some((operation) => operation.action === "upsert")).toBe(false);
  });

  it("keeps stale preferences when an explicit correction is ambiguous", async () => {
    const extractor = new HeuristicExtractor();
    const evidence = await parseRolloutEvidence(
      path.join(process.cwd(), "test/fixtures/rollouts/ambiguous-preferences-correction.jsonl")
    );

    expect(evidence).not.toBeNull();

    const operations = await extractor.extract(evidence!, [
      {
        id: "use-npm-main-repo",
        scope: "project",
        topic: "preferences",
        summary: "Use npm in this repository.",
        details: ["Use npm instead of pnpm in this repository."],
        updatedAt: "2026-03-14T00:00:00.000Z",
        sources: ["old"]
      },
      {
        id: "use-npm-docs-examples",
        scope: "project",
        topic: "preferences",
        summary: "Use npm for docs examples.",
        details: ["Docs examples still reference npm commands."],
        updatedAt: "2026-03-14T00:00:00.000Z",
        sources: ["old"]
      }
    ]);

    expect(operations.filter((operation) => operation.action === "delete")).toHaveLength(0);
    expect(
      operations.some(
        (operation) =>
          operation.action === "upsert" &&
          operation.topic === "preferences" &&
          operation.summary?.includes("We use pnpm, not npm")
      )
    ).toBe(true);
  });

  it("deletes only the matching scoped stale entry when duplicate ids exist across scopes", async () => {
    const extractor = new HeuristicExtractor();
    const existingEntries: MemoryEntry[] = [
      {
        id: "use-npm",
        scope: "global",
        topic: "preferences",
        summary: "Use npm for legacy global examples.",
        details: ["Keep npm in the global legacy examples."],
        updatedAt: "2026-03-14T00:00:00.000Z",
        sources: ["old"]
      },
      {
        id: "use-npm",
        scope: "project",
        topic: "preferences",
        summary: "Use npm in this repository.",
        details: ["Use npm instead of pnpm in this repository."],
        updatedAt: "2026-03-14T00:00:00.000Z",
        sources: ["old"]
      }
    ];

    const operations = await extractor.extract(
      baseEvidence({
        userMessages: ["remember that we use pnpm, not npm"]
      }),
      existingEntries
    );

    expect(operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "delete",
          scope: "project",
          topic: "preferences",
          id: "use-npm"
        })
      ])
    );
    expect(operations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "delete",
          scope: "global",
          topic: "preferences",
          id: "use-npm"
        })
      ])
    );
  });

  it("forgets only the matching entry when duplicate ids exist across topics", async () => {
    const extractor = new HeuristicExtractor();
    const existingEntries: MemoryEntry[] = [
      {
        id: "prefer-pnpm",
        scope: "project",
        topic: "workflow",
        summary: "Prefer pnpm in this repository.",
        details: ["Use pnpm instead of npm in this repository."],
        updatedAt: "2026-03-14T00:00:00.000Z",
        sources: ["old"]
      },
      {
        id: "prefer-pnpm",
        scope: "project",
        topic: "commands",
        summary: "Run `pnpm test` to verify this repository.",
        details: ["Use `pnpm test` as a repeatable verification command for this project."],
        updatedAt: "2026-03-14T00:00:00.000Z",
        sources: ["old"]
      }
    ];

    const operations = await extractor.extract(
      baseEvidence({
        userMessages: ["forget repeatable verification command"]
      }),
      existingEntries
    );

    expect(operations).toEqual([
      expect.objectContaining({
        action: "delete",
        scope: "project",
        topic: "commands",
        id: "prefer-pnpm"
      })
    ]);
  });

  it("does not delete architecture memory from a generic remember instruction", async () => {
    const extractor = new HeuristicExtractor();
    const evidence = await parseRolloutEvidence(
      path.join(process.cwd(), "test/fixtures/rollouts/architecture-remember-boundary.jsonl")
    );

    expect(evidence).not.toBeNull();

    const operations = await extractor.extract(evidence!, [
      {
        id: "fat-controllers",
        scope: "project",
        topic: "architecture",
        summary: "Use fat controllers in the API route.",
        details: ["Keep the API route logic inside controllers."],
        updatedAt: "2026-03-14T00:00:00.000Z",
        sources: ["old"]
      }
    ]);

    expect(operations.some((operation) => operation.action === "delete")).toBe(false);
    expect(
      operations.some(
        (operation) =>
          operation.action === "upsert" &&
          operation.topic === "architecture" &&
          operation.summary?.includes("service objects replace fat controllers")
      )
    ).toBe(true);
  });

  it("does not leak temporary continuity next steps into durable memory", async () => {
    const extractor = new HeuristicExtractor();
    const evidence = await parseRolloutEvidence(
      path.join(process.cwd(), "test/fixtures/rollouts/mixed-durable-continuity-noise.jsonl")
    );

    expect(evidence).not.toBeNull();

    const operations = await extractor.extract(evidence!, []);
    expect(
      operations.some(
        (operation) =>
          operation.action === "upsert" &&
          operation.summary?.includes("API tests require Redis")
      )
    ).toBe(true);
    expect(
      operations.some(
        (operation) =>
          operation.action === "upsert" &&
          /Next step|login\.ts|middleware/u.test(operation.summary ?? "")
      )
    ).toBe(false);
  });

  it("extracts conflicting same-rollout preference candidates from a real fixture for reviewer-side suppression", async () => {
    const extractor = new HeuristicExtractor();
    const evidence = await parseRolloutEvidence(
      path.join(process.cwd(), "test/fixtures/rollouts/within-rollout-preference-conflict.jsonl")
    );

    expect(evidence).not.toBeNull();

    const operations = await extractor.extract(evidence!, []);
    const upserts = operations.filter((operation) => operation.action === "upsert");

    expect(upserts).toHaveLength(2);
    expect(upserts.map((operation) => operation.summary)).toEqual(
      expect.arrayContaining([
        "we use pnpm in this repository",
        "we use bun in this repository"
      ])
    );
  });

  it("treats mixed-language explicit corrections in noisy rollouts as high-confidence replacements", async () => {
    const extractor = new HeuristicExtractor();
    const evidence = await parseRolloutEvidence(
      path.join(process.cwd(), "test/fixtures/rollouts/mixed-language-reviewer-noise.jsonl")
    );

    expect(evidence).not.toBeNull();

    const operations = await extractor.extract(evidence!, [
      {
        id: "use-bun",
        scope: "project",
        topic: "preferences",
        summary: "Use bun in this repository.",
        details: ["Use bun instead of pnpm in this repository."],
        updatedAt: "2026-03-14T00:00:00.000Z",
        sources: ["old"]
      }
    ]);

    expect(
      operations.some((operation) => operation.action === "delete" && operation.id === "use-bun")
    ).toBe(true);
    expect(
      operations.some(
        (operation) =>
          operation.action === "upsert" &&
          operation.summary?.includes("实际上用 pnpm，不要用 bun")
      )
    ).toBe(true);
    expect(
      operations.some(
        (operation) =>
          operation.action === "upsert" &&
          /reviewer sub-agent|cookie middleware/u.test(operation.summary ?? "")
      )
    ).toBe(false);
  });

  it("keeps a hedged conflict candidate available for later conservative suppression", async () => {
    const extractor = new HeuristicExtractor();
    const evidence = await parseRolloutEvidence(
      path.join(process.cwd(), "test/fixtures/rollouts/hedged-preference-conflict.jsonl")
    );

    expect(evidence).not.toBeNull();

    const operations = await extractor.extract(evidence!, [
      {
        id: "use-pnpm",
        scope: "project",
        topic: "preferences",
        summary: "Use pnpm in this repository.",
        details: ["Use pnpm instead of npm in this repository."],
        updatedAt: "2026-03-14T00:00:00.000Z",
        sources: ["old"]
      }
    ]);

    expect(
      operations.some((operation) => operation.action === "delete" && operation.id === "use-pnpm")
    ).toBe(true);
    expect(
      operations.some(
        (operation) =>
          operation.action === "upsert" &&
          operation.summary?.includes("maybe use bun instead of pnpm")
      )
    ).toBe(true);
  });

  it("keeps the latest high-confidence correction and suppresses stale same-rollout candidates", async () => {
    const extractor = new HeuristicExtractor();
    const operations = await extractor.extract(
      baseEvidence({
        userMessages: [
          "remember that we use bun in this repository",
          "Actually use pnpm, not bun."
        ]
      }),
      []
    );

    const reviewed = reviewExtractedMemoryOperations(operations, []);

    expect(
      reviewed.operations.some(
        (operation) =>
          operation.action === "upsert" &&
          operation.summary === "Actually use pnpm, not bun"
      )
    ).toBe(true);
    expect(
      reviewed.operations.some(
        (operation) =>
          operation.action === "upsert" &&
          operation.summary === "we use bun in this repository"
      )
    ).toBe(false);
    expect(reviewed.suppressedOperationCount).toBe(1);
    expect(reviewed.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "within-rollout",
          candidateSummary: "we use bun in this repository",
          conflictsWith: ["Actually use pnpm, not bun"]
        })
      ])
    );
  });

  it("does not let a retained high-confidence directive keep replacement deletes for an unrelated suppressed directive", () => {
    const reviewed = reviewExtractedMemoryOperations(
      [
        {
          action: "delete",
          scope: "project",
          topic: "preferences",
          id: "use-grep",
          reason: "Superseded by a newer explicit user correction."
        },
        {
          action: "upsert",
          scope: "project",
          topic: "preferences",
          id: "maybe-use-rg",
          summary: "maybe use rg instead of grep",
          details: ["Potential repo search correction."],
          reason: "Explicit user correction that should replace stale memory."
        },
        {
          action: "delete",
          scope: "project",
          topic: "preferences",
          id: "use-bun",
          reason: "Superseded by a newer explicit user correction."
        },
        {
          action: "upsert",
          scope: "project",
          topic: "preferences",
          id: "use-pnpm",
          summary: "Actually use pnpm, not bun",
          details: ["Package manager correction."],
          reason: "Explicit user correction that should replace stale memory."
        }
      ],
      [
        {
          id: "use-grep",
          scope: "project",
          topic: "preferences",
          summary: "Use grep for repo search.",
          details: ["Use grep instead of rg in this repository."],
          updatedAt: "2026-03-14T00:00:00.000Z",
          sources: ["old"]
        }
      ]
    );

    expect(reviewed.operations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "delete",
          id: "use-grep"
        })
      ])
    );
    expect(reviewed.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "delete",
          id: "use-bun"
        }),
        expect.objectContaining({
          action: "upsert",
          id: "use-pnpm"
        })
      ])
    );
  });

  it("keeps replacement deletes for wrapped command variants that canonicalize to the same verification tool", () => {
    const reviewed = reviewExtractedMemoryOperations(
      [
        {
          action: "delete",
          scope: "project",
          topic: "commands",
          id: "vitest-command",
          reason: "Superseded by a newer successful command extracted from the session."
        },
        {
          action: "upsert",
          scope: "project",
          topic: "commands",
          id: "pnpm-exec-vitest-run-test-session-command-test-ts",
          summary: "Run `pnpm exec vitest run test/session-command.test.ts` to verify this repository.",
          details: [
            "Use `pnpm exec vitest run test/session-command.test.ts` as a repeatable verification command for this project."
          ],
          reason: "Stable command inferred from recent tool usage."
        }
      ],
      [
        {
          id: "vitest-command",
          scope: "project",
          topic: "commands",
          summary: "Run `vitest` to verify this repository.",
          details: ["Use `vitest` as a repeatable verification command for this project."],
          updatedAt: "2026-03-14T00:00:00.000Z",
          sources: ["old"]
        }
      ]
    );

    expect(reviewed.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "delete",
          id: "vitest-command"
        }),
        expect.objectContaining({
          action: "upsert",
          id: "pnpm-exec-vitest-run-test-session-command-test-ts"
        })
      ])
    );
  });

  it("keeps the latest high-confidence reference correction and suppresses stale same-rollout pointers", () => {
    const reviewed = reviewExtractedMemoryOperations(
      [
        {
          action: "upsert",
          scope: "project",
          topic: "reference",
          id: "old-runbook",
          summary: "The runbook lives at https://old.example.com/runbook",
          details: ["Old runbook pointer."],
          reason: "Manual reference note."
        },
        {
          action: "upsert",
          scope: "project",
          topic: "reference",
          id: "new-runbook",
          summary: "Actually the runbook lives at https://new.example.com/runbook",
          details: ["Updated runbook pointer."],
          reason: "Explicit user correction that should replace stale memory."
        }
      ],
      []
    );

    expect(reviewed.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "upsert",
          id: "new-runbook"
        })
      ])
    );
    expect(reviewed.operations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "upsert",
          id: "old-runbook"
        })
      ])
    );
    expect(reviewed.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "within-rollout",
          candidateSummary: "The runbook lives at https://old.example.com/runbook",
          conflictsWith: ["Actually the runbook lives at https://new.example.com/runbook"]
        })
      ])
    );
  });

  it("extracts explicit reference corrections so they can replace stale durable pointers", async () => {
    const extractor = new HeuristicExtractor();
    const existingEntries: MemoryEntry[] = [
      {
        id: "auth-runbook",
        scope: "project",
        topic: "reference",
        summary: "The auth runbook lives at https://old.example.com/auth-runbook",
        details: ["Old auth runbook pointer."],
        updatedAt: "2026-03-14T00:00:00.000Z",
        sources: ["old"]
      }
    ];

    const operations = await extractor.extract(
      baseEvidence({
        userMessages: [
          "Actually the auth runbook lives at https://docs.example.com/auth-runbook, not https://old.example.com/auth-runbook."
        ]
      }),
      existingEntries
    );
    const reviewed = reviewExtractedMemoryOperations(operations, existingEntries);

    expect(reviewed.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "delete",
          topic: "reference",
          id: "auth-runbook"
        }),
        expect.objectContaining({
          action: "upsert",
          topic: "reference",
          reason: "Explicit user correction that should replace stale memory."
        })
      ])
    );
  });

  it("does not replace an issue tracker reference with a different pointer when both lack URLs", async () => {
    const extractor = new HeuristicExtractor();
    const existingEntries: MemoryEntry[] = [
      {
        id: "jira-incidents",
        scope: "project",
        topic: "reference",
        summary: "Incidents are tracked in Jira.",
        details: ["Old issue tracker pointer."],
        updatedAt: "2026-03-14T00:00:00.000Z",
        sources: ["old"]
      }
    ];

    const operations = await extractor.extract(
      baseEvidence({
        userMessages: ["Work is tracked in Linear."]
      }),
      existingEntries
    );
    const reviewed = reviewExtractedMemoryOperations(operations, existingEntries);

    expect(reviewed.operations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "delete",
          topic: "reference",
          id: "jira-incidents"
        })
      ])
    );
    expect(reviewed.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "upsert",
          topic: "reference"
        })
      ])
    );
  });

  it("does not replace an existing issue tracker URL when a different tracker URL shares a generic tail token", async () => {
    const extractor = new HeuristicExtractor();
    const existingEntries: MemoryEntry[] = [
      {
        id: "jira-issues",
        scope: "project",
        topic: "reference",
        summary: "Issues are tracked at https://acme.atlassian.net/issues",
        details: ["Primary issue tracker pointer."],
        updatedAt: "2026-03-14T00:00:00.000Z",
        sources: ["old"]
      }
    ];

    const operations = await extractor.extract(
      baseEvidence({
        userMessages: ["Issues are tracked at https://github.com/acme/widgets/issues."]
      }),
      existingEntries
    );
    const reviewed = reviewExtractedMemoryOperations(operations, existingEntries);

    expect(reviewed.operations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "delete",
          topic: "reference",
          id: "jira-issues"
        })
      ])
    );
    expect(reviewed.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "upsert",
          topic: "reference",
          summary: "Issues are tracked at https://github.com/acme/widgets/issues"
        })
      ])
    );
  });

  it("does not suppress different issue tracker URLs when both use a generic browse tail", () => {
    const reviewed = reviewExtractedMemoryOperations(
      [
        {
          action: "upsert",
          scope: "project",
          topic: "reference",
          id: "jira-browse",
          summary: "The issue tracker lives at https://jira.example.com/browse",
          details: ["Jira browse pointer."],
          reason: "Stable directive extracted from the session."
        },
        {
          action: "upsert",
          scope: "project",
          topic: "reference",
          id: "github-browse",
          summary: "The issue tracker lives at https://github.com/acme/widgets/browse",
          details: ["GitHub browse pointer."],
          reason: "Stable directive extracted from the session."
        }
      ],
      []
    );

    expect(reviewed.suppressedOperationCount).toBe(0);
    expect(reviewed.conflicts).toEqual([]);
    expect(reviewed.operations).toHaveLength(2);
  });

  it("treats remember-style reference corrections as explicit replacements end-to-end", async () => {
    const extractor = new HeuristicExtractor();
    const existingEntries: MemoryEntry[] = [
      {
        id: "auth-runbook",
        scope: "project",
        topic: "reference",
        summary: "The auth runbook lives at https://old.example.com/auth-runbook",
        details: ["Old auth runbook pointer."],
        updatedAt: "2026-03-14T00:00:00.000Z",
        sources: ["old"]
      }
    ];

    const operations = await extractor.extract(
      baseEvidence({
        userMessages: [
          "remember that the auth runbook lives at https://docs.example.com/auth-runbook instead of https://old.example.com/auth-runbook"
        ]
      }),
      existingEntries
    );
    const reviewed = reviewExtractedMemoryOperations(operations, existingEntries);

    expect(reviewed.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "delete",
          topic: "reference",
          id: "auth-runbook"
        }),
        expect.objectContaining({
          action: "upsert",
          topic: "reference",
          reason: "Explicit user correction that should replace stale memory."
        })
      ])
    );
  });

  it("extracts explicit architecture corrections so they can replace stale canonical-store memory", async () => {
    const extractor = new HeuristicExtractor();
    const existingEntries: MemoryEntry[] = [
      {
        id: "canonical-store",
        scope: "project",
        topic: "architecture",
        summary: "Use a database-first canonical store for durable memory.",
        details: ["The canonical source of truth is SQLite."],
        updatedAt: "2026-03-14T00:00:00.000Z",
        sources: ["old"]
      }
    ];

    const operations = await extractor.extract(
      baseEvidence({
        userMessages: ["Actually keep Markdown-first as the canonical store, not database-first."]
      }),
      existingEntries
    );
    const reviewed = reviewExtractedMemoryOperations(operations, existingEntries);

    expect(reviewed.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "delete",
          topic: "architecture",
          id: "canonical-store"
        }),
        expect.objectContaining({
          action: "upsert",
          topic: "architecture",
          reason: "Explicit user correction that should replace stale memory."
        })
      ])
    );
  });

  it("keeps additive debugging prerequisites for different required services", () => {
    const reviewed = reviewExtractedMemoryOperations(
      [
        {
          action: "upsert",
          scope: "project",
          topic: "debugging",
          id: "redis-required",
          summary: "Redis must be running before integration tests",
          details: ["Start Redis before running the integration suite."],
          reason: "Stable directive extracted from the session."
        },
        {
          action: "upsert",
          scope: "project",
          topic: "debugging",
          id: "postgres-required",
          summary: "Postgres must be running before integration tests",
          details: ["Start Postgres before running the integration suite."],
          reason: "Stable directive extracted from the session."
        }
      ],
      []
    );

    expect(reviewed.suppressedOperationCount).toBe(0);
    expect(reviewed.conflicts).toEqual([]);
    expect(reviewed.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "upsert",
          id: "redis-required"
        }),
        expect.objectContaining({
          action: "upsert",
          id: "postgres-required"
        })
      ])
    );
  });

  it("keeps additive same-category runbook pointers when they refer to different resources", () => {
    const reviewed = reviewExtractedMemoryOperations(
      [
        {
          action: "upsert",
          scope: "project",
          topic: "reference",
          id: "auth-runbook",
          summary: "The auth runbook lives at https://docs.example.com/auth-runbook",
          details: ["Auth runbook pointer."],
          reason: "Stable directive extracted from the session."
        },
        {
          action: "upsert",
          scope: "project",
          topic: "reference",
          id: "billing-runbook",
          summary: "The billing runbook lives at https://docs.example.com/billing-runbook",
          details: ["Billing runbook pointer."],
          reason: "Stable directive extracted from the session."
        }
      ],
      []
    );

    expect(reviewed.suppressedOperationCount).toBe(0);
    expect(reviewed.conflicts).toEqual([]);
    expect(reviewed.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "auth-runbook" }),
        expect.objectContaining({ id: "billing-runbook" })
      ])
    );
  });

  it("does not suppress equivalent command aliases that share one canonical signature", () => {
    const reviewed = reviewExtractedMemoryOperations(
      [
        {
          action: "upsert",
          scope: "project",
          topic: "commands",
          id: "pnpm-test",
          summary: "Run `pnpm test` to verify this repository.",
          details: ["Use `pnpm test` as a repeatable verification command for this project."],
          reason: "Stable directive extracted from the session."
        },
        {
          action: "upsert",
          scope: "project",
          topic: "commands",
          id: "pnpm-run-test",
          summary: "Run `pnpm run test` to verify this repository.",
          details: ["Use `pnpm run test` as a repeatable verification command for this project."],
          reason: "Stable directive extracted from the session."
        }
      ],
      []
    );

    expect(reviewed.suppressedOperationCount).toBe(0);
    expect(reviewed.conflicts).toEqual([]);
    expect(reviewed.operations).toHaveLength(1);
  });

  it("suppresses hedged reference updates that conflict with existing durable pointers", () => {
    const reviewed = reviewExtractedMemoryOperations(
      [
        {
          action: "upsert",
          scope: "project",
          topic: "reference",
          id: "maybe-dashboard",
          summary: "Maybe the dashboard lives at https://new.example.com/dashboard",
          details: ["Possible dashboard pointer."],
          reason: "Explicit user correction that should replace stale memory."
        }
      ],
      [
        {
          id: "dashboard",
          scope: "project",
          topic: "reference",
          summary: "The dashboard lives at https://old.example.com/dashboard",
          details: ["Current dashboard pointer."],
          updatedAt: "2026-03-14T00:00:00.000Z",
          sources: ["old"]
        }
      ]
    );

    expect(reviewed.operations).toEqual([]);
    expect(reviewed.suppressedOperationCount).toBe(1);
    expect(reviewed.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "existing-memory",
          candidateSummary: "Maybe the dashboard lives at https://new.example.com/dashboard",
          conflictsWith: ["The dashboard lives at https://old.example.com/dashboard"]
        })
      ])
    );
  });

  it("lets a stable non-hedged reference directive replace one stale durable pointer when the target is unambiguous", async () => {
    const extractor = new HeuristicExtractor();
    const existingEntries: MemoryEntry[] = [
      {
        id: "auth-runbook",
        scope: "project",
        topic: "reference",
        summary: "The auth runbook lives at https://old.example.com/auth-runbook",
        details: ["Old auth runbook pointer."],
        updatedAt: "2026-03-14T00:00:00.000Z",
        sources: ["old"]
      }
    ];

    const operations = await extractor.extract(
      baseEvidence({
        userMessages: ["The auth runbook lives at https://docs.example.com/auth-runbook."]
      }),
      existingEntries
    );
    const reviewed = reviewExtractedMemoryOperations(operations, existingEntries);

    expect(reviewed.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "delete",
          topic: "reference",
          id: "auth-runbook"
        }),
        expect.objectContaining({
          action: "upsert",
          topic: "reference",
          summary: "The auth runbook lives at https://docs.example.com/auth-runbook"
        })
      ])
    );
  });

  it("matches auto-forget queries with the same normalized topic-aware semantics as the CLI surface", async () => {
    const extractor = new HeuristicExtractor();
    const existingEntries: MemoryEntry[] = [
      {
        id: "prefer-pnpm",
        scope: "project",
        topic: "workflow",
        summary: "Prefer pnpm in this repository.",
        details: ["Use pnpm instead of npm in this repository."],
        updatedAt: "2026-03-14T00:00:00.000Z",
        sources: ["old"]
      }
    ];

    const operations = await extractor.extract(
      baseEvidence({
        userMessages: ["forget workflow"]
      }),
      existingEntries
    );

    expect(operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "delete",
          id: "prefer-pnpm"
        })
      ])
    );
  });

  it("keeps scoped exceptions when a repo-wide correction only overlaps a docs-specific note", async () => {
    const extractor = new HeuristicExtractor();
    const existingEntries: MemoryEntry[] = [
      {
        id: "docs-use-npm",
        scope: "project",
        topic: "preferences",
        summary: "Use npm for docs examples.",
        details: ["Docs snippets still use npm commands."],
        updatedAt: "2026-03-14T00:00:00.000Z",
        sources: ["old"]
      }
    ];

    const operations = await extractor.extract(
      baseEvidence({
        userMessages: ["we use pnpm, not npm"]
      }),
      existingEntries
    );

    expect(operations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "delete",
          id: "docs-use-npm"
        })
      ])
    );
    expect(operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "upsert",
          summary: "we use pnpm, not npm"
        })
      ])
    );
  });

  it("does not delete cross-scope command memories for remember-style command corrections", async () => {
    const extractor = new HeuristicExtractor();
    const existingEntries: MemoryEntry[] = [
      {
        id: "global-npm-test",
        scope: "global",
        topic: "commands",
        summary: "Run `npm test` to verify projects.",
        details: ["Global command note."],
        updatedAt: "2026-03-14T00:00:00.000Z",
        sources: ["old"]
      },
      {
        id: "project-npm-test",
        scope: "project",
        topic: "commands",
        summary: "Run `npm test` to verify this repository.",
        details: ["Project command note."],
        updatedAt: "2026-03-14T00:00:00.000Z",
        sources: ["old"]
      }
    ];

    const operations = await extractor.extract(
      baseEvidence({
        userMessages: ["remember that run `pnpm test`, not `npm test`"]
      }),
      existingEntries
    );

    expect(operations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "delete",
          scope: "global",
          id: "global-npm-test"
        })
      ])
    );
    expect(operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "delete",
          scope: "project",
          id: "project-npm-test"
        })
      ])
    );
  });
});

describe("safety filter", () => {
  it("does not flag git SHA hashes (40-char hex) as sensitive", () => {
    const gitSha = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
    const filtered = filterMemoryOperations([
      {
        action: "upsert",
        scope: "project",
        topic: "workflow",
        id: "git-sha-entry",
        summary: `Last known good commit: ${gitSha}`,
        details: [`Pinned at ${gitSha}`]
      }
    ]);
    expect(filtered).toHaveLength(1);
  });

  it("flags base64-encoded strings with = padding as sensitive", () => {
    const base64WithPadding = "SGVsbG8gV29ybGQgdGhpcyBpcyBhIHNlY3JldCE=";
    const filtered = filterMemoryOperations([
      {
        action: "upsert",
        scope: "project",
        topic: "workflow",
        id: "base64-entry",
        summary: `Token: ${base64WithPadding}`,
        details: ["should be dropped"]
      }
    ]);
    expect(filtered).toHaveLength(0);
  });

  it("drops sensitive operations and keeps safe ones", () => {
    const secretLiteral = `Bearer ${["sk", "12345678901234567890"].join("-")}`;
    const filtered = filterMemoryOperations([
      {
        action: "upsert",
        scope: "project",
        topic: "preferences",
        id: "safe",
        summary: "Use pnpm in this repository.",
        details: ["Prefer pnpm instead of npm here."]
      },
      {
        action: "upsert",
        scope: "project",
        topic: "preferences",
        id: "secret",
        summary: secretLiteral,
        details: ["Never do this."]
      }
    ]);

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("safe");
  });
});

describe("safety filter - volatile/sensitive patterns", () => {
  it("fails closed when an upsert uses an unknown topic", () => {
    const filtered = filterMemoryOperations([
      {
        action: "upsert",
        scope: "project",
        topic: "commandss",
        id: "prefer-pnpm",
        summary: "Prefer pnpm in this repository.",
        details: ["Use pnpm instead of npm."]
      }
    ]);
    expect(filtered).toHaveLength(0);
  });

  it("fails closed when a delete uses an unknown topic", () => {
    const filtered = filterMemoryOperations([
      {
        action: "delete",
        scope: "project",
        topic: "commandss",
        id: "prefer-pnpm"
      }
    ]);
    expect(filtered).toHaveLength(0);
  });

  it("keeps entries with 'currently' in summary", () => {
    const filtered = filterMemoryOperations([
      {
        action: "upsert",
        scope: "project",
        topic: "workflow",
        id: "pkg-manager",
        summary: "Currently we use pnpm as the package manager.",
        details: ["Use pnpm instead of npm."]
      }
    ]);
    expect(filtered).toHaveLength(1);
  });

  it("rejects entries with volatile markers like 'wip'", () => {
    const filtered = filterMemoryOperations([
      {
        action: "upsert",
        scope: "project",
        topic: "workflow",
        id: "wip-entry",
        summary: "This is wip for now",
        details: ["temporary approach"]
      }
    ]);
    expect(filtered).toHaveLength(0);
  });

  it("rejects entries that only capture local host config or resume noise", () => {
    const filtered = filterMemoryOperations([
      {
        action: "upsert",
        scope: "project",
        topic: "workflow",
        id: "local-config-noise",
        summary: "Next step: update .mcp.json and .codex/config.toml in this worktree only.",
        details: ["Resume here after the next message."]
      }
    ]);
    expect(filtered).toHaveLength(0);
  });

  it("rejects entries with AWS access key", () => {
    const syntheticAwsKey = ["AKIA", "IOSFODNN7EXAMPLE"].join("");
    const filtered = filterMemoryOperations([
      {
        action: "upsert",
        scope: "project",
        topic: "workflow",
        id: "aws-key",
        summary: `Use key ${syntheticAwsKey} for the CI bucket.`,
        details: ["ci credentials"]
      }
    ]);
    expect(filtered).toHaveLength(0);
  });

  it("rejects entries with database connection string", () => {
    const filtered = filterMemoryOperations([
      {
        action: "upsert",
        scope: "project",
        topic: "workflow",
        id: "db-conn",
        summary: "Connect via postgres://user:pass@host/db for local dev.",
        details: ["local db url"]
      }
    ]);
    expect(filtered).toHaveLength(0);
  });

  it("keeps clean postgres mention without connection string", () => {
    const filtered = filterMemoryOperations([
      {
        action: "upsert",
        scope: "project",
        topic: "architecture",
        id: "use-postgres",
        summary: "Use postgres for the API database layer.",
        details: ["The project uses PostgreSQL as its primary store."]
      }
    ]);
    expect(filtered).toHaveLength(1);
  });

  it("rejects volatile wording even inside debugging topics", () => {
    const diagnostics = filterMemoryOperationsWithDiagnostics([
      {
        action: "upsert",
        scope: "project",
        topic: "debugging",
        id: "temporary-debug-note",
        summary: "Temporary workaround: restart Redis when tests hang.",
        details: ["Temporary but still useful while the issue is open."]
      }
    ]);

    expect(diagnostics.operations).toEqual([]);
    expect(diagnostics.rejectedReasonCounts).toMatchObject({
      volatile: 1
    });
  });

  it("caps sanitized operations at 12 items", () => {
    const filtered = filterMemoryOperations(
      Array.from({ length: 20 }, (_, index) => ({
        action: "upsert" as const,
        scope: "project" as const,
        topic: "workflow",
        id: `entry-${index}`,
        summary: `Workflow note ${index}`,
        details: [`Workflow detail ${index}`]
      }))
    );
    expect(filtered).toHaveLength(12);
  });

  it("returns rejected diagnostics for unknown topics, sensitive content, and operation cap", () => {
    const diagnostics = filterMemoryOperationsWithDiagnostics(
      [
        {
          action: "upsert",
          scope: "project",
          topic: "commandss",
          id: "unknown-topic",
          summary: "Prefer pnpm in this repository.",
          details: ["Use pnpm instead of npm."]
        },
        {
          action: "upsert",
          scope: "project",
          topic: "workflow",
          id: "secret",
          summary: "postgres://fixture-user:fixture-pass@example.com/testdb",
          details: ["Never store this."]
        },
        ...Array.from({ length: 20 }, (_, index) => ({
          action: "upsert" as const,
          scope: "project" as const,
          topic: "workflow",
          id: `entry-${index}`,
          summary: `Workflow note ${index}`,
          details: [`Workflow detail ${index}`]
        }))
      ]
    );

    expect(diagnostics.operations).toHaveLength(12);
    expect(diagnostics.rejectedOperationCount).toBe(10);
    expect(diagnostics.rejectedReasonCounts).toMatchObject({
      "unknown-topic": 1,
      sensitive: 1,
      "operation-cap": 8
    });
  });

  it("returns volatile diagnostics for local host config task-state noise", () => {
    const diagnostics = filterMemoryOperationsWithDiagnostics([
      {
        action: "upsert",
        scope: "project",
        topic: "workflow",
        id: "local-config-noise",
        summary: "Next step: update .mcp.json and .codex/config.toml in this worktree only.",
        details: ["Resume here after the next message."]
      }
    ]);

    expect(diagnostics.operations).toEqual([]);
    expect(diagnostics.rejectedReasonCounts).toMatchObject({
      volatile: 1
    });
    expect(diagnostics.rejectedOperations).toEqual([
      expect.objectContaining({
        id: "local-config-noise",
        reason: "volatile"
      })
    ]);
  });

  it("rejects entries when volatile task-state noise only appears in details", () => {
    const diagnostics = filterMemoryOperationsWithDiagnostics([
      {
        action: "upsert",
        scope: "project",
        topic: "workflow",
        id: "volatile-detail-only",
        summary: "Use pnpm in this repository.",
        details: ["Next step: resume here after updating the current worktree only."]
      }
    ]);

    expect(diagnostics.operations).toEqual([]);
    expect(diagnostics.rejectedReasonCounts).toMatchObject({
      volatile: 1
    });
  });

  it("rejects entries when volatile task-state noise only appears in reason", () => {
    const diagnostics = filterMemoryOperationsWithDiagnostics([
      {
        action: "upsert",
        scope: "project",
        topic: "workflow",
        id: "volatile-reason-only",
        summary: "Use pnpm in this repository.",
        details: ["Prefer pnpm instead of npm here."],
        reason: "Temporary next step for the current branch only."
      }
    ]);

    expect(diagnostics.operations).toEqual([]);
    expect(diagnostics.rejectedReasonCounts).toMatchObject({
      volatile: 1
    });
  });
});

describe("HeuristicExtractor - no duplicate upserts for remember + insight", () => {
  it("classifies explicit command remembers under commands", async () => {
    const extractor = new HeuristicExtractor();
    const operations = await extractor.extract(
      baseEvidence({
        userMessages: ["remember that run `pnpm test` to verify this repository"]
      }),
      []
    );

    expect(operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "upsert",
          topic: "commands",
          summary: "run `pnpm test` to verify this repository"
        })
      ])
    );
  });

  it("keeps explicit command corrections in commands when replacing stale command memory", async () => {
    const extractor = new HeuristicExtractor();
    const operations = await extractor.extract(
      baseEvidence({
        userMessages: ["remember that run `pnpm test`, not `npm test`, to verify this repository"]
      }),
      [
        {
          id: "npm-test",
          scope: "project",
          topic: "commands",
          summary: "Run `npm test` to verify this repository.",
          details: ["Use `npm test` as a repeatable verification command for this project."],
          updatedAt: "2026-03-14T00:00:00.000Z",
          sources: ["old"]
        }
      ]
    );

    expect(operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "upsert",
          topic: "commands"
        })
      ])
    );
  });

  it("does not produce duplicate upserts for remember + insight match on same message", async () => {
    const extractor = new HeuristicExtractor();
    const operations = await extractor.extract(
      baseEvidence({
        userMessages: ["remember that API tests require Redis"]
      }),
      []
    );
    const upserts = operations.filter((op) => op.action === "upsert");
    expect(upserts).toHaveLength(1);
  });
});

describe("CodexExtractor", () => {
  it("parses structured operations from a mocked codex binary", async () => {
    const temp = await tempDir("cam-extractor-");
    const outputSchemaPath = path.resolve("schemas/memory-operations.schema.json");
    const mockBinary = path.join(temp, "mock-codex");
    await fs.writeFile(
      mockBinary,
      `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const outputIndex = args.indexOf("-o");
const outputPath = args[outputIndex + 1];
fs.writeFileSync(outputPath, JSON.stringify({ operations: [{ action: "upsert", scope: "project", topic: "workflow", id: "mock-entry", summary: "Mock summary", details: ["Mock details"] }] }));
`,
      "utf8"
    );
    await fs.chmod(mockBinary, 0o755);

    const extractor = new CodexExtractor(mockBinary, outputSchemaPath);
    const operations = await extractor.extract(baseEvidence(), []);

    expect(operations).toHaveLength(1);
    expect(operations?.[0]?.id).toBe("mock-entry");
  });
});
