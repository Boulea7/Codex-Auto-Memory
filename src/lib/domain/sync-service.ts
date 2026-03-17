import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AppConfig,
  MemoryEntry,
  MemoryOperation,
  ProcessedRolloutIdentity,
  ProjectContext,
  RolloutEvidence,
  SyncResult
} from "../types.js";
import { MemoryStore } from "./memory-store.js";
import { HeuristicExtractor } from "../extractor/heuristic-extractor.js";
import { CodexExtractor } from "../extractor/codex-extractor.js";
import { filterMemoryOperations } from "../extractor/safety.js";
import type { MemoryExtractorAdapter } from "../runtime/contracts.js";
import { RolloutSessionSource } from "../runtime/rollout-session-source.js";
import { buildMemorySyncAuditEntry } from "./memory-sync-audit.js";

interface ExtractionResult {
  operations: MemoryOperation[];
  actualExtractorMode: AppConfig["extractorMode"];
  actualExtractorName: string;
}

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
    const evidence = await this.sessionSource.parseEvidence(rolloutPath);
    if (!evidence) {
      await this.store.appendSyncAuditEntry(
        buildMemorySyncAuditEntry({
          project: this.project,
          config: this.config,
          rolloutPath,
          configuredExtractorName: this.configuredExtractorName,
          actualExtractorMode: this.configuredExtractorMode,
          actualExtractorName: this.configuredExtractorName,
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

    const processedIdentity = await this.getProcessedRolloutIdentity(rolloutPath, evidence);
    if (!force && (await this.store.hasProcessedRollout(processedIdentity))) {
      await this.store.appendSyncAuditEntry(
        buildMemorySyncAuditEntry({
          project: this.project,
          config: this.config,
          rolloutPath,
          sessionId: evidence.sessionId,
          configuredExtractorName: this.configuredExtractorName,
          actualExtractorMode: this.configuredExtractorMode,
          actualExtractorName: this.configuredExtractorName,
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

    const existingEntries = [
      ...(await this.store.listEntries("global")),
      ...(await this.store.listEntries("project")),
      ...(await this.store.listEntries("project-local"))
    ];

    const extraction = await this.extractOperations(evidence, existingEntries);
    const applied = await this.store.applyOperations(
      filterMemoryOperations(extraction.operations)
    );
    await this.store.appendSyncAuditEntry(
      buildMemorySyncAuditEntry({
        project: this.project,
        config: this.config,
        rolloutPath,
        sessionId: evidence.sessionId,
        configuredExtractorName: this.configuredExtractorName,
        actualExtractorMode: extraction.actualExtractorMode,
        actualExtractorName: extraction.actualExtractorName,
        sessionSource: this.sessionSource.name,
        status: applied.length === 0 ? "no-op" : "applied",
        operations: applied
      })
    );
    await this.store.markRolloutProcessed(processedIdentity);

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
  ): Promise<ExtractionResult> {
    if (this.config.extractorMode === "codex") {
      const modelOperations = await this.primaryExtractor.extract(evidence, existingEntries);
      if (modelOperations) {
        return {
          operations: modelOperations,
          actualExtractorMode: "codex",
          actualExtractorName: this.primaryExtractor.name
        };
      }

      return {
        operations: (await this.fallbackExtractor.extract(evidence, existingEntries)) ?? [],
        actualExtractorMode: "heuristic",
        actualExtractorName: this.fallbackExtractor.name
      };
    }

    return {
      operations: (await this.fallbackExtractor.extract(evidence, existingEntries)) ?? [],
      actualExtractorMode: "heuristic",
      actualExtractorName: this.fallbackExtractor.name
    };
  }

  private async getProcessedRolloutIdentity(
    rolloutPath: string,
    evidence: RolloutEvidence
  ): Promise<ProcessedRolloutIdentity> {
    const stats = await fs.stat(rolloutPath);
    return {
      projectId: this.project.projectId,
      worktreeId: this.project.worktreeId,
      sessionId: evidence.sessionId,
      rolloutPath,
      sizeBytes: stats.size,
      mtimeMs: stats.mtimeMs
    };
  }

  private get configuredExtractorMode(): AppConfig["extractorMode"] {
    return this.config.extractorMode;
  }

  private get configuredExtractorName(): string {
    return this.config.extractorMode === "codex"
      ? this.primaryExtractor.name
      : this.fallbackExtractor.name;
  }
}
