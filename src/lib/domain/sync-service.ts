import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig, MemoryEntry, MemoryOperation, ProjectContext, RolloutEvidence, SyncResult } from "../types.js";
import { MemoryStore } from "./memory-store.js";
import { HeuristicExtractor } from "../extractor/heuristic-extractor.js";
import { CodexExtractor } from "../extractor/codex-extractor.js";
import { filterMemoryOperations } from "../extractor/safety.js";
import type { MemoryExtractorAdapter } from "../runtime/contracts.js";
import { RolloutSessionSource } from "../runtime/rollout-session-source.js";
import { buildMemorySyncAuditEntry } from "./memory-sync-audit.js";

export class SyncService {
  private readonly store: MemoryStore;
  private readonly fallbackExtractor: MemoryExtractorAdapter = new HeuristicExtractor();
  private readonly primaryExtractor: MemoryExtractorAdapter;
  private readonly sessionSource = new RolloutSessionSource();

  public constructor(
    private readonly project: ProjectContext,
    private readonly config: AppConfig,
    schemaRoot = fileURLToPath(new URL("../../../schemas/memory-operations.schema.json", import.meta.url))
  ) {
    this.store = new MemoryStore(project, config);
    this.primaryExtractor = new CodexExtractor(config.codexBinary, schemaRoot);
  }

  public get memoryStore(): MemoryStore {
    return this.store;
  }

  public async syncRollout(rolloutPath: string, force = false): Promise<SyncResult> {
    await this.store.ensureLayout();
    if (!force && (await this.store.hasProcessedRollout(rolloutPath))) {
      await this.store.appendSyncAuditEntry(
        buildMemorySyncAuditEntry({
          project: this.project,
          config: this.config,
          rolloutPath,
          extractorName: this.configuredExtractorName,
          sessionSource: this.sessionSource.name,
          status: "skipped",
          skipReason: "already-processed"
        })
      );
      return {
        applied: [],
        skipped: true,
        message: `Skipped ${rolloutPath}; it was already processed.`
      };
    }

    const evidence = await this.sessionSource.parseEvidence(rolloutPath);
    if (!evidence) {
      await this.store.appendSyncAuditEntry(
        buildMemorySyncAuditEntry({
          project: this.project,
          config: this.config,
          rolloutPath,
          extractorName: this.configuredExtractorName,
          sessionSource: this.sessionSource.name,
          status: "skipped",
          skipReason: "no-rollout-evidence"
        })
      );
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

    const operations = filterMemoryOperations(
      await this.extractOperations(evidence, existingEntries)
    );
    const applied = await this.store.applyOperations(operations);
    await this.store.appendSyncAuditEntry(
      buildMemorySyncAuditEntry({
        project: this.project,
        config: this.config,
        rolloutPath,
        sessionId: evidence.sessionId,
        extractorName: this.configuredExtractorName,
        sessionSource: this.sessionSource.name,
        status: applied.length === 0 ? "no-op" : "applied",
        operations: applied
      })
    );
    await this.store.markRolloutProcessed(rolloutPath);

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
    existingEntries: MemoryEntry[]
  ): Promise<MemoryOperation[]> {
    if (this.config.extractorMode === "codex") {
      const modelOperations = await this.primaryExtractor.extract(evidence, existingEntries);
      if (modelOperations) {
        return modelOperations;
      }
    }

    return (await this.fallbackExtractor.extract(evidence, existingEntries)) ?? [];
  }

  private get configuredExtractorName(): string {
    return this.config.extractorMode === "codex"
      ? this.primaryExtractor.name
      : this.fallbackExtractor.name;
  }
}
