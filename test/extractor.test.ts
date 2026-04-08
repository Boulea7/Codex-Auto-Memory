import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseRolloutEvidence } from "../src/lib/domain/rollout.js";
import { CodexExtractor } from "../src/lib/extractor/codex-extractor.js";
import { reviewExtractedMemoryOperations } from "../src/lib/extractor/contradiction-review.js";
import { HeuristicExtractor } from "../src/lib/extractor/heuristic-extractor.js";
import { filterMemoryOperations } from "../src/lib/extractor/safety.js";
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

  it("replaces stale command memory from a real rollout fixture", async () => {
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
    ).toBe(true);
    expect(
      operations.some(
        (operation) =>
          operation.action === "upsert" &&
          operation.summary?.includes("pnpm test")
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
    const filtered = filterMemoryOperations([
      {
        action: "upsert",
        scope: "project",
        topic: "debugging",
        id: "temporary-debug-note",
        summary: "Temporary workaround: restart Redis when tests hang.",
        details: ["Temporary but still useful while the issue is open."]
      }
    ]);
    expect(filtered).toHaveLength(0);
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
});

describe("HeuristicExtractor - no duplicate upserts for remember + insight", () => {
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
