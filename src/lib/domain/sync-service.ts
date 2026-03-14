import path from "node:path";
import type { AppConfig, MemoryOperation, ProjectContext, RolloutEvidence, SyncResult } from "../types.js";
import { MemoryStore } from "./memory-store.js";
import { parseRolloutEvidence } from "./rollout.js";
import { HeuristicExtractor } from "../extractor/heuristic-extractor.js";
import { CodexExtractor } from "../extractor/codex-extractor.js";

export class SyncService {
  private readonly store: MemoryStore;
  private readonly heuristicExtractor = new HeuristicExtractor();
  private readonly codexExtractor: CodexExtractor;

  public constructor(
    private readonly project: ProjectContext,
    private readonly config: AppConfig,
    schemaRoot = path.resolve(process.cwd(), "schemas", "memory-operations.schema.json")
  ) {
    this.store = new MemoryStore(project, config);
    this.codexExtractor = new CodexExtractor(config.codexBinary, schemaRoot);
  }

  public get memoryStore(): MemoryStore {
    return this.store;
  }

  public async syncRollout(rolloutPath: string, force = false): Promise<SyncResult> {
    await this.store.ensureLayout();
    if (!force && (await this.store.hasProcessedRollout(rolloutPath))) {
      return {
        applied: [],
        skipped: true,
        message: `Skipped ${rolloutPath}; it was already processed.`
      };
    }

    const evidence = await parseRolloutEvidence(rolloutPath);
    if (!evidence) {
      return {
        applied: [],
        skipped: true,
        message: `Skipped ${rolloutPath}; no rollout evidence could be parsed.`
      };
    }

    const existingEntries = [
      ...(await this.store.listEntries("global")),
      ...(await this.store.listEntries("project")),
      ...(await this.store.listEntries("project-local"))
    ];

    const operations = await this.extractOperations(evidence, existingEntries);
    const applied = await this.store.applyOperations(operations);
    await this.store.markRolloutProcessed(rolloutPath);
    await this.store.appendAuditLog({
      rolloutPath,
      sessionId: evidence.sessionId,
      projectId: this.project.projectId,
      worktreeId: this.project.worktreeId,
      extractorMode: this.config.extractorMode,
      appliedAt: new Date().toISOString(),
      resultSummary: applied.length
        ? `${applied.length} operation(s) applied`
        : "No memory updates generated",
      operations: applied
    });

    return {
      applied,
      skipped: false,
      message: applied.length
        ? `Applied ${applied.length} memory operation(s) from ${path.basename(rolloutPath)}.`
        : `No memory updates were generated for ${path.basename(rolloutPath)}.`
    };
  }

  private async extractOperations(
    evidence: RolloutEvidence,
    existingEntries: Awaited<ReturnType<MemoryStore["listEntries"]>> extends infer T
      ? T extends Array<infer U>
        ? U[]
        : never
      : never
  ): Promise<MemoryOperation[]> {
    if (this.config.extractorMode === "codex") {
      const modelOperations = await this.codexExtractor.extract(evidence, existingEntries);
      if (modelOperations) {
        return modelOperations;
      }
    }

    return this.heuristicExtractor.extract(evidence, existingEntries);
  }
}
