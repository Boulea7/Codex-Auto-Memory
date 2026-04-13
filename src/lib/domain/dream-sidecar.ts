import fs from "node:fs/promises";
import path from "node:path";
import type { RuntimeContext } from "../runtime/runtime-context.js";
import type {
  DreamContinuityLayer,
  DreamPromotionCandidate,
  DreamRelevantMemoryRef,
  DreamSidecarAuditEntry,
  DreamSidecarInspection,
  DreamSidecarPaths,
  DreamSidecarRecoveryRecord,
  DreamSidecarSnapshot,
  DreamSidecarSummary,
  RolloutProvenanceKind,
  SessionContinuityScope
} from "../types.js";
import { appendJsonl, fileExists, readJsonFile, writeJsonFileAtomic } from "../util/fs.js";
import { getDefaultMemoryDirectory } from "./project-context.js";
import { findLatestProjectRollout, parseRolloutEvidence } from "./rollout.js";
import { SessionContinuitySummarizer } from "../extractor/session-continuity-summarizer.js";
import { listDreamCandidates, reconcileDreamCandidates } from "./dream-candidates.js";
import { inspectTeamMemory, rebuildTeamMemoryIndex } from "./team-memory.js";

interface BuildDreamSnapshotOptions {
  runtime: RuntimeContext;
  rolloutPath: string;
}

interface PersistDreamSnapshotOptions {
  runtime: RuntimeContext;
  snapshot: DreamSidecarSnapshot;
  scope: SessionContinuityScope | "both";
}

interface DreamSnapshotReadResult {
  summary: DreamSidecarSummary;
  snapshot: DreamSidecarSnapshot | null;
}

export interface PersistedDreamSnapshotResult {
  snapshot: DreamSidecarSnapshot;
  snapshotPaths: string[];
  auditPath: string;
  recoveryPath: string;
}

function toDreamLayer(summary: {
  goal: string;
  confirmedWorking: string[];
  triedAndFailed: string[];
  notYetTried: string[];
  incompleteNext: string[];
  filesDecisionsEnvironment: string[];
}): DreamContinuityLayer {
  return {
    goal: summary.goal,
    confirmedWorking: [...summary.confirmedWorking],
    triedAndFailed: [...summary.triedAndFailed],
    notYetTried: [...summary.notYetTried],
    incompleteNext: [...summary.incompleteNext],
    filesDecisionsEnvironment: [...summary.filesDecisionsEnvironment]
  };
}

function buildDreamPaths(runtime: RuntimeContext): DreamSidecarPaths {
  const baseDir = runtime.loadedConfig.config.autoMemoryDirectory ?? getDefaultMemoryDirectory();
  const dreamBaseDir = path.join(baseDir, "projects", runtime.project.projectId, "dream");
  const auditDir = path.join(baseDir, "projects", runtime.project.projectId, "audit");

  return {
    sharedDir: path.join(dreamBaseDir, "shared"),
    sharedFile: path.join(dreamBaseDir, "shared", "latest.json"),
    localDir: path.join(dreamBaseDir, "locals", runtime.project.worktreeId),
    localFile: path.join(dreamBaseDir, "locals", runtime.project.worktreeId, "latest.json"),
    reviewDir: path.join(dreamBaseDir, "review"),
    registryFile: path.join(dreamBaseDir, "review", "registry.json"),
    auditDir,
    auditFile: path.join(auditDir, "dream-sidecar-log.jsonl"),
    recoveryFile: path.join(auditDir, "dream-sidecar-recovery.json"),
    candidateAuditFile: path.join(auditDir, "dream-candidate-log.jsonl"),
    candidateRecoveryFile: path.join(auditDir, "dream-candidate-recovery.json")
  };
}

