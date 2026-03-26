import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AppConfig,
  MemoryApplyRecord,
  MemoryConflictCandidate,
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
import { reviewExtractedMemoryOperations } from "../extractor/contradiction-review.js";
import { filterMemoryOperations } from "../extractor/safety.js";
import type { MemoryExtractorAdapter } from "../runtime/contracts.js";
import { RolloutSessionSource } from "../runtime/rollout-session-source.js";
import { buildMemorySyncAuditEntry } from "./memory-sync-audit.js";
import { buildSyncRecoveryRecord, matchesSyncRecoveryRecord } from "./recovery-records.js";

interface ExtractionResult {
  operations: MemoryOperation[];
  actualExtractorMode: AppConfig["extractorMode"];
  actualExtractorName: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toAppliedOperation(record: MemoryApplyRecord): MemoryOperation | null {
  if (record.lifecycleAction === "noop") {
    return null;
  }

  return {
    action: record.operation.action === "archive" ? "delete" : record.operation.action,
    scope: record.operation.scope,
    topic: record.operation.topic,
    id: record.operation.id,
    summary: record.operation.summary,
    details: record.operation.details,
    sources: record.operation.sources,
    reason: record.operation.reason
  };
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
    const existingRecoveryRecord = await this.store.readSyncRecoveryRecord();
    const isRecovery =
      existingRecoveryRecord !== null &&
      matchesSyncRecoveryRecord(existingRecoveryRecord, {
        projectId: this.project.projectId,
        worktreeId: this.project.worktreeId,
        rolloutPath,
        sessionId: evidence.sessionId
      });

    if (!force && (await this.store.hasProcessedRollout(processedIdentity))) {
      if (isRecovery) {
        await this.clearSyncRecoveryRecordBestEffort({
          rolloutPath,
          sessionId: evidence.sessionId
        });
      }
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
          skipReason: "already-processed",
          ...(isRecovery ? { isRecovery: true } : {})
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
    const reviewedOperations = reviewExtractedMemoryOperations(
      filterMemoryOperations(extraction.operations),
      existingEntries
    );
    const applyRecords = await this.store.applyMutations(reviewedOperations.operations);
    const applied = applyRecords.flatMap((record) => {
      const operation = toAppliedOperation(record);
      return operation ? [operation] : [];
    });
    const noopOperationCount = applyRecords.filter(
      (record) => record.lifecycleAction === "noop"
    ).length;
    const status = applied.length === 0 ? "no-op" : "applied";
    const auditEntry = buildMemorySyncAuditEntry({
      project: this.project,
      config: this.config,
      rolloutPath,
      sessionId: evidence.sessionId,
      configuredExtractorName: this.configuredExtractorName,
      actualExtractorMode: extraction.actualExtractorMode,
      actualExtractorName: extraction.actualExtractorName,
      sessionSource: this.sessionSource.name,
      status,
      noopOperationCount,
      suppressedOperationCount: reviewedOperations.suppressedOperationCount,
      conflicts: reviewedOperations.conflicts,
      operations: applied,
      ...(isRecovery ? { isRecovery: true } : {})
    });

    try {
      await this.store.appendSyncAuditEntry(auditEntry);
    } catch (error) {
      await this.writeSyncRecoveryRecord({
        rolloutPath,
        sessionId: evidence.sessionId,
        actualExtractorMode: extraction.actualExtractorMode,
        actualExtractorName: extraction.actualExtractorName,
        status,
        appliedCount: auditEntry.appliedCount,
        noopOperationCount: auditEntry.noopOperationCount ?? 0,
        suppressedOperationCount: auditEntry.suppressedOperationCount ?? 0,
        scopesTouched: auditEntry.scopesTouched,
        conflicts: auditEntry.conflicts ?? [],
        failedStage: "audit-write",
        failureMessage: errorMessage(error),
        auditEntryWritten: false
      });
      throw error;
    }

    try {
      await this.store.markRolloutProcessed(processedIdentity);
    } catch (error) {
      await this.writeSyncRecoveryRecord({
        rolloutPath,
        sessionId: evidence.sessionId,
        actualExtractorMode: extraction.actualExtractorMode,
        actualExtractorName: extraction.actualExtractorName,
        status,
        appliedCount: auditEntry.appliedCount,
        noopOperationCount: auditEntry.noopOperationCount ?? 0,
        suppressedOperationCount: auditEntry.suppressedOperationCount ?? 0,
        scopesTouched: auditEntry.scopesTouched,
        conflicts: auditEntry.conflicts ?? [],
        failedStage: "processed-state-write",
        failureMessage: errorMessage(error),
        auditEntryWritten: true
      });
      throw error;
    }

    await this.clearSyncRecoveryRecordBestEffort({
      rolloutPath,
      sessionId: evidence.sessionId
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

  private async writeSyncRecoveryRecord(options: {
    rolloutPath: string;
    sessionId?: string;
    actualExtractorMode: AppConfig["extractorMode"];
    actualExtractorName: string;
    status: "applied" | "no-op";
    appliedCount: number;
    noopOperationCount: number;
    suppressedOperationCount: number;
    scopesTouched: MemoryOperation["scope"][];
    conflicts: MemoryConflictCandidate[];
    failedStage: "audit-write" | "processed-state-write";
    failureMessage: string;
    auditEntryWritten: boolean;
  }): Promise<void> {
    try {
      await this.store.writeSyncRecoveryRecord(
        buildSyncRecoveryRecord({
          projectId: this.project.projectId,
          worktreeId: this.project.worktreeId,
          rolloutPath: options.rolloutPath,
          sessionId: options.sessionId,
          configuredExtractorMode: this.configuredExtractorMode,
          configuredExtractorName: this.configuredExtractorName,
          actualExtractorMode: options.actualExtractorMode,
          actualExtractorName: options.actualExtractorName,
          status: options.status,
          appliedCount: options.appliedCount,
          noopOperationCount: options.noopOperationCount,
          suppressedOperationCount: options.suppressedOperationCount,
          scopesTouched: options.scopesTouched,
          conflicts: options.conflicts,
          failedStage: options.failedStage,
          failureMessage: options.failureMessage,
          auditEntryWritten: options.auditEntryWritten
        })
      );
    } catch {
      // Best-effort marker persistence should not overwrite the original failure.
    }
  }

  private async clearSyncRecoveryRecordBestEffort(identity: {
    rolloutPath: string;
    sessionId?: string;
  }): Promise<void> {
    try {
      const record = await this.store.readSyncRecoveryRecord();
      if (!record) {
        return;
      }
      if (
        !matchesSyncRecoveryRecord(record, {
          projectId: this.project.projectId,
          worktreeId: this.project.worktreeId,
          rolloutPath: identity.rolloutPath,
          sessionId: identity.sessionId
        })
      ) {
        return;
      }
      await this.store.clearSyncRecoveryRecord();
    } catch {
      // Best-effort cleanup should not fail an otherwise successful sync.
    }
  }
}
