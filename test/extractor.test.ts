import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CodexExtractor } from "../src/lib/extractor/codex-extractor.js";
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