function buildSearchQueries(snapshot: DreamSidecarSnapshot): Array<{
  source: DreamPromotionCandidate["sourceSection"];
  text: string;
}> {
  const stopWords = new Set([
    "this",
    "that",
    "with",
    "from",
    "into",
    "continue",
    "latest",
    "request",
    "repository",
    "project",
    "work",
    "using",
    "keep"
  ]);
  const priorityTerms = new Set([
    "pnpm",
    "npm",
    "bun",
    "yarn",
    "vitest",
    "jest",
    "playwright",
    "build",
    "lint",
    "test",
    "tsc",
    "vite",
    "next",
    "runbook",
    "dashboard",
    "grafana"
  ]);
  const queries: Array<{ source: DreamPromotionCandidate["sourceSection"]; text: string }> = [];
  const layers = [snapshot.continuityCompaction.project, snapshot.continuityCompaction.projectLocal];
  const seenTexts = new Set<string>();

  const pushDerivedQueries = (
    source: DreamPromotionCandidate["sourceSection"],
    text: string
  ): void => {
    const normalized = text.trim();
    if (!normalized) {
      return;
    }

    const candidates = normalized
      .toLowerCase()
      .split(/[^a-z0-9`]+/u)
      .map((term) => term.trim())
      .filter((term) => term.length >= 4 && !stopWords.has(term));

    const rankedCandidates = candidates
      .map((term, index) => ({
        term,
        index,
        priority: priorityTerms.has(term) ? 0 : 1
      }))
      .sort((left, right) =>
        left.priority === right.priority ? left.index - right.index : left.priority - right.priority
      )
      .map((entry) => entry.term);

    const phrases = rankedCandidates.length > 0 ? rankedCandidates.slice(0, 4) : [normalized];
    for (const phrase of phrases) {
      if (seenTexts.has(phrase)) {
        continue;
      }
      seenTexts.add(phrase);
      queries.push({ source, text: phrase });
    }
  };

  for (const layer of layers) {
    if (layer.goal.trim()) {
      pushDerivedQueries("goal", layer.goal);
    }
    for (const item of layer.incompleteNext) {
      pushDerivedQueries("incompleteNext", item);
    }
    for (const item of layer.filesDecisionsEnvironment.slice(0, 2)) {
      pushDerivedQueries("filesDecisionsEnvironment", item);
    }
  }

  return queries;
}

function candidateFromItem(
  sourceSection: DreamPromotionCandidate["sourceSection"],
  continuityScopeHint: DreamPromotionCandidate["continuityScopeHint"],
  text: string,
  reason: string
): DreamPromotionCandidate {
  return {
    summary: text,
    details: [text],
    reason,
    continuityScopeHint,
    sourceSection
  };
}

function buildPromotionCandidates(snapshot: DreamSidecarSnapshot): DreamSidecarSnapshot["promotionCandidates"] {
  const instructionLikeCandidates: DreamPromotionCandidate[] = [];
  const durableMemoryCandidates: DreamPromotionCandidate[] = [];
  const layers: Array<{
    scope: DreamPromotionCandidate["continuityScopeHint"];
    layer: DreamContinuityLayer;
  }> = [
    {
      scope: "project",
      layer: snapshot.continuityCompaction.project
    },
    {
      scope: "project-local",
      layer: snapshot.continuityCompaction.projectLocal
    }
  ];
  const instructionPattern = /\b(prefer|always|never|must|should|do not|don't)\b/i;

  for (const { scope, layer } of layers) {
    const sections: Array<[DreamPromotionCandidate["sourceSection"], string[]]> = [
      ["goal", layer.goal ? [layer.goal] : []],
      ["confirmedWorking", layer.confirmedWorking],
      ["triedAndFailed", layer.triedAndFailed],
      ["notYetTried", layer.notYetTried],
      ["incompleteNext", layer.incompleteNext],
      ["filesDecisionsEnvironment", layer.filesDecisionsEnvironment]
    ];

    for (const [sourceSection, values] of sections) {
      for (const value of values.slice(0, 4)) {
        const text = value.trim();
        if (!text) {
          continue;
        }

        const candidate = candidateFromItem(
          sourceSection,
          scope,
          text,
          `Dream sidecar candidate from ${sourceSection}.`
        );
        if (instructionPattern.test(text)) {
          instructionLikeCandidates.push(candidate);
        } else if (sourceSection !== "incompleteNext") {
          durableMemoryCandidates.push(candidate);
        }
      }
    }
  }

  return {
    instructionLikeCandidates: instructionLikeCandidates.slice(0, 6),
    durableMemoryCandidates: durableMemoryCandidates.slice(0, 6)
  };
}

export async function buildDreamSnapshot(
  options: BuildDreamSnapshotOptions
): Promise<DreamSidecarSnapshot> {
  const evidence = await parseRolloutEvidence(options.rolloutPath);
  if (!evidence) {
    throw new Error(`Could not parse rollout evidence from ${options.rolloutPath}.`);
  }

  const existingState = {
    project: await options.runtime.sessionContinuityStore.readState("project"),
    projectLocal: await options.runtime.sessionContinuityStore.readState("project-local")
  };
  const summarizer = new SessionContinuitySummarizer(options.runtime.loadedConfig.config);
  const generation = await summarizer.summarizeWithDiagnostics(evidence, existingState);
  const teamMemory = await rebuildTeamMemoryIndex(
    options.runtime.project,
    options.runtime.loadedConfig.config
  );
  const snapshot: DreamSidecarSnapshot = {
    version: 1,
    generatedAt: generation.diagnostics.generatedAt,
    projectId: options.runtime.project.projectId,
    worktreeId: options.runtime.project.worktreeId,
    rolloutPath: options.rolloutPath,
    sourceProvenanceKind: evidence.provenanceKind,
    continuityCompaction: {
      project: toDreamLayer(generation.summary.project),
      projectLocal: toDreamLayer(generation.summary.projectLocal)
    },
    relevantMemoryRefs: [],
    promotionCandidates: {
      instructionLikeCandidates: [],
      durableMemoryCandidates: []
    },
    teamMemory: teamMemory.summary
  };

  const seenRefs = new Set<string>();
  const relevantMemoryRefs: DreamRelevantMemoryRef[] = [];
  for (const query of buildSearchQueries(snapshot)) {
    const search = await options.runtime.syncService.memoryStore.searchEntriesWithDiagnostics(query.text, {
      scope: "all",
      state: "active",
      limit: 3
    });
    for (const result of search.results) {
      if (seenRefs.has(result.ref)) {
        continue;
      }

      seenRefs.add(result.ref);
      relevantMemoryRefs.push({
        ref: result.ref,
        reason: `Matched dream ${query.source} query: ${query.text}`,
        approxReadCost: result.approxReadCost,
        matchedQuery: query.text
      });
    }
  }

  snapshot.relevantMemoryRefs = relevantMemoryRefs.slice(0, 8);
  snapshot.promotionCandidates = buildPromotionCandidates(snapshot);
  return snapshot;
}

async function writeDreamRecoveryRecord(
  recoveryPath: string,
  record: DreamSidecarRecoveryRecord
): Promise<void> {
  await writeJsonFileAtomic(recoveryPath, record);
}

export async function persistDreamSnapshot(
  options: PersistDreamSnapshotOptions
): Promise<PersistedDreamSnapshotResult> {
  const paths = buildDreamPaths(options.runtime);
  const targets =
    options.scope === "both"
      ? [paths.sharedFile, paths.localFile]
      : [options.scope === "project" ? paths.sharedFile : paths.localFile];
  const writtenPaths: string[] = [];

  try {
    for (const target of targets) {
      await writeJsonFileAtomic(target, options.snapshot);
      writtenPaths.push(target);
    }
  } catch (error) {
    await Promise.all(writtenPaths.map((target) => fs.rm(target, { force: true })));
    await writeDreamRecoveryRecord(paths.recoveryFile, {
      recordedAt: new Date().toISOString(),
      projectId: options.runtime.project.projectId,
      worktreeId: options.runtime.project.worktreeId,
      rolloutPath: options.snapshot.rolloutPath,
      failedStage: "snapshot-write",
      failureMessage: error instanceof Error ? error.message : String(error),
      snapshotPaths: writtenPaths
    });
    throw error;
  }

  const auditEntry: DreamSidecarAuditEntry = {
    generatedAt: options.snapshot.generatedAt,
    projectId: options.runtime.project.projectId,
    worktreeId: options.runtime.project.worktreeId,
    rolloutPath: options.snapshot.rolloutPath,
    sourceProvenanceKind: options.snapshot.sourceProvenanceKind,
    snapshotPaths: writtenPaths,
    relevantMemoryRefCount: options.snapshot.relevantMemoryRefs.length,
    pendingPromotionCount:
      options.snapshot.promotionCandidates.instructionLikeCandidates.length +
      options.snapshot.promotionCandidates.durableMemoryCandidates.length
  };

  try {
    await appendJsonl(paths.auditFile, auditEntry);
    await fs.rm(paths.recoveryFile, { force: true });
  } catch (error) {
    await writeDreamRecoveryRecord(paths.recoveryFile, {
      recordedAt: new Date().toISOString(),
      projectId: options.runtime.project.projectId,
      worktreeId: options.runtime.project.worktreeId,
      rolloutPath: options.snapshot.rolloutPath,
      failedStage: "audit-write",
      failureMessage: error instanceof Error ? error.message : String(error),
      snapshotPaths: writtenPaths
    });
    throw error;
  }

  return {
    snapshot: options.snapshot,
    snapshotPaths: writtenPaths,
    auditPath: paths.auditFile,
    recoveryPath: paths.recoveryFile
  };
}

function shouldRefreshDreamSnapshot(
  status: DreamSidecarSummary["status"],
  rolloutPath: string | null,
  latestPrimaryRollout: string
): boolean {
  return status !== "available" || rolloutPath !== latestPrimaryRollout;
}

async function readDreamSnapshotSummary(
  enabled: boolean,
  autoBuild: boolean,
  filePath: string
): Promise<DreamSnapshotReadResult> {
  if (!enabled) {
    return {
      summary: {
        enabled,
        autoBuild,
        status: "disabled",
        latestPath: null,
        generatedAt: null,
        rolloutPath: null,
        relevantMemoryRefCount: 0,
        pendingPromotionCount: 0,
        suggestedRefCount: 0
      },
      snapshot: null
    };
  }

  if (!(await fileExists(filePath))) {
    return {
      summary: {
        enabled,
        autoBuild,
        status: "missing",
        latestPath: null,
        generatedAt: null,
        rolloutPath: null,
        relevantMemoryRefCount: 0,
        pendingPromotionCount: 0,
        suggestedRefCount: 0
      },
      snapshot: null
    };
  }

  try {
    const snapshot = await readJsonFile<DreamSidecarSnapshot>(filePath);
    if (!snapshot) {
      throw new Error("missing snapshot");
    }

    return {
      summary: {
        enabled,
        autoBuild,
        status: "available",
        latestPath: filePath,
        generatedAt: snapshot.generatedAt,
        rolloutPath: snapshot.rolloutPath,
        relevantMemoryRefCount: snapshot.relevantMemoryRefs.length,
        pendingPromotionCount:
          snapshot.promotionCandidates.instructionLikeCandidates.length +
          snapshot.promotionCandidates.durableMemoryCandidates.length,
        suggestedRefCount: snapshot.relevantMemoryRefs.length,
        teamMemory: snapshot.teamMemory
      },
      snapshot
    };
  } catch {
    return {
      summary: {
        enabled,
        autoBuild,
        status: "invalid",
        latestPath: filePath,
        generatedAt: null,
        rolloutPath: null,
        relevantMemoryRefCount: 0,
        pendingPromotionCount: 0,
        suggestedRefCount: 0
      },
      snapshot: null
    };
  }
}

export async function inspectDreamSidecar(
  runtime: RuntimeContext
): Promise<DreamSidecarInspection & { projectSnapshot: DreamSidecarSnapshot | null; projectLocalSnapshot: DreamSidecarSnapshot | null }> {
  const paths = buildDreamPaths(runtime);
  const enabled = runtime.loadedConfig.config.dreamSidecarEnabled === true;
  const autoBuild = runtime.loadedConfig.config.dreamSidecarAutoBuild === true;
  const teamInspection = await inspectTeamMemory(runtime.project, runtime.loadedConfig.config, {
    autoBuild
  });
  const projectSnapshot = await readDreamSnapshotSummary(enabled, autoBuild, paths.sharedFile);
  const projectLocalSnapshot = await readDreamSnapshotSummary(enabled, autoBuild, paths.localFile);
  const candidateQueue = await listDreamCandidates(runtime);

  return {
    enabled,
    autoBuild,
    snapshots: {
      project: {
        ...projectSnapshot.summary,
        teamMemory: teamInspection.summary,
        queueSummary: candidateQueue.summary,
        candidateRegistryPath: candidateQueue.registryPath,
        candidateAuditPath: candidateQueue.auditPath
      },
      projectLocal: {
        ...projectLocalSnapshot.summary,
        teamMemory: teamInspection.summary,
        queueSummary: candidateQueue.summary,
        candidateRegistryPath: candidateQueue.registryPath,
        candidateAuditPath: candidateQueue.auditPath
      }
    },
    auditPath: paths.auditFile,
    recoveryPath: paths.recoveryFile,
    queueSummary: candidateQueue.summary,
    candidateRegistryPath: candidateQueue.registryPath,
    candidateAuditPath: candidateQueue.auditPath,
    candidateRecoveryPath: candidateQueue.recoveryPath,
    projectSnapshot: projectSnapshot.snapshot,
    projectLocalSnapshot: projectLocalSnapshot.snapshot
  };
}

export async function ensureDreamSidecarFresh(
  runtime: RuntimeContext
): Promise<DreamSidecarInspection & { projectSnapshot: DreamSidecarSnapshot | null; projectLocalSnapshot: DreamSidecarSnapshot | null }> {
  const inspection = await inspectDreamSidecar(runtime);
  if (!inspection.enabled || !inspection.autoBuild) {
    return inspection;
  }

  const latestPrimaryRollout = await findLatestProjectRollout(runtime.project);
  if (!latestPrimaryRollout) {
    return inspection;
  }

  if (
    !shouldRefreshDreamSnapshot(
      inspection.snapshots.project.status,
      inspection.snapshots.project.rolloutPath,
      latestPrimaryRollout
    ) &&
    !shouldRefreshDreamSnapshot(
      inspection.snapshots.projectLocal.status,
      inspection.snapshots.projectLocal.rolloutPath,
      latestPrimaryRollout
    )
  ) {
    return inspection;
  }

  const snapshot = await buildDreamSnapshot({
    runtime,
    rolloutPath: latestPrimaryRollout
  });
  const persisted = await persistDreamSnapshot({
    runtime,
    snapshot,
    scope: "both"
  });
  await reconcileDreamCandidates(runtime, snapshot, persisted.snapshotPaths);
  return inspectDreamSidecar(runtime);
}

export function filterDreamRelevantRefs(
  refs: DreamRelevantMemoryRef[],
  query: string
): DreamRelevantMemoryRef[] {
  const normalizedTerms = query
    .toLowerCase()
    .split(/\s+/u)
    .map((term) => term.trim())
    .filter(Boolean);
  if (normalizedTerms.length === 0) {
    return refs.slice(0, 3);
  }

  return refs
    .filter((ref) =>
      normalizedTerms.every((term) => `${ref.reason}\n${ref.matchedQuery}`.toLowerCase().includes(term))
    )
    .slice(0, 3);
}
