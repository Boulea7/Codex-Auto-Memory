import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { APP_ID } from "../constants.js";
import type { MemoryEntry, MemoryOperation, RolloutEvidence } from "../types.js";
import type { MemoryExtractorAdapter } from "../runtime/contracts.js";
import { runCommandCapture } from "../util/process.js";
import { buildExtractorPrompt } from "./prompt.js";

export class CodexExtractor implements MemoryExtractorAdapter {
  public readonly name = "codex-ephemeral";

  public constructor(
    private readonly codexBinary: string,
    private readonly schemaPath: string
  ) {}

  public async extract(
    evidence: RolloutEvidence,
    existingEntries: MemoryEntry[]
  ): Promise<MemoryOperation[] | null> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `${APP_ID}-`));
    const outputPath = path.join(tempDir, "memory-ops.json");
    const prompt = buildExtractorPrompt(evidence, existingEntries);

    const args = [
      "exec",
      "--ephemeral",
      "--skip-git-repo-check",
      "--color",
      "never",
      "--output-schema",
      this.schemaPath,
      "-o",
      outputPath,
      "-"
    ];

    const result = runCommandCapture(this.codexBinary, args, evidence.cwd, process.env, prompt);
    if (result.exitCode !== 0) {
      await fs.rm(tempDir, { recursive: true, force: true });
      return null;
    }

    try {
      const output = await fs.readFile(outputPath, "utf8");
      const parsed = JSON.parse(output) as { operations?: MemoryOperation[] };
      await fs.rm(tempDir, { recursive: true, force: true });
      return parsed.operations ?? [];
    } catch {
      await fs.rm(tempDir, { recursive: true, force: true });
      return null;
    }
  }
}
