import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_MEMORY_TOPICS } from "../constants.js";
import type {
  MemoryAppliedLifecycle,
  AppConfig,
  MemoryApplyRecord,
  MemoryDetailsResult,
  MemoryEntry,
  MemoryLayoutDiagnostic,
  MemoryLifecycleAttempt,
  MemoryHistoryRecordState,
  MemoryLineageSummary,
  MemoryMutation,
  MemoryOperation,
  MemoryReindexCheck,
  MemoryRecordState,
  MemorySearchDiagnosticPath,
  MemorySearchDiagnostics,
  MemoryRetrievalFallbackReason,
  MemoryRetrievalMode,
  MemorySearchResult,
  MemoryScope,
  MemorySyncAuditSummary,
  MemorySyncAuditEntry,
  MemoryTimelineEvent,
  MemoryTimelineResponse,
  ProcessedRolloutIdentity,
  ProcessedRolloutRecord,
  ProjectContext,
  ScopePaths,
  SyncRecoveryRecord,
  TopicFileRef
} from "../types.js";
import {
  appendJsonl,
  ensureDir,
  fileExists,
  readJsonFile,
  readTextFile,
  writeJsonFile,
  writeTextFileAtomic
} from "../util/fs.js";
import { parseMemorySyncAuditEntry } from "./memory-sync-audit.js";
import {
  matchesAllMemoryQueryTerms,
  normalizeMemoryQueryTerms
} from "./memory-query.js";
import {
  buildMemoryRef,
  classifyUpdateKind,
  classifyUpsertLifecycle,
  isMemoryHistoryRecordState,
  nextHistoryStateForLifecycle,
  parseMemoryRef
} from "./memory-lifecycle.js";
import { normalizeMemorySearchDiagnostics } from "./memory-retrieval-contract.js";
import { getDefaultMemoryDirectory } from "./project-context.js";
import {
  isSyncRecoveryRecord,
  normalizeSyncRecoveryRecord
} from "./recovery-records.js";

interface SyncState {
  processedRollouts?: Record<string, string>;
  processedRolloutEntries?: ProcessedRolloutRecord[];
}

interface EntryMetadata {
  id: string;
  scope: MemoryScope;
  updatedAt: string;
  sources?: string[];
  reason?: string;
}

interface TopicFileParseResult {
  entries: MemoryEntry[];
  safeToRewrite: boolean;
  invalidEntryBlockCount: number;
  manualContentDetected: boolean;
  unsafeReason?: string;
}

interface SearchMatch {
  matchedFields: string[];
  score: number;
}

interface RetrievalIndexEntry {
  ref: string;
  scope: MemoryScope;
  state: MemoryRecordState;
  topic: string;
  id: string;
  summary: string;
  updatedAt: string;
  approxReadCost: number;
  summaryText: string;
  detailsText: string;
}

interface RetrievalIndexPayload {
  version: 1;
  scope: MemoryScope;
  state: MemoryRecordState;
  generatedAt: string;
  topicFiles: string[];
  topicFileCount: number;
  entries: RetrievalIndexEntry[];
}

interface RetrievalIndexInspection {
  status: "ok" | "missing" | "invalid" | "stale";
  indexPath: string;
  payload: RetrievalIndexPayload | null;
  fallbackReason?: MemoryRetrievalFallbackReason;
  generatedAt: string | null;
  topicFileCount: number | null;
  topicFiles: string[];
}

interface MemorySearchExecution {
  results: MemorySearchResult[];
  searchOrder: string[];
  totalMatchedCount: number;
  returnedCount: number;
  globalLimitApplied: boolean;
  truncatedCount: number;
  resultWindow: {
    start: number;
    end: number;
    limit: number;
  };
  retrievalMode: MemoryRetrievalMode;
  retrievalFallbackReason?: MemoryRetrievalFallbackReason;
  diagnostics: MemorySearchDiagnostics;
}

export interface RetrievalSidecarCheck {
  scope: MemoryScope;
  state: MemoryRecordState;
  status: RetrievalIndexInspection["status"];
  indexPath: string;
  fallbackReason?: MemoryRetrievalFallbackReason;
  generatedAt: string | null;
  topicFileCount: number | null;
  topicFiles: string[];
}

export interface TopicFileDiagnostic {
  scope: MemoryScope;
  state: MemoryRecordState;
  topic: string;
  path: string;
  safeToRewrite: boolean;
  entryCount: number;
  invalidEntryBlockCount: number;
  manualContentDetected: boolean;
  unsafeReason?: string;
}

export function filterUnsafeTopicDiagnostics(
  diagnostics: TopicFileDiagnostic[]
): TopicFileDiagnostic[] {
  return diagnostics.filter((diagnostic) => !diagnostic.safeToRewrite);
}

interface HistoryReadResult {
  events: MemoryTimelineEvent[];
  warnings: string[];
  historyPath: string;
}

interface TimelineReadResult extends MemoryTimelineResponse {
  latestAudit: MemorySyncAuditSummary | null;
  latestEvent: MemoryTimelineEvent | null;
  latestAttempt: MemoryTimelineEvent | null;
}

interface SyncAuditReadResult {
  entries: MemorySyncAuditEntry[];
  warnings: string[];
}

interface PlannedFileChange {
  path: string;
  contents: string | null;
}

interface FileSnapshot {
  path: string;
  contents: string | null;
}

interface ScopeMutationState {
  activeEntries: MemoryEntry[];
  archivedEntries: MemoryEntry[];
  historyRaw: string | null;
  historyAppends: MemoryTimelineEvent[];
  activeTopicsTouched: Set<string>;
  archivedTopicsTouched: Set<string>;
  activeIndexTouched: boolean;
  archiveIndexTouched: boolean;
}

interface MutationCommitPlan {
  applied: MemoryApplyRecord[];
  fileChanges: PlannedFileChange[];
}

interface MemoryStoreFileOps {
  writeTextFile(filePath: string, contents: string): Promise<void>;
  deleteFile(filePath: string): Promise<void>;
}

const topicNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const retrievalIndexVersion = 1 as const;
function buildSearchDiagnosticKey(scope: MemoryScope, state: MemoryRecordState): string {
  return `${scope}:${state}`;
}

function buildUnsafeTopicKey(
  scope: MemoryScope,
  state: MemoryRecordState,
  topic: string
): string {
  return `${scope}:${state}:${topic}`;
}

function topicTitle(topic: string): string {
  return topic
    .split(/[-_]/g)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeTopicName(topic: string): string {
  const normalized = topic.trim().toLowerCase();
  if (!topicNamePattern.test(normalized)) {
    throw new Error(
      "Topic names must use lowercase kebab-case and may only contain letters, numbers, and hyphens."
    );
  }

  return normalized;
}

function entryBlock(entry: MemoryEntry): string {
  const metadata = {
    id: entry.id,
    scope: entry.scope,
    updatedAt: entry.updatedAt,
    sources: entry.sources,
    reason: entry.reason
  };

  return [
    `## ${entry.id}`,
    `<!-- cam:entry ${JSON.stringify(metadata)} -->`,
    `Summary: ${entry.summary}`,
    "Details:",
    ...entry.details.map((detail) => `- ${detail}`),
    ""
  ].join("\n");
}

function topicFileHeader(topic: string): string {
  return [
    `# ${topicTitle(topic)}`,
    "",
    `<!-- cam:topic ${topic} -->`,
    "",
    "This file is maintained by Codex Auto Memory. You may edit summaries or details directly.",
    ""
  ].join("\n");
}

function normalizeManagedText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function parseEntryBlock(block: string): MemoryEntry | null {
  const headingMatch = block.match(/^##\s+(.+)$/m);
  const metadataMatch = block.match(/<!-- cam:entry (.+?) -->/);
  const summaryMatch = block.match(/^Summary:\s+(.+)$/m);
  const detailsSection = block.match(/^Details:\n([\s\S]*)$/m);

  if (!headingMatch || !metadataMatch || !summaryMatch || !detailsSection) {
    return null;
  }

  const metadataRaw = metadataMatch[1];
  const detailsRaw = detailsSection[1];
  const summaryRaw = summaryMatch[1];
  const headingRaw = headingMatch[1];
  if (!metadataRaw || !detailsRaw || !summaryRaw || !headingRaw) {
    return null;
  }

  let metadata: EntryMetadata;
  try {
    const parsed = JSON.parse(metadataRaw) as unknown;
    if (!isEntryMetadata(parsed)) {
      return null;
    }
    metadata = parsed;
  } catch {
    return null;
  }

  const detailLines = detailsRaw.split("\n");
  const hasUnsupportedDetailText = detailLines.some((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !line.startsWith("- ");
  });
  if (hasUnsupportedDetailText) {
    return null;
  }

  const details = detailLines
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);

  return {
    id: metadata.id ?? headingRaw.trim(),
    scope: metadata.scope,
    topic: "workflow",
    summary: summaryRaw.trim(),
    details,
    updatedAt: metadata.updatedAt,
    sources: metadata.sources ?? [],
    reason: metadata.reason
  };
}

function parseTopicFile(contents: string, topic: string): TopicFileParseResult {
  const firstBlockIndex = contents.search(/^## /m);
  const prelude = firstBlockIndex >= 0 ? contents.slice(0, firstBlockIndex) : contents;
  const rawBlocks =
    firstBlockIndex >= 0
      ? contents
          .slice(firstBlockIndex)
          .split(/^## /m)
          .slice(1)
          .map((rawBlock) => `## ${rawBlock}`.trim())
      : [];

  const entries: MemoryEntry[] = [];
  let unsafeReason: string | undefined;
  let invalidEntryBlockCount = 0;
  for (const block of rawBlocks) {
    const parsed = parseEntryBlock(block);
    if (!parsed) {
      unsafeReason ??= "it contains malformed or unsupported entry blocks";
      invalidEntryBlockCount += 1;
      continue;
    }

    entries.push({
      ...parsed,
      topic
    });
  }

  const manualContentDetected =
    normalizeManagedText(prelude) !== normalizeManagedText(topicFileHeader(topic));
  if (manualContentDetected) {
    unsafeReason ??= "it contains unsupported manual content outside managed memory entries";
  }

  return {
    entries,
    safeToRewrite: unsafeReason === undefined,
    invalidEntryBlockCount,
    manualContentDetected,
    unsafeReason
  };
}

function topicFileContents(topic: string, entries: MemoryEntry[]): string {
  const header = topicFileHeader(topic);

  const blocks = entries
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((entry) => entryBlock(entry))
    .join("\n");

  return `${header}${blocks}`.trimEnd() + "\n";
}

function sortEntriesByUpdatedAt(entries: MemoryEntry[]): MemoryEntry[] {
  return [...entries].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function buildIndexContents(scope: MemoryScope, entries: MemoryEntry[]): string {
  const sortedEntries = sortEntriesByUpdatedAt(entries);
  const topicSections = sortedEntries.length
    ? Array.from(new Set(sortedEntries.map((entry) => entry.topic))).map((topic) => {
        const topicEntries = sortedEntries.filter((entry) => entry.topic === topic);
        const count = topicEntries.length;
        return `- [${topic}.md](${topic}.md): ${count} entr${count === 1 ? "y" : "ies"}`;
      })
    : ["- No topic files yet."];
  const lines = [
    `# ${topicTitle(scope)} Memory`,
    "",
    "This file is the concise startup index for this scope.",
    "It is intentionally short so it can be injected into Codex at session start.",
    "",
    "## Topics",
    ...topicSections
  ];

  return `${lines.join("\n")}\n`;
}

function buildArchiveIndexContents(scope: MemoryScope, entries: MemoryEntry[]): string {
  const sortedEntries = sortEntriesByUpdatedAt(entries);
  const lines = [
    `# Archived ${topicTitle(scope)} Memory`,
    "",
    "This file indexes archived memory that stays inspectable but does not participate in default startup recall.",
    "",
    "## Topics",
    ...(sortedEntries.length
      ? Array.from(new Set(sortedEntries.map((entry) => entry.topic))).map((topic) => {
          const count = sortedEntries.filter((entry) => entry.topic === topic).length;
          return `- [${topic}.md](${topic}.md): ${count} entr${count === 1 ? "y" : "ies"}`;
        })
      : ["- No archived topic files yet."])
  ];

  return `${lines.join("\n")}\n`;
}

function buildRetrievalIndexEntries(
  scope: MemoryScope,
  state: MemoryRecordState,
  entries: MemoryEntry[]
): RetrievalIndexEntry[] {
  return sortEntriesByUpdatedAt(entries).map((entry) => ({
    ref: buildMemoryRef(scope, state, entry.topic, entry.id),
    scope,
    state,
    topic: entry.topic,
    id: entry.id,
    summary: entry.summary,
    updatedAt: entry.updatedAt,
    approxReadCost: entry.details.length + 4,
    summaryText: entry.summary.toLowerCase(),
    detailsText: entry.details.join("\n").toLowerCase()
  }));
}

function buildRetrievalIndexContents(
  scope: MemoryScope,
  state: MemoryRecordState,
  entries: MemoryEntry[]
): string {
  const topicFiles = Array.from(
    new Set(entries.map((entry) => `${entry.topic}.md`))
  ).sort((left, right) => left.localeCompare(right));
  const payload: RetrievalIndexPayload = {
    version: retrievalIndexVersion,
    scope,
    state,
    generatedAt: new Date().toISOString(),
    topicFiles,
    topicFileCount: topicFiles.length,
    entries: buildRetrievalIndexEntries(scope, state, entries)
  };

  return `${JSON.stringify(payload, null, 2)}\n`;
}

function appendJsonlContents(existingContents: string | null, values: unknown[]): string {
  const prefix =
    existingContents && existingContents.length > 0
      ? `${existingContents}${existingContents.endsWith("\n") ? "" : "\n"}`
      : "";

  return `${prefix}${values.map((value) => JSON.stringify(value)).join("\n")}\n`;
}

function buildEmptyLineageSummary(): MemoryLineageSummary {
  return {
    eventCount: 0,
    firstSeenAt: null,
    latestAt: null,
    latestAction: null,
    latestState: null,
    latestAttemptedAction: null,
    latestAttemptedState: null,
    latestAttemptedOutcome: null,
    latestUpdateKind: null,
    archivedAt: null,
    deletedAt: null,
    latestAuditStatus: null,
    refNoopCount: 0,
    matchedAuditOperationCount: 0,
    rolloutNoopOperationCount: 0,
    rolloutSuppressedOperationCount: 0,
    rolloutConflictCount: 0,
    noopOperationCount: 0,
    suppressedOperationCount: 0,
    conflictCount: 0,
    rejectedOperationCount: 0
  };
}

function buildLineageSummary(
  events: MemoryTimelineEvent[],
  latestAudit: MemorySyncAuditSummary | null,
  latestAttempt: MemoryTimelineEvent | null
): MemoryLineageSummary {
  const refNoopCount = events.filter((event) => event.action === "noop").length;
  const visibleEvents = events.filter((event) => event.action !== "noop");
  if (events.length === 0) {
    return {
      ...buildEmptyLineageSummary(),
      latestAttemptedAction: latestAttempt?.action ?? null,
      latestAttemptedState: latestAttempt?.state ?? null,
      latestAttemptedOutcome: latestAttempt?.outcome ?? null,
      latestUpdateKind: null,
      latestAuditStatus: latestAudit?.status ?? null,
      refNoopCount,
      matchedAuditOperationCount: latestAudit?.matchedOperationCount ?? 0,
      rolloutNoopOperationCount: latestAudit?.noopOperationCount ?? 0,
      rolloutSuppressedOperationCount: latestAudit?.suppressedOperationCount ?? 0,
      rolloutConflictCount: latestAudit?.conflicts.length ?? 0,
      noopOperationCount: latestAudit?.noopOperationCount ?? 0,
      suppressedOperationCount: latestAudit?.suppressedOperationCount ?? 0,
      conflictCount: latestAudit?.conflicts.length ?? 0,
      rejectedOperationCount: latestAudit?.rejectedOperationCount ?? 0,
      rejectedReasonCounts: latestAudit?.rejectedReasonCounts
    };
  }

  const chronologicalEvents = [...visibleEvents].sort((left, right) => left.at.localeCompare(right.at));
  const latestEvent = visibleEvents[0] ?? null;
  const archivedEvent =
    chronologicalEvents.find((event) => event.action === "archive") ?? null;
  const deletedEvent =
    chronologicalEvents.find((event) => event.action === "delete") ?? null;

  return {
    eventCount: visibleEvents.length,
    firstSeenAt: chronologicalEvents[0]?.at ?? null,
    latestAt: latestEvent?.at ?? null,
    latestAction:
      latestEvent && latestEvent.action !== "noop" ? latestEvent.action : null,
    latestState: latestEvent?.state ?? null,
    latestAttemptedAction: latestAttempt?.action ?? null,
    latestAttemptedState: latestAttempt?.state ?? null,
    latestAttemptedOutcome: latestAttempt?.outcome ?? null,
    latestUpdateKind:
      latestEvent?.updateKind ?? (latestEvent?.action === "restore" ? "restore" : null),
    archivedAt: archivedEvent?.at ?? null,
    deletedAt: deletedEvent?.at ?? null,
    latestAuditStatus: latestAudit?.status ?? null,
    refNoopCount,
    matchedAuditOperationCount: latestAudit?.matchedOperationCount ?? 0,
    rolloutNoopOperationCount: latestAudit?.noopOperationCount ?? 0,
    rolloutSuppressedOperationCount: latestAudit?.suppressedOperationCount ?? 0,
    rolloutConflictCount: latestAudit?.conflicts.length ?? 0,
    noopOperationCount: latestAudit?.noopOperationCount ?? 0,
    suppressedOperationCount: latestAudit?.suppressedOperationCount ?? 0,
    conflictCount: latestAudit?.conflicts.length ?? 0,
    rejectedOperationCount: latestAudit?.rejectedOperationCount ?? 0,
    rejectedReasonCounts: latestAudit?.rejectedReasonCounts
  };
}

function buildLatestLifecycleAttempt(
  event: MemoryTimelineEvent | null
): MemoryLifecycleAttempt | null {
  if (!event) {
    return null;
  }

  return {
    at: event.at,
    action: event.action,
    outcome: event.outcome ?? (event.action === "noop" ? "noop" : "applied"),
    state: event.state,
    previousState: event.previousState ?? null,
    nextState: event.nextState ?? null,
    summary: event.summary,
    updateKind: event.updateKind ?? (event.action === "restore" ? "restore" : null),
    sessionId: event.sessionId ?? null,
    rolloutPath: event.rolloutPath ?? null
  };
}

function buildLatestAppliedLifecycle(
  event: MemoryTimelineEvent | null
): MemoryAppliedLifecycle | null {
  if (!event || event.action === "noop") {
    return null;
  }

  return {
    at: event.at,
    action: event.action,
    outcome: "applied",
    state: event.state,
    previousState: event.previousState ?? null,
    nextState: event.nextState ?? null,
    summary: event.summary,
    updateKind: event.updateKind ?? null,
    sessionId: event.sessionId ?? null,
    rolloutPath: event.rolloutPath ?? null
  };
}

function buildHistoryWarnings(
  historyPath: string,
  invalidJsonLineCount: number,
  invalidEventCount: number
): string[] {
  const warnings: string[] = [];

  if (invalidJsonLineCount > 0) {
    warnings.push(
      `Ignored ${invalidJsonLineCount} invalid JSONL lifecycle history line(s) while reading ${historyPath}.`
    );
  }

  if (invalidEventCount > 0) {
    warnings.push(
      `Ignored ${invalidEventCount} malformed lifecycle event(s) while reading ${historyPath}.`
    );
  }

  return warnings;
}

function legacyEmptyIndexContents(scope: MemoryScope): string {
  return [
    `# ${topicTitle(scope)} Memory`,
    "",
    "This file is the concise startup index for this scope.",
    "It is intentionally short so it can be injected into Codex at session start.",
    "",
    "## Topics",
    "- No topic files yet.",
    "",
    "## Highlights",
    "- No memory entries yet."
  ].join("\n");
}

function matchesLegacyEmptyIndex(scope: MemoryScope, contents: string): boolean {
  return contents.trim() === legacyEmptyIndexContents(scope).trim();
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every((item) => typeof item === "string")
  );
}

function isMemoryScope(value: unknown): value is MemoryScope {
  return value === "global" || value === "project" || value === "project-local";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isEntryMetadata(value: unknown): value is EntryMetadata {
  if (!value || typeof value !== "object") {
    return false;
  }

  const metadata = value as Record<string, unknown>;
  return (
    typeof metadata.id === "string" &&
    metadata.id.trim().length > 0 &&
    isMemoryScope(metadata.scope) &&
    typeof metadata.updatedAt === "string" &&
    (metadata.sources === undefined || isStringArray(metadata.sources)) &&
    (metadata.reason === undefined || typeof metadata.reason === "string")
  );
}

function isTimelineEvent(value: unknown): value is MemoryTimelineEvent {
  if (!value || typeof value !== "object") {
    return false;
  }

  const event = value as Record<string, unknown>;
  return (
    typeof event.at === "string" &&
    (event.action === "add" ||
      event.action === "update" ||
      event.action === "restore" ||
      event.action === "delete" ||
      event.action === "archive" ||
      event.action === "noop") &&
    isMemoryScope(event.scope) &&
    isMemoryHistoryRecordState(event.state) &&
    typeof event.topic === "string" &&
    typeof event.id === "string" &&
    typeof event.summary === "string" &&
    (event.ref === undefined || typeof event.ref === "string") &&
    (event.outcome === undefined || event.outcome === "applied" || event.outcome === "noop") &&
    (event.previousState === undefined || isMemoryHistoryRecordState(event.previousState)) &&
    (event.nextState === undefined || isMemoryHistoryRecordState(event.nextState)) &&
    (event.updateKind === undefined ||
      event.updateKind === "overwrite" ||
      event.updateKind === "semantic-overwrite" ||
      event.updateKind === "metadata-only" ||
      event.updateKind === "restore") &&
    (event.reason === undefined || typeof event.reason === "string") &&
    (event.source === undefined || typeof event.source === "string") &&
    (event.sessionId === undefined || typeof event.sessionId === "string") &&
    (event.rolloutPath === undefined || typeof event.rolloutPath === "string")
  );
}

function isRetrievalIndexEntry(value: unknown): value is RetrievalIndexEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const entry = value as Record<string, unknown>;
  return (
    typeof entry.ref === "string" &&
    isMemoryScope(entry.scope) &&
    (entry.state === "active" || entry.state === "archived") &&
    typeof entry.topic === "string" &&
    typeof entry.id === "string" &&
    typeof entry.summary === "string" &&
    typeof entry.updatedAt === "string" &&
    typeof entry.approxReadCost === "number" &&
    typeof entry.summaryText === "string" &&
    typeof entry.detailsText === "string"
  );
}

function isRetrievalIndexPayload(value: unknown): value is RetrievalIndexPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Record<string, unknown>;
  return (
    payload.version === retrievalIndexVersion &&
    isMemoryScope(payload.scope) &&
    (payload.state === "active" || payload.state === "archived") &&
    typeof payload.generatedAt === "string" &&
    isStringArray(payload.topicFiles) &&
    typeof payload.topicFileCount === "number" &&
    payload.topicFileCount === payload.topicFiles.length &&
    Array.isArray(payload.entries) &&
    payload.entries.every((entry) => isRetrievalIndexEntry(entry))
  );
}

function findSearchMatch(
  fields: ReadonlyArray<readonly [field: string, value: string]>,
  query: string
): SearchMatch | null {
  const normalizedTerms = normalizeMemoryQueryTerms(query);
  if (normalizedTerms.length === 0) {
    return null;
  }

  const matchedFields: string[] = [];
  let score = 0;
  const matchedTerms = new Set<string>();

  for (const [field, value] of fields) {
    const haystack = value.toLowerCase();
    const fieldMatches = normalizedTerms.filter((term) => haystack.includes(term));
    if (fieldMatches.length === 0) {
      continue;
    }

    matchedFields.push(field);
    fieldMatches.forEach((term) => matchedTerms.add(term));
    const fieldWeight = field === "summary" ? 4 : field === "details" ? 2 : 3;
    score += fieldWeight * fieldMatches.length;
  }

  if (!normalizedTerms.every((term) => matchedTerms.has(term))) {
    return null;
  }

  if (matchedFields.length === 0) {
    return null;
  }

  return {
    matchedFields,
    score
  };
}

function findEntrySearchMatch(entry: MemoryEntry, query: string): SearchMatch | null {
  return findSearchMatch(
    [
      ["id", entry.id],
      ["topic", entry.topic],
      ["summary", entry.summary],
      ["details", entry.details.join("\n")]
    ],
    query
  );
}

function findRetrievalIndexSearchMatch(
  entry: RetrievalIndexEntry,
  query: string
): SearchMatch | null {
  return findSearchMatch(
    [
      ["id", entry.id],
      ["topic", entry.topic],
      ["summary", entry.summaryText],
      ["details", entry.detailsText]
    ],
    query
  );
}

function isProcessedRolloutRecord(value: unknown): value is ProcessedRolloutRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.projectId === "string" &&
    typeof record.worktreeId === "string" &&
    typeof record.sessionId === "string" &&
    typeof record.rolloutPath === "string" &&
    typeof record.sizeBytes === "number" &&
    typeof record.mtimeMs === "number" &&
    typeof record.processedAt === "string"
  );
}

function normalizeSyncState(value: SyncState | null | undefined): Required<SyncState> {
  const processedRollouts = isStringRecord(value?.processedRollouts) ? value.processedRollouts : {};
  const processedRolloutEntries = Array.isArray(value?.processedRolloutEntries)
    ? value.processedRolloutEntries.filter((entry): entry is ProcessedRolloutRecord => isProcessedRolloutRecord(entry))
    : [];

  return {
    processedRollouts,
    processedRolloutEntries
  };
}

function isSyncStateShape(value: unknown): value is SyncState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    (candidate.processedRollouts === undefined || isStringRecord(candidate.processedRollouts)) &&
    (candidate.processedRolloutEntries === undefined ||
      (Array.isArray(candidate.processedRolloutEntries) &&
        candidate.processedRolloutEntries.every((entry) => isProcessedRolloutRecord(entry))))
  );
}

function sameProcessedIdentity(
  left: ProcessedRolloutIdentity,
  right: ProcessedRolloutIdentity
): boolean {
  return (
    left.projectId === right.projectId &&
    left.worktreeId === right.worktreeId &&
    left.sessionId === right.sessionId &&
    left.rolloutPath === right.rolloutPath &&
    left.sizeBytes === right.sizeBytes &&
    left.mtimeMs === right.mtimeMs
  );
}

function toAppliedOperation(record: MemoryApplyRecord): MemoryOperation | null {
  if (record.lifecycleAction === "noop") {
    return null;
  }

  return {
    action: record.operation.action,
    scope: record.operation.scope,
    topic: record.operation.topic,
    id: record.operation.id,
    summary: record.operation.summary,
    details: record.operation.details,
    sources: record.operation.sources,
    reason: record.operation.reason
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fileChangePriority(change: PlannedFileChange): number {
  if (change.path.endsWith("retrieval-index.json")) {
    return 3;
  }

  if (change.path.endsWith("memory-history.jsonl")) {
    return 2;
  }

  if (change.path.endsWith("MEMORY.md") || change.path.endsWith("ARCHIVE.md")) {
    return 1;
  }

  return 0;
}

const defaultMemoryStoreFileOps: MemoryStoreFileOps = {
  writeTextFile: writeTextFileAtomic,
  async deleteFile(filePath: string): Promise<void> {
    await fs.rm(filePath, { force: true });
  }
};

export class MemoryStore {
  public readonly paths: ScopePaths;
  private readonly fileOps: MemoryStoreFileOps;

  public constructor(
    private readonly project: ProjectContext,
    private readonly config: AppConfig,
    fileOps: Partial<MemoryStoreFileOps> = {}
  ) {
    const baseDir = config.autoMemoryDirectory ?? getDefaultMemoryDirectory();

    this.paths = {
      baseDir,
      globalDir: path.join(baseDir, "global"),
      projectDir: path.join(
        baseDir,
        "projects",
        project.projectId,
        "project"
      ),
      projectLocalDir: path.join(
        baseDir,
        "projects",
        project.projectId,
        "locals",
        project.worktreeId
      ),
      stateFile: path.join(baseDir, "state.json"),
      auditDir: path.join(baseDir, "projects", project.projectId, "audit"),
      syncRecoveryFile: path.join(baseDir, "projects", project.projectId, "audit", "sync-recovery.json")
    };
    this.fileOps = {
      ...defaultMemoryStoreFileOps,
      ...fileOps
    };
  }

  private getScopeDir(scope: MemoryScope): string {
    switch (scope) {
      case "global":
        return this.paths.globalDir;
      case "project":
        return this.paths.projectDir;
      case "project-local":
        return this.paths.projectLocalDir;
    }
  }

  public getMemoryFile(scope: MemoryScope): string {
    return path.join(this.getScopeDir(scope), "MEMORY.md");
  }

  public getTopicFile(scope: MemoryScope, topic: string): string {
    return path.join(this.getScopeDir(scope), `${normalizeTopicName(topic)}.md`);
  }

  public getArchiveDir(scope: MemoryScope): string {
    return path.join(this.getScopeDir(scope), "archive");
  }

  public getArchiveIndexFile(scope: MemoryScope): string {
    return path.join(this.getArchiveDir(scope), "ARCHIVE.md");
  }

  public getArchiveTopicFile(scope: MemoryScope, topic: string): string {
    return path.join(this.getArchiveDir(scope), `${normalizeTopicName(topic)}.md`);
  }

  public getHistoryPath(scope: MemoryScope): string {
    return path.join(this.getScopeDir(scope), "memory-history.jsonl");
  }

  public getRetrievalIndexFile(
    scope: MemoryScope,
    state: MemoryRecordState = "active"
  ): string {
    return path.join(
      state === "active" ? this.getScopeDir(scope) : this.getArchiveDir(scope),
      "retrieval-index.json"
    );
  }

  public getSyncAuditPath(): string {
    return path.join(this.paths.auditDir, "sync-log.jsonl");
  }

  public getSyncRecoveryPath(): string {
    return this.paths.syncRecoveryFile;
  }

  private topicFilePath(
    scope: MemoryScope,
    topic: string,
    state: MemoryRecordState
  ): string {
    return state === "active" ? this.getTopicFile(scope, topic) : this.getArchiveTopicFile(scope, topic);
  }

  private async listTopicMarkdownFiles(
    scope: MemoryScope,
    state: MemoryRecordState
  ): Promise<string[]> {
    const baseDir = state === "active" ? this.getScopeDir(scope) : this.getArchiveDir(scope);
    if (!(await fileExists(baseDir))) {
      return [];
    }

    return (await fs.readdir(baseDir))
      .filter(
        (fileName) =>
          fileName.endsWith(".md") &&
          fileName !== "MEMORY.md" &&
          fileName !== "ARCHIVE.md"
      )
      .filter((fileName) => topicNamePattern.test(fileName.replace(/\.md$/u, "")))
      .sort((left, right) => left.localeCompare(right));
  }

  private canonicalIndexFileName(state: MemoryRecordState): "MEMORY.md" | "ARCHIVE.md" {
    return state === "active" ? "MEMORY.md" : "ARCHIVE.md";
  }

  private normalizeFileContents(contents: string): string {
    return contents.replace(/\r\n?/gu, "\n");
  }

  private buildExpectedIndexContents(scope: MemoryScope, state: MemoryRecordState, entries: MemoryEntry[]): string {
    return state === "active" ? buildIndexContents(scope, entries) : buildArchiveIndexContents(scope, entries);
  }

  private isUnexpectedSidecarFileName(
    state: MemoryRecordState,
    fileName: string
  ): boolean {
    const allowedFileNames =
      state === "active"
        ? new Set(["retrieval-index.json", "memory-history.jsonl", this.canonicalIndexFileName(state)])
        : new Set(["retrieval-index.json", this.canonicalIndexFileName(state)]);
    return !allowedFileNames.has(fileName);
  }

  private async inspectRetrievalIndex(
    scope: MemoryScope,
    state: MemoryRecordState
  ): Promise<RetrievalIndexInspection> {
    const retrievalIndexPath = this.getRetrievalIndexFile(scope, state);
    if (!(await fileExists(retrievalIndexPath))) {
      return {
        status: "missing",
        indexPath: retrievalIndexPath,
        payload: null,
        fallbackReason: "missing",
        generatedAt: null,
        topicFileCount: null,
        topicFiles: []
      };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(await readTextFile(retrievalIndexPath)) as unknown;
    } catch {
      return {
        status: "invalid",
        indexPath: retrievalIndexPath,
        payload: null,
        fallbackReason: "invalid",
        generatedAt: null,
        topicFileCount: null,
        topicFiles: []
      };
    }

    if (!isRetrievalIndexPayload(payload)) {
      return {
        status: "invalid",
        indexPath: retrievalIndexPath,
        payload: null,
        fallbackReason: "invalid",
        generatedAt: null,
        topicFileCount: null,
        topicFiles: []
      };
    }

    if (payload.scope !== scope || payload.state !== state) {
      return {
        status: "invalid",
        indexPath: retrievalIndexPath,
        payload: null,
        fallbackReason: "invalid",
        generatedAt: null,
        topicFileCount: null,
        topicFiles: []
      };
    }

    if (await this.isRetrievalIndexStale(scope, state, retrievalIndexPath, payload)) {
      return {
        status: "stale",
        indexPath: retrievalIndexPath,
        payload: null,
        fallbackReason: "stale",
        generatedAt: payload.generatedAt,
        topicFileCount: payload.topicFileCount,
        topicFiles: [...payload.topicFiles]
      };
    }

    return {
      status: "ok",
      indexPath: retrievalIndexPath,
      payload,
      generatedAt: payload.generatedAt,
      topicFileCount: payload.topicFileCount,
      topicFiles: [...payload.topicFiles]
    };
  }

  public async inspectRetrievalSidecars(): Promise<RetrievalSidecarCheck[]> {
    const checks: RetrievalSidecarCheck[] = [];

    for (const scope of ["global", "project", "project-local"] satisfies MemoryScope[]) {
      for (const state of ["active", "archived"] satisfies MemoryRecordState[]) {
        const inspection = await this.inspectRetrievalIndex(scope, state);
        checks.push({
          scope,
          state,
          status: inspection.status,
          indexPath: inspection.indexPath,
          fallbackReason: inspection.fallbackReason,
          generatedAt: inspection.generatedAt,
          topicFileCount: inspection.topicFileCount,
          topicFiles: [...inspection.topicFiles]
        });
      }
    }

    return checks;
  }

  public async inspectLayoutDiagnostics(options: {
    scope?: MemoryScope | "all";
    state?: MemoryRecordState | "all";
  } = {}): Promise<MemoryLayoutDiagnostic[]> {
    const scopes =
      options.scope && options.scope !== "all"
        ? [options.scope]
        : (["global", "project", "project-local"] satisfies MemoryScope[]);
    const states =
      options.state && options.state !== "all"
        ? [options.state]
        : (["active", "archived"] satisfies MemoryRecordState[]);
    const diagnostics: MemoryLayoutDiagnostic[] = [];

    for (const scope of scopes) {
      for (const state of states) {
        const scopeDir = state === "active" ? this.getScopeDir(scope) : this.getArchiveDir(scope);
        if (!(await fileExists(scopeDir))) {
          continue;
        }

        const canonicalIndexFileName = this.canonicalIndexFileName(state);
        const oppositeIndexFileName = state === "active" ? "ARCHIVE.md" : "MEMORY.md";
        const canonicalIndexPath =
          state === "active" ? this.getMemoryFile(scope) : this.getArchiveIndexFile(scope);
        const entries = await fs.readdir(scopeDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile() && !entry.isSymbolicLink()) {
            continue;
          }

          const fileName = entry.name;
          const filePath = path.join(scopeDir, fileName);
          if (fileName === canonicalIndexFileName) {
            continue;
          }

          if (fileName.endsWith(".md")) {
            if (fileName === oppositeIndexFileName) {
              diagnostics.push({
                scope,
                state,
                kind: "misplaced-index-markdown",
                path: filePath,
                fileName,
                message: `Canonical ${fileName} belongs to the ${state === "active" ? "archived" : "active"} store, not ${scope}/${state}.`
              });
              continue;
            }

            const topic = fileName.replace(/\.md$/u, "");
            if (!topicNamePattern.test(topic)) {
              diagnostics.push({
                scope,
                state,
                kind: "malformed-topic-filename",
                path: filePath,
                fileName,
                message: `Unexpected Markdown topic file name "${fileName}" does not match the canonical kebab-case topic pattern.`
              });
              continue;
            }

            const contents = await readTextFile(filePath);
            const parsed = parseTopicFile(contents, topic);
            if (parsed.safeToRewrite && parsed.entries.length === 0) {
              diagnostics.push({
                scope,
                state,
                kind: "orphan-topic-markdown",
                path: filePath,
                fileName,
                message: `Canonical topic markdown "${fileName}" has no managed memory entries and does not contribute to startup or retrieval surfaces.`
              });
            }
          }

          if (
            (fileName.endsWith(".json") || fileName.endsWith(".jsonl")) &&
            this.isUnexpectedSidecarFileName(state, fileName)
          ) {
            diagnostics.push({
              scope,
              state,
              kind: "unexpected-sidecar",
              path: filePath,
              fileName,
              message: `Unexpected sidecar/index file "${fileName}" was found alongside canonical Markdown memory files.`
            });
          }
        }

        const indexExists = await fileExists(canonicalIndexPath);
        const expectedIndexContents = this.buildExpectedIndexContents(
          scope,
          state,
          await this.listEntries(scope, state)
        );
        if (!indexExists) {
          diagnostics.push({
            scope,
            state,
            kind: "missing-index",
            path: canonicalIndexPath,
            fileName: canonicalIndexFileName,
            message: `Canonical ${canonicalIndexFileName} is missing for ${scope}/${state}.`
          });
          continue;
        }

        const currentIndexContents = await readTextFile(canonicalIndexPath);
        if (this.normalizeFileContents(currentIndexContents) !== this.normalizeFileContents(expectedIndexContents)) {
          diagnostics.push({
            scope,
            state,
            kind: "index-drift",
            path: canonicalIndexPath,
            fileName: canonicalIndexFileName,
            message: `Canonical ${canonicalIndexFileName} no longer matches the topic Markdown files for ${scope}/${state}.`
          });
        }
      }
    }

    return diagnostics.sort((left, right) =>
      `${left.scope}:${left.state}:${left.kind}:${left.fileName}`.localeCompare(
        `${right.scope}:${right.state}:${right.kind}:${right.fileName}`
      )
    );
  }

  public async rebuildRetrievalSidecars(options: {
    scope?: MemoryScope | "all";
    state?: MemoryRecordState | "all";
    ensureLayout?: boolean;
  } = {}): Promise<MemoryReindexCheck[]> {
    const scopes: MemoryScope[] =
      options.scope && options.scope !== "all"
        ? [options.scope]
        : ["global", "project", "project-local"];
    const states: MemoryRecordState[] =
      options.state === "all" || options.state === undefined
        ? ["active", "archived"]
        : [options.state];

    const rebuilt: MemoryReindexCheck[] = [];

    if (options.ensureLayout !== false) {
      await this.ensureLayout();
    } else if (!(await this.hasInitializedLayout())) {
      return [];
    }
    for (const scope of scopes) {
      for (const state of states) {
        await this.rebuildRetrievalIndex(scope, state);
        const inspection = await this.inspectRetrievalIndex(scope, state);
        if (!inspection.payload || inspection.generatedAt === null || inspection.topicFileCount === null) {
          throw new Error(
            `Failed to rebuild retrieval sidecar for ${scope}/${state}; inspection still returned ${inspection.status}.`
          );
        }

        rebuilt.push({
          scope,
          state,
          status: "ok",
          indexPath: inspection.indexPath,
          generatedAt: inspection.generatedAt,
          topicFileCount: inspection.topicFileCount,
          topicFiles: [...inspection.topicFiles]
        });
      }
    }

    return rebuilt;
  }

  private async readRetrievalIndex(
    scope: MemoryScope,
    state: MemoryRecordState
  ): Promise<RetrievalIndexPayload | null> {
    return (await this.inspectRetrievalIndex(scope, state)).payload;
  }

  private async isRetrievalIndexStale(
    scope: MemoryScope,
    state: MemoryRecordState,
    retrievalIndexPath: string,
    payload: RetrievalIndexPayload
  ): Promise<boolean> {
    const topicFiles = Array.from(
      new Set((await this.listEntries(scope, state)).map((entry) => `${entry.topic}.md`))
    ).sort((left, right) => left.localeCompare(right));
    if (
      payload.topicFileCount !== topicFiles.length ||
      JSON.stringify(payload.topicFiles) !== JSON.stringify(topicFiles)
    ) {
      return true;
    }

    const indexStats = await fs.stat(retrievalIndexPath);
    const baseDir = state === "active" ? this.getScopeDir(scope) : this.getArchiveDir(scope);
    for (const fileName of topicFiles) {
      const stats = await fs.stat(path.join(baseDir, fileName));
      if (stats.mtimeMs > indexStats.mtimeMs) {
        return true;
      }
    }

    return false;
  }

  private async readTopicFileParse(
    scope: MemoryScope,
    topic: string,
    state: MemoryRecordState
  ): Promise<{ path: string; parse: TopicFileParseResult } | null> {
    const topicFile = this.topicFilePath(scope, topic, state);
    if (!(await fileExists(topicFile))) {
      return null;
    }

    return {
      path: topicFile,
      parse: parseTopicFile(await readTextFile(topicFile), topic)
    };
  }

  private async readTopicEntriesForRewrite(
    scope: MemoryScope,
    topic: string,
    state: MemoryRecordState
  ): Promise<MemoryEntry[]> {
    const parsed = await this.readTopicFileParse(scope, topic, state);
    if (!parsed) {
      return [];
    }

    if (!parsed.parse.safeToRewrite) {
      throw new Error(
        `Cannot rewrite topic file ${parsed.path} because ${parsed.parse.unsafeReason ?? "it is not safely round-trippable"}. Fix the file manually before editing durable memory.`
      );
    }

    return parsed.parse.entries;
  }

  private async assertTopicFileSafeForRewrite(
    scope: MemoryScope,
    topic: string,
    state: MemoryRecordState
  ): Promise<void> {
    const parsed = await this.readTopicFileParse(scope, topic, state);
    if (!parsed || parsed.parse.safeToRewrite) {
      return;
    }

    throw new Error(
      `Cannot rewrite topic file ${parsed.path} because ${parsed.parse.unsafeReason ?? "it is not safely round-trippable"}. Fix the file manually before editing durable memory.`
    );
  }

  private async assertMutationTargetsAreSafe(mutations: MemoryMutation[]): Promise<void> {
    for (const mutation of mutations) {
      const topic = normalizeTopicName(mutation.topic);
      await this.assertTopicFileSafeForRewrite(mutation.scope, topic, "active");

      if (mutation.action === "archive") {
        await this.assertTopicFileSafeForRewrite(mutation.scope, topic, "archived");
        continue;
      }

      if (mutation.action === "upsert") {
        const existingArchived = await this.findEntry(mutation.scope, "archived", topic, mutation.id);
        if (existingArchived) {
          await this.assertTopicFileSafeForRewrite(mutation.scope, topic, "archived");
        }
      }
    }
  }

  public async ensureLayout(): Promise<void> {
    await Promise.all([
      ensureDir(this.paths.baseDir),
      ensureDir(this.paths.globalDir),
      ensureDir(this.paths.projectDir),
      ensureDir(this.paths.projectLocalDir),
      ensureDir(this.paths.auditDir)
    ]);

    for (const scope of ["global", "project", "project-local"] satisfies MemoryScope[]) {
      await ensureDir(this.getArchiveDir(scope));

      const memoryFile = this.getMemoryFile(scope);
      if (!(await fileExists(memoryFile))) {
        await this.rebuildIndex(scope);
      } else {
        const contents = await readTextFile(memoryFile);
        if (matchesLegacyEmptyIndex(scope, contents)) {
          await this.rebuildIndex(scope);
        }
      }

      const archiveIndexFile = this.getArchiveIndexFile(scope);
      if (!(await fileExists(archiveIndexFile))) {
        await this.rebuildArchiveIndex(scope);
      }

      const activeRetrievalIndexFile = this.getRetrievalIndexFile(scope, "active");
      if (
        !(await fileExists(activeRetrievalIndexFile)) ||
        (await this.readRetrievalIndex(scope, "active")) === null
      ) {
        await this.rebuildRetrievalIndex(scope, "active");
      }

      const archivedRetrievalIndexFile = this.getRetrievalIndexFile(scope, "archived");
      if (
        !(await fileExists(archivedRetrievalIndexFile)) ||
        (await this.readRetrievalIndex(scope, "archived")) === null
      ) {
        await this.rebuildRetrievalIndex(scope, "archived");
      }
    }
  }

  public async hasInitializedLayout(): Promise<boolean> {
    if (!(await fileExists(this.paths.baseDir))) {
      return false;
    }

    const canonicalPaths = [
      this.getMemoryFile("global"),
      this.getMemoryFile("project"),
      this.getMemoryFile("project-local"),
      this.getArchiveIndexFile("global"),
      this.getArchiveIndexFile("project"),
      this.getArchiveIndexFile("project-local")
    ];

    for (const filePath of canonicalPaths) {
      if (await fileExists(filePath)) {
        return true;
      }
    }

    const topicDirectories = [
      this.getScopeDir("global"),
      this.getScopeDir("project"),
      this.getScopeDir("project-local"),
      this.getArchiveDir("global"),
      this.getArchiveDir("project"),
      this.getArchiveDir("project-local")
    ];

    for (const directoryPath of topicDirectories) {
      if (!(await fileExists(directoryPath))) {
        continue;
      }

      const fileNames = await fs.readdir(directoryPath);
      if (
        fileNames.some(
          (fileName) =>
            fileName.endsWith(".md") &&
            fileName !== "MEMORY.md" &&
            fileName !== "ARCHIVE.md"
        )
      ) {
        return true;
      }
    }

    return false;
  }

  public async listEntries(
    scope: MemoryScope,
    state: MemoryRecordState = "active",
    options: {
      excludeUnsafeTopics?: boolean;
    } = {}
  ): Promise<MemoryEntry[]> {
    const scopeDir = state === "active" ? this.getScopeDir(scope) : this.getArchiveDir(scope);
    if (!(await fileExists(scopeDir))) {
      return [];
    }

    const files = await fs.readdir(scopeDir);
    const entries: MemoryEntry[] = [];
    for (const fileName of files) {
      if (
        !fileName.endsWith(".md") ||
        fileName === "MEMORY.md" ||
        fileName === "ARCHIVE.md"
      ) {
        continue;
      }

      const topic = fileName.replace(/\.md$/u, "");
      if (!topicNamePattern.test(topic)) {
        continue;
      }
      const contents = await readTextFile(path.join(scopeDir, fileName));
      const parsedTopic = parseTopicFile(contents, topic);
      if (options.excludeUnsafeTopics && !parsedTopic.safeToRewrite) {
        continue;
      }
      entries.push(...parsedTopic.entries);
    }

    return entries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  public async listTopics(
    scope: MemoryScope,
    state: MemoryRecordState = "active"
  ): Promise<string[]> {
    return (await this.listTopicRefs(scope, state)).map((entry) => entry.topic);
  }

  public async listTopicRefs(
    scope: MemoryScope,
    state: MemoryRecordState = "active"
  ): Promise<TopicFileRef[]> {
    const scopeDir = state === "active" ? this.getScopeDir(scope) : this.getArchiveDir(scope);
    if (!(await fileExists(scopeDir))) {
      return [];
    }

    const files = await fs.readdir(scopeDir);
    const refs: TopicFileRef[] = [];
    for (const fileName of files) {
      if (
        !fileName.endsWith(".md") ||
        fileName === "MEMORY.md" ||
        fileName === "ARCHIVE.md"
      ) {
        continue;
      }

      const topic = fileName.replace(/\.md$/u, "");
      if (!topicNamePattern.test(topic)) {
        continue;
      }

      const filePath = path.join(scopeDir, fileName);
      const parsedTopic = parseTopicFile(await readTextFile(filePath), topic);
      if (parsedTopic.entries.length === 0) {
        continue;
      }

      refs.push({
        scope,
        topic,
        path: filePath
      });
    }

    return refs.sort((left, right) => left.topic.localeCompare(right.topic));
  }

  public async rebuildIndex(scope: MemoryScope): Promise<void> {
    const entries = await this.listEntries(scope, "active", {
      excludeUnsafeTopics: true
    });
    await this.fileOps.writeTextFile(this.getMemoryFile(scope), buildIndexContents(scope, entries));
  }

  public async rebuildArchiveIndex(scope: MemoryScope): Promise<void> {
    const entries = await this.listEntries(scope, "archived", {
      excludeUnsafeTopics: true
    });
    await this.fileOps.writeTextFile(
      this.getArchiveIndexFile(scope),
      buildArchiveIndexContents(scope, entries)
    );
  }

  public async rebuildRetrievalIndex(
    scope: MemoryScope,
    state: MemoryRecordState = "active"
  ): Promise<void> {
    const entries = await this.listEntries(scope, state, {
      excludeUnsafeTopics: true
    });
    await this.fileOps.writeTextFile(
      this.getRetrievalIndexFile(scope, state),
      buildRetrievalIndexContents(scope, state, entries)
    );
  }

  public async inspectTopicFiles(options: {
    scope?: MemoryScope | "all";
    state?: MemoryRecordState | "all";
  } = {}): Promise<TopicFileDiagnostic[]> {
    const scopes =
      options.scope && options.scope !== "all"
        ? [options.scope]
        : (["global", "project", "project-local"] satisfies MemoryScope[]);
    const states =
      options.state && options.state !== "all"
        ? [options.state]
        : (["active", "archived"] satisfies MemoryRecordState[]);
    const diagnostics: TopicFileDiagnostic[] = [];

    for (const scope of scopes) {
      for (const state of states) {
        const scopeDir = state === "active" ? this.getScopeDir(scope) : this.getArchiveDir(scope);
        if (!(await fileExists(scopeDir))) {
          continue;
        }

        const files = await fs.readdir(scopeDir);
        for (const fileName of files) {
          if (
            !fileName.endsWith(".md") ||
            fileName === "MEMORY.md" ||
            fileName === "ARCHIVE.md"
          ) {
            continue;
          }

          const topic = fileName.replace(/\.md$/u, "");
          if (!topicNamePattern.test(topic)) {
            continue;
          }

          const filePath = path.join(scopeDir, fileName);
          const parsedTopic = parseTopicFile(await readTextFile(filePath), topic);
          diagnostics.push({
            scope,
            state,
            topic,
            path: filePath,
            safeToRewrite: parsedTopic.safeToRewrite,
            entryCount: parsedTopic.entries.length,
            invalidEntryBlockCount: parsedTopic.invalidEntryBlockCount,
            manualContentDetected: parsedTopic.manualContentDetected,
            unsafeReason: parsedTopic.unsafeReason
          });
        }
      }
    }

    return diagnostics.sort((left, right) =>
      `${left.scope}:${left.state}:${left.topic}`.localeCompare(
        `${right.scope}:${right.state}:${right.topic}`
      )
    );
  }

  public async getEntryByRef(ref: string): Promise<MemoryDetailsResult | null> {
    const parsed = parseMemoryRef(ref);
    if (!parsed) {
      return null;
    }

    const topicParse = await this.readTopicFileParse(parsed.scope, parsed.topic, parsed.state);
    if (topicParse && !topicParse.parse.safeToRewrite) {
      return null;
    }

    const entry = await this.findEntry(parsed.scope, parsed.state, parsed.topic, parsed.id);
    if (!entry) {
      return null;
    }

    const timeline = await this.readTimelineWithDiagnostics(ref);
    const latestEvent = timeline.latestEvent;
    const latestAttempt = timeline.latestAttempt;
    const latestAudit = timeline.latestAudit;
    const timelineWarnings = [...timeline.warnings];
    const detailWarnings: string[] = [];
    if ((latestAudit?.noopOperationCount ?? 0) > 0) {
      detailWarnings.push(
        `Latest sync audit recorded ${latestAudit?.noopOperationCount ?? 0} rollout-level no-op operation(s) across the whole sync.`
      );
    }

    if ((latestAudit?.suppressedOperationCount ?? 0) > 0) {
      detailWarnings.push(
        `Latest sync audit suppressed ${latestAudit?.suppressedOperationCount ?? 0} rollout-level operation(s) across the whole sync.`
      );
    }

    if ((latestAudit?.conflicts.length ?? 0) > 0) {
      detailWarnings.push(
        `Latest sync audit includes ${latestAudit?.conflicts.length ?? 0} rollout-level suppressed conflict candidate(s).`
      );
    }

    if ((latestAudit?.rejectedOperationCount ?? 0) > 0) {
      detailWarnings.push(
        `Latest sync audit rejected ${latestAudit?.rejectedOperationCount ?? 0} rollout-level operation(s) across the whole sync.`
      );
    }

    if (timeline.lineageSummary.refNoopCount > 0) {
      detailWarnings.push(
        `Lifecycle history recorded ${timeline.lineageSummary.refNoopCount} ref-local no-op attempt(s) for ${ref}.`
      );
    }
    const warnings = [...timelineWarnings, ...detailWarnings];

    return {
      ...parsed,
      entry,
      path:
        parsed.state === "active"
          ? this.getTopicFile(parsed.scope, parsed.topic)
          : this.getArchiveTopicFile(parsed.scope, parsed.topic),
      approxReadCost: entry.details.length + 4,
      latestLifecycleAction:
        latestEvent && latestEvent.action !== "noop" ? latestEvent.action : null,
      latestAppliedLifecycle: buildLatestAppliedLifecycle(latestEvent),
      latestLifecycleAttempt: buildLatestLifecycleAttempt(latestAttempt),
      latestState: latestEvent?.state ?? parsed.state,
      latestSessionId: latestAttempt?.sessionId ?? latestEvent?.sessionId ?? null,
      latestRolloutPath: latestAttempt?.rolloutPath ?? latestEvent?.rolloutPath ?? null,
      historyPath: this.getHistoryPath(parsed.scope),
      latestAudit,
      timelineWarningCount: timelineWarnings.length,
      lineageSummary: {
        ...timeline.lineageSummary,
        latestState: timeline.lineageSummary.latestState ?? parsed.state
      },
      warnings
    };
  }

  public async searchEntriesWithDiagnostics(
    query: string,
    options: {
      scope?: MemoryScope | "all";
      state?: MemoryRecordState | "all";
      limit?: number;
    } = {}
  ): Promise<MemorySearchExecution> {
    const scopes: MemoryScope[] =
      options.scope && options.scope !== "all"
        ? [options.scope]
        : ["global", "project", "project-local"];
    const states: MemoryRecordState[] =
      options.state === "all"
        ? ["active", "archived"]
        : [options.state ?? "active"];
    const results: Array<Omit<MemorySearchResult, "globalRank"> & { score: number }> = [];
    const diagnostics: MemorySearchDiagnosticPath[] = [];
    const topicDiagnostics = filterUnsafeTopicDiagnostics(
      await this.inspectTopicFiles({
        scope: options.scope,
        state: options.state
      })
    );
    const unsafeTopicKeys = new Set(
      topicDiagnostics.map((diagnostic) =>
        buildUnsafeTopicKey(diagnostic.scope, diagnostic.state, diagnostic.topic)
      )
    );
    let usedFallback = false;
    let fallbackReason: MemoryRetrievalFallbackReason | undefined;
    let matchedViaIndex = false;
    let matchedViaFallback = false;

    for (const scope of scopes) {
      for (const state of states) {
        const retrievalIndex = await this.inspectRetrievalIndex(scope, state);
        let matchedCount = 0;
        if (retrievalIndex.payload) {
          for (const entry of retrievalIndex.payload.entries) {
            if (unsafeTopicKeys.has(buildUnsafeTopicKey(scope, state, entry.topic))) {
              continue;
            }
            const match = findRetrievalIndexSearchMatch(entry, query);
            if (!match) {
              continue;
            }

            matchedCount += 1;
            results.push({
              ref: entry.ref,
              scope: entry.scope,
              state: entry.state,
              topic: entry.topic,
              id: entry.id,
              summary: entry.summary,
              updatedAt: entry.updatedAt,
              matchedFields: match.matchedFields,
              approxReadCost: entry.approxReadCost,
              score: match.score
            });
            matchedViaIndex = true;
          }
          diagnostics.push({
            scope,
            state,
            retrievalMode: "index",
            matchedCount,
            returnedCount: 0,
            droppedCount: 0,
            indexPath: retrievalIndex.indexPath,
            generatedAt: retrievalIndex.generatedAt
          });
          continue;
        }

        usedFallback = true;
        fallbackReason ??= retrievalIndex.fallbackReason ?? "missing";
        const entries = await this.listEntries(scope, state, {
          excludeUnsafeTopics: true
        });
        for (const entry of entries) {
          const match = findEntrySearchMatch(entry, query);
          if (!match) {
            continue;
          }

          matchedCount += 1;
          results.push({
            ref: buildMemoryRef(scope, state, entry.topic, entry.id),
            scope,
            state,
            topic: entry.topic,
            id: entry.id,
            summary: entry.summary,
            updatedAt: entry.updatedAt,
            matchedFields: match.matchedFields,
            approxReadCost: entry.details.length + 4,
            score: match.score
          });
          matchedViaFallback = true;
        }
        diagnostics.push({
          scope,
          state,
          retrievalMode: "markdown-fallback",
          retrievalFallbackReason: retrievalIndex.fallbackReason ?? "missing",
          matchedCount,
          returnedCount: 0,
          droppedCount: 0,
          indexPath: retrievalIndex.indexPath,
          generatedAt: retrievalIndex.generatedAt
        });
      }
    }

    const totalMatchedCount = results.length;
    const sortedResults = results.sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return right.updatedAt.localeCompare(left.updatedAt);
      });
    const appliedLimit = options.limit ?? 10;
    const normalizedResults = sortedResults
      .slice(0, appliedLimit)
      .map(({ score: _score, ...result }, index) => ({
        ...result,
        globalRank: index + 1
      }));
    const returnedCount = normalizedResults.length;
    const returnedCountByPath = new Map<string, number>();
    for (const result of normalizedResults) {
      const key = buildSearchDiagnosticKey(result.scope, result.state);
      returnedCountByPath.set(key, (returnedCountByPath.get(key) ?? 0) + 1);
    }
    const diagnosticsWithReturnedCounts = diagnostics.map((check) => ({
      ...check,
      returnedCount: returnedCountByPath.get(buildSearchDiagnosticKey(check.scope, check.state)) ?? 0,
      droppedCount:
        check.matchedCount - (returnedCountByPath.get(buildSearchDiagnosticKey(check.scope, check.state)) ?? 0)
    }));

    return {
      results: normalizedResults,
      searchOrder: diagnostics.map((check) => buildSearchDiagnosticKey(check.scope, check.state)),
      totalMatchedCount,
      returnedCount,
      globalLimitApplied: returnedCount < totalMatchedCount,
      truncatedCount: Math.max(0, totalMatchedCount - returnedCount),
      resultWindow: {
        start: returnedCount === 0 ? 0 : 1,
        end: returnedCount,
        limit: appliedLimit
      },
      retrievalMode:
        matchedViaFallback || (!matchedViaIndex && usedFallback)
          ? "markdown-fallback"
          : "index",
      retrievalFallbackReason:
        matchedViaFallback || (!matchedViaIndex && usedFallback) ? fallbackReason : undefined,
      diagnostics: normalizeMemorySearchDiagnostics(diagnosticsWithReturnedCounts, topicDiagnostics)
    };
  }

  public async searchEntries(
    query: string,
    options: {
      scope?: MemoryScope | "all";
      state?: MemoryRecordState | "all";
      limit?: number;
    } = {}
  ): Promise<MemorySearchResult[]> {
    return (await this.searchEntriesWithDiagnostics(query, options)).results;
  }

  public async readTimeline(ref: string): Promise<MemoryTimelineEvent[]> {
    return (await this.readTimelineWithDiagnostics(ref)).events;
  }

  public async readTimelineWithDiagnostics(ref: string): Promise<TimelineReadResult> {
    const parsed = parseMemoryRef(ref);
    if (!parsed) {
      return {
        ref,
        events: [],
        warnings: [],
        lineageSummary: buildEmptyLineageSummary(),
        latestAudit: null,
        latestEvent: null,
        latestAppliedLifecycle: null,
        latestAttempt: null,
        latestLifecycleAttempt: null
      };
    }

    const history = await this.readHistoryWithDiagnostics(parsed.scope);
    const matchingEvents = history.events
      .filter((entry) => entry.id === parsed.id && entry.topic === parsed.topic)
      .sort((left, right) => right.at.localeCompare(left.at));
    const events = matchingEvents.filter((event) => event.action !== "noop");
    const latestEvent = events[0] ?? null;
    const latestAttempt = matchingEvents[0] ?? null;
    const latestEventHasProvenance = Boolean(latestEvent?.rolloutPath || latestEvent?.sessionId);
    const olderEventHasProvenance = matchingEvents
      .slice(1)
      .some((event) => Boolean(event.rolloutPath || event.sessionId));
    const latestAuditLookup = await this.findLatestSyncAuditSummary(
      parsed.scope,
      parsed.topic,
      parsed.id,
      latestAttempt?.rolloutPath,
      latestAttempt?.sessionId,
      latestAttempt?.action === "noop"
    );
    const latestAudit = latestAuditLookup.summary;
    const warnings = [...history.warnings, ...latestAuditLookup.warnings];
    if (latestAttempt && !latestAudit && (latestAttempt.rolloutPath || latestAttempt.sessionId)) {
      warnings.push(
        `Lifecycle history exists for ${ref}, but no matching sync audit entry was found in ${this.getSyncAuditPath()}.`
      );
    }
    if (latestEvent && !latestEventHasProvenance && olderEventHasProvenance) {
      warnings.push(
        `Latest lifecycle event for ${ref} has no rollout/session provenance, so latestAudit was not backfilled from an older sync audit entry.`
      );
    }

    const topicParse = await this.readTopicFileParse(parsed.scope, parsed.topic, parsed.state);
    if (topicParse && !topicParse.parse.safeToRewrite) {
      warnings.push(
        `Source topic file for ${ref} is unsafe to rewrite because ${topicParse.parse.unsafeReason ?? "it is not safely round-trippable"}.`
      );
      if (topicParse.parse.invalidEntryBlockCount > 0) {
        warnings.push(
          `Source topic file for ${ref} contains ${topicParse.parse.invalidEntryBlockCount} malformed or unsupported entry block(s).`
        );
      }
      if (topicParse.parse.manualContentDetected) {
        warnings.push(
          `Source topic file for ${ref} contains unsupported manual content outside managed memory entries.`
        );
      }
    }

    return {
      ref,
      events,
      warnings,
      lineageSummary: buildLineageSummary(matchingEvents, latestAudit, latestAttempt),
      latestAudit,
      latestEvent,
      latestAppliedLifecycle: buildLatestAppliedLifecycle(latestEvent),
      latestAttempt,
      latestLifecycleAttempt: buildLatestLifecycleAttempt(latestAttempt)
    };
  }

  private async readTextFileIfExists(filePath: string): Promise<string | null> {
    if (!(await fileExists(filePath))) {
      return null;
    }

    return readTextFile(filePath);
  }

  private findEntryInEntries(
    entries: MemoryEntry[],
    topic: string,
    id: string
  ): MemoryEntry | null {
    return entries.find((entry) => entry.topic === topic && entry.id === id) ?? null;
  }

  private replaceEntryInEntries(entries: MemoryEntry[], nextEntry: MemoryEntry): MemoryEntry[] {
    return [
      ...entries.filter(
        (entry) => !(entry.topic === nextEntry.topic && entry.id === nextEntry.id)
      ),
      nextEntry
    ];
  }

  private removeEntryFromEntries(
    entries: MemoryEntry[],
    topic: string,
    id: string
  ): { entries: MemoryEntry[]; removed: boolean } {
    const nextEntries = entries.filter((entry) => !(entry.topic === topic && entry.id === id));
    return {
      entries: nextEntries,
      removed: nextEntries.length !== entries.length
    };
  }

  private async loadScopeMutationState(scope: MemoryScope): Promise<ScopeMutationState> {
    return {
      activeEntries: await this.listEntries(scope, "active"),
      archivedEntries: await this.listEntries(scope, "archived"),
      historyRaw: await this.readTextFileIfExists(this.getHistoryPath(scope)),
      historyAppends: [],
      activeTopicsTouched: new Set<string>(),
      archivedTopicsTouched: new Set<string>(),
      activeIndexTouched: false,
      archiveIndexTouched: false
    };
  }

  private async buildMutationCommitPlan(
    mutations: MemoryMutation[],
    options: {
      sessionId?: string;
      rolloutPath?: string;
    } = {}
  ): Promise<MutationCommitPlan> {
    const applied: MemoryApplyRecord[] = [];
    const scopeStates = new Map<MemoryScope, ScopeMutationState>();

    for (const mutation of mutations) {
      if (!scopeStates.has(mutation.scope)) {
        scopeStates.set(mutation.scope, await this.loadScopeMutationState(mutation.scope));
      }

      const scopeState = scopeStates.get(mutation.scope);
      if (!scopeState) {
        continue;
      }

      const topic = normalizeTopicName(mutation.topic);
      const existingActive = this.findEntryInEntries(scopeState.activeEntries, topic, mutation.id);
      const existingArchived = this.findEntryInEntries(
        scopeState.archivedEntries,
        topic,
        mutation.id
      );

      if (mutation.action === "upsert") {
        if (!mutation.summary) {
          continue;
        }

        const updatedAt = new Date().toISOString();
        const entry: MemoryEntry = {
          id: mutation.id,
          scope: mutation.scope,
          topic,
          summary: mutation.summary,
          details: mutation.details?.length ? mutation.details : [mutation.summary],
          updatedAt,
          sources: mutation.sources ?? [],
          reason: mutation.reason
        };

        const lifecycleAction = classifyUpsertLifecycle(existingActive, existingArchived, entry);
        const appliedOperation: MemoryMutation = {
          ...mutation,
          topic,
          details: entry.details,
          sources: entry.sources,
          reason: entry.reason
        };

        if (lifecycleAction === "noop") {
          const noopState = existingActive ? "active" : existingArchived ? "archived" : "deleted";
          applied.push({
            operation: appliedOperation,
            lifecycleAction,
            previousState: noopState === "deleted" ? undefined : noopState,
            nextState: noopState
          });
          scopeState.historyAppends.push({
            at: updatedAt,
            action: "noop",
            outcome: "noop",
            previousState: noopState === "deleted" ? undefined : noopState,
            nextState: noopState,
            scope: mutation.scope,
            state: noopState,
            topic,
            id: mutation.id,
            ref:
              noopState === "deleted"
                ? undefined
                : buildMemoryRef(mutation.scope, noopState, topic, mutation.id),
            summary: entry.summary,
            reason: mutation.reason,
            source: mutation.sources?.[0],
            sessionId: options.sessionId,
            rolloutPath:
              options.rolloutPath ??
              mutation.sources?.find((source) => source.endsWith(".jsonl"))
          });
          continue;
        }

        scopeState.activeEntries = this.replaceEntryInEntries(scopeState.activeEntries, entry);
        scopeState.activeTopicsTouched.add(topic);
        scopeState.activeIndexTouched = true;

        if (existingArchived) {
          scopeState.archivedEntries = this.removeEntryFromEntries(
            scopeState.archivedEntries,
            topic,
            mutation.id
          ).entries;
          scopeState.archivedTopicsTouched.add(topic);
          scopeState.archiveIndexTouched = true;
        }

        applied.push({
          operation: appliedOperation,
          lifecycleAction,
          previousState: existingActive ? "active" : existingArchived ? "archived" : undefined,
          nextState: nextHistoryStateForLifecycle(lifecycleAction)
        });
        scopeState.historyAppends.push({
          at: updatedAt,
          action: lifecycleAction,
          outcome: "applied",
          previousState: existingActive ? "active" : existingArchived ? "archived" : undefined,
          nextState: nextHistoryStateForLifecycle(lifecycleAction),
          updateKind:
            lifecycleAction === "restore"
              ? "restore"
              : existingActive
                ? classifyUpdateKind(existingActive, entry)
                : undefined,
          scope: mutation.scope,
          state: "active",
          topic,
          id: mutation.id,
          ref: buildMemoryRef(mutation.scope, "active", topic, mutation.id),
          summary: entry.summary,
          reason: mutation.reason,
          source: mutation.sources?.[0],
          sessionId: options.sessionId,
          rolloutPath:
            options.rolloutPath ??
            mutation.sources?.find((source) => source.endsWith(".jsonl"))
        });
        continue;
      }

      if (!existingActive) {
        applied.push({
          operation: {
            ...mutation,
            topic,
            summary: mutation.summary ?? existingArchived?.summary,
            details: mutation.details ?? existingArchived?.details,
            sources: mutation.sources ?? existingArchived?.sources,
            reason: mutation.reason ?? existingArchived?.reason
          },
          lifecycleAction: "noop",
          previousState: existingArchived ? "archived" : undefined,
          nextState: existingArchived ? "archived" : undefined
        });
        if (existingArchived) {
          scopeState.historyAppends.push({
            at: new Date().toISOString(),
            action: "noop",
            outcome: "noop",
            previousState: "archived",
            nextState: "archived",
            scope: mutation.scope,
            state: "archived",
            topic,
            id: mutation.id,
            ref: buildMemoryRef(mutation.scope, "archived", topic, mutation.id),
            summary: existingArchived.summary,
            reason: mutation.reason ?? existingArchived.reason,
            source: (mutation.sources ?? existingArchived.sources)?.[0],
            sessionId: options.sessionId,
            rolloutPath:
              options.rolloutPath ??
              (mutation.sources ?? existingArchived.sources)?.find((source) => source.endsWith(".jsonl"))
          });
        }
        continue;
      }

      if (mutation.action === "archive") {
        const archivedAt = new Date().toISOString();
        const archivedEntry: MemoryEntry = {
          ...existingActive,
          updatedAt: archivedAt,
          reason: mutation.reason ?? existingActive.reason,
          sources: mutation.sources ?? existingActive.sources
        };

        scopeState.activeEntries = this.removeEntryFromEntries(
          scopeState.activeEntries,
          topic,
          mutation.id
        ).entries;
        scopeState.archivedEntries = this.replaceEntryInEntries(
          scopeState.archivedEntries,
          archivedEntry
        );
        scopeState.activeTopicsTouched.add(topic);
        scopeState.archivedTopicsTouched.add(topic);
        scopeState.activeIndexTouched = true;
        scopeState.archiveIndexTouched = true;

        const appliedOperation: MemoryMutation = {
          action: "archive",
          scope: mutation.scope,
          topic,
          id: mutation.id,
          summary: archivedEntry.summary,
          details: archivedEntry.details,
          sources: archivedEntry.sources,
          reason: archivedEntry.reason
        };
        applied.push({
          operation: appliedOperation,
          lifecycleAction: "archive",
          previousState: "active",
          nextState: "archived"
        });
        scopeState.historyAppends.push({
          at: archivedAt,
          action: "archive",
          outcome: "applied",
          previousState: "active",
          nextState: "archived",
          scope: mutation.scope,
          state: "archived",
          topic,
          id: mutation.id,
          ref: buildMemoryRef(mutation.scope, "archived", topic, mutation.id),
          summary: archivedEntry.summary,
          reason: appliedOperation.reason,
          source: appliedOperation.sources?.[0],
          sessionId: options.sessionId,
          rolloutPath:
            options.rolloutPath ??
            appliedOperation.sources?.find((source) => source.endsWith(".jsonl"))
        });
        continue;
      }

      const nextActive = this.removeEntryFromEntries(scopeState.activeEntries, topic, mutation.id);
      if (!nextActive.removed) {
        applied.push({
          operation: {
            ...mutation,
            topic,
            summary: existingActive.summary,
            details: existingActive.details,
            sources: mutation.sources ?? existingActive.sources,
            reason: mutation.reason ?? existingActive.reason
          },
          lifecycleAction: "noop",
          previousState: "active",
          nextState: "active"
        });
        scopeState.historyAppends.push({
          at: new Date().toISOString(),
          action: "noop",
          outcome: "noop",
          previousState: "active",
          nextState: "active",
          scope: mutation.scope,
          state: "active",
          topic,
          id: mutation.id,
          ref: buildMemoryRef(mutation.scope, "active", topic, mutation.id),
          summary: existingActive.summary,
          reason: mutation.reason ?? existingActive.reason,
          source: (mutation.sources ?? existingActive.sources)?.[0],
          sessionId: options.sessionId,
          rolloutPath:
            options.rolloutPath ??
            (mutation.sources ?? existingActive.sources)?.find((source) => source.endsWith(".jsonl"))
        });
        continue;
      }

      scopeState.activeEntries = nextActive.entries;
      scopeState.activeTopicsTouched.add(topic);
      scopeState.activeIndexTouched = true;

      const deletedAt = new Date().toISOString();
      const appliedOperation: MemoryMutation = {
        action: "delete",
        scope: mutation.scope,
        topic,
        id: mutation.id,
        summary: existingActive.summary,
        details: existingActive.details,
        sources: mutation.sources ?? existingActive.sources,
        reason: mutation.reason ?? existingActive.reason
      };
      applied.push({
        operation: appliedOperation,
        lifecycleAction: "delete",
        previousState: "active",
        nextState: "deleted"
      });
      scopeState.historyAppends.push({
        at: deletedAt,
        action: "delete",
        outcome: "applied",
        previousState: "active",
        nextState: "deleted",
        scope: mutation.scope,
        state: "deleted",
        topic,
        id: mutation.id,
        summary: existingActive.summary,
        reason: appliedOperation.reason,
        source: appliedOperation.sources?.[0],
        sessionId: options.sessionId,
        rolloutPath:
          options.rolloutPath ??
          appliedOperation.sources?.find((source) => source.endsWith(".jsonl"))
      });
    }

    const fileChanges: PlannedFileChange[] = [];

    for (const [scope, scopeState] of scopeStates) {
      for (const topic of Array.from(scopeState.activeTopicsTouched).sort()) {
        const topicEntries = scopeState.activeEntries.filter((entry) => entry.topic === topic);
        fileChanges.push({
          path: this.getTopicFile(scope, topic),
          contents: topicEntries.length > 0 ? topicFileContents(topic, topicEntries) : null
        });
      }

      for (const topic of Array.from(scopeState.archivedTopicsTouched).sort()) {
        const topicEntries = scopeState.archivedEntries.filter((entry) => entry.topic === topic);
        fileChanges.push({
          path: this.getArchiveTopicFile(scope, topic),
          contents: topicEntries.length > 0 ? topicFileContents(topic, topicEntries) : null
        });
      }

      if (scopeState.activeIndexTouched) {
        fileChanges.push({
          path: this.getMemoryFile(scope),
          contents: buildIndexContents(scope, scopeState.activeEntries)
        });
        fileChanges.push({
          path: this.getRetrievalIndexFile(scope, "active"),
          contents: buildRetrievalIndexContents(scope, "active", scopeState.activeEntries)
        });
      }

      if (scopeState.archiveIndexTouched) {
        fileChanges.push({
          path: this.getArchiveIndexFile(scope),
          contents: buildArchiveIndexContents(scope, scopeState.archivedEntries)
        });
        fileChanges.push({
          path: this.getRetrievalIndexFile(scope, "archived"),
          contents: buildRetrievalIndexContents(scope, "archived", scopeState.archivedEntries)
        });
      }

      if (scopeState.historyAppends.length > 0) {
        fileChanges.push({
          path: this.getHistoryPath(scope),
          contents: appendJsonlContents(scopeState.historyRaw, scopeState.historyAppends)
        });
      }
    }

    return {
      applied,
      fileChanges
    };
  }

  private async captureFileSnapshots(fileChanges: PlannedFileChange[]): Promise<FileSnapshot[]> {
    return Promise.all(
      fileChanges.map(async (change) => ({
        path: change.path,
        contents: await this.readTextFileIfExists(change.path)
      }))
    );
  }

  private async restoreFileSnapshots(snapshots: FileSnapshot[]): Promise<string[]> {
    const rollbackErrors: string[] = [];

    for (const snapshot of [...snapshots].reverse()) {
      try {
        if (snapshot.contents === null) {
          await this.fileOps.deleteFile(snapshot.path);
        } else {
          await this.fileOps.writeTextFile(snapshot.path, snapshot.contents);
        }
      } catch (error) {
        rollbackErrors.push(`${snapshot.path}: ${errorMessage(error)}`);
      }
    }

    return rollbackErrors;
  }

  private async commitPlannedFileChanges(fileChanges: PlannedFileChange[]): Promise<void> {
    if (fileChanges.length === 0) {
      return;
    }

    const snapshots = await this.captureFileSnapshots(fileChanges);
    const writes = fileChanges
      .filter((change): change is PlannedFileChange & { contents: string } => change.contents !== null)
      .sort((left, right) => {
        const priorityDifference = fileChangePriority(left) - fileChangePriority(right);
        if (priorityDifference !== 0) {
          return priorityDifference;
        }
        return left.path.localeCompare(right.path);
      });
    const deletes = fileChanges
      .filter((change) => change.contents === null)
      .sort((left, right) => left.path.localeCompare(right.path));

    try {
      for (const change of writes) {
        await this.fileOps.writeTextFile(change.path, change.contents);
      }

      for (const change of deletes) {
        await this.fileOps.deleteFile(change.path);
      }
    } catch (error) {
      const rollbackErrors = await this.restoreFileSnapshots(snapshots);
      if (rollbackErrors.length > 0) {
        throw new Error(
          `Failed to apply durable memory changes: ${errorMessage(error)}. Rollback also failed for ${rollbackErrors.join("; ")}`
        );
      }

      throw error;
    }
  }

  public async applyOperations(
    operations: MemoryOperation[],
    options: {
      sessionId?: string;
      rolloutPath?: string;
    } = {}
  ): Promise<MemoryOperation[]> {
    const applied = await this.applyMutations(operations, options);
    return applied.flatMap((record) => {
      const operation = toAppliedOperation(record);
      return operation ? [operation] : [];
    });
  }

  public async applyMutations(
    mutations: MemoryMutation[],
    options: {
      sessionId?: string;
      rolloutPath?: string;
    } = {}
  ): Promise<MemoryApplyRecord[]> {
    await this.ensureLayout();
    await this.assertMutationTargetsAreSafe(mutations);
    const plan = await this.buildMutationCommitPlan(mutations, options);
    await this.commitPlannedFileChanges(plan.fileChanges);
    return plan.applied;
  }

  public async remember(
    scope: MemoryScope,
    topic: string,
    id: string,
    summary: string,
    details: string[],
    reason?: string
  ): Promise<MemoryApplyRecord | null> {
    const records = await this.applyMutations([
      {
        action: "upsert",
        scope,
        topic,
        id,
        summary,
        details,
        reason,
        sources: ["manual"]
      }
    ]);
    return records[0] ?? null;
  }

  public async previewRemember(
    scope: MemoryScope,
    topic: string,
    id: string,
    summary: string,
    details: string[],
    reason?: string
  ): Promise<{
    record: MemoryApplyRecord | null;
    ref: string;
    targetPath: string;
    wouldWrite: boolean;
  }> {
    await this.ensureLayout();
    await this.assertMutationTargetsAreSafe([
      {
        action: "upsert",
        scope,
        topic,
        id,
        summary,
        details,
        reason,
        sources: ["manual"]
      }
    ]);

    const plan = await this.buildMutationCommitPlan(
      [
        {
          action: "upsert",
          scope,
          topic,
          id,
          summary,
          details,
          reason,
          sources: ["manual"]
        }
      ],
      {}
    );
    const normalizedTopic = normalizeTopicName(topic);
    return {
      record: plan.applied[0] ?? null,
      ref: buildMemoryRef(scope, "active", normalizedTopic, id),
      targetPath: this.getTopicFile(scope, normalizedTopic),
      wouldWrite: plan.fileChanges.length > 0
    };
  }

  private async upsertEntry(
    entry: MemoryEntry,
    state: MemoryRecordState = "active"
  ): Promise<void> {
    const topicFile =
      state === "active"
        ? this.getTopicFile(entry.scope, entry.topic)
        : this.getArchiveTopicFile(entry.scope, entry.topic);
    const entries = await this.readTopicEntriesForRewrite(entry.scope, entry.topic, state);

    const nextEntries = [...entries.filter((current) => current.id !== entry.id), entry];
    await this.fileOps.writeTextFile(topicFile, topicFileContents(entry.topic, nextEntries));
  }

  private async deleteEntry(
    scope: MemoryScope,
    topic: string,
    id: string,
    state: MemoryRecordState = "active"
  ): Promise<boolean> {
    const topicFile =
      state === "active" ? this.getTopicFile(scope, topic) : this.getArchiveTopicFile(scope, topic);
    if (!(await fileExists(topicFile))) {
      return false;
    }

    const existingEntries = await this.readTopicEntriesForRewrite(scope, topic, state);
    const nextEntries = existingEntries.filter((entry) => entry.id !== id);
    if (nextEntries.length === existingEntries.length) {
      return false;
    }

    if (nextEntries.length === 0) {
      await this.fileOps.deleteFile(topicFile);
    } else {
      await this.fileOps.writeTextFile(topicFile, topicFileContents(topic, nextEntries));
    }

    return true;
  }

  public async forget(
    scope: MemoryScope | "all",
    query: string,
    options: {
      archive?: boolean;
    } = {}
  ): Promise<MemoryEntry[]> {
    if (query.trim().length === 0) {
      throw new Error("Forget query must be non-empty.");
    }

    const scopes: MemoryScope[] =
      scope === "all" ? ["global", "project", "project-local"] : [scope];
    const deleted: MemoryEntry[] = [];
    const mutations: MemoryMutation[] = [];
    const normalizedTerms = normalizeMemoryQueryTerms(query);
    if (normalizedTerms.length === 0) {
      throw new Error("Forget query must be non-empty.");
    }

    for (const currentScope of scopes) {
      const entries = await this.listEntries(currentScope, "active");
      for (const entry of entries) {
        const haystack = `${entry.id}\n${entry.topic}\n${entry.summary}\n${entry.details.join("\n")}`;
        if (!matchesAllMemoryQueryTerms(haystack, normalizedTerms)) {
          continue;
        }

        deleted.push(entry);
        mutations.push({
          action: options.archive ? "archive" : "delete",
          scope: currentScope,
          topic: entry.topic,
          id: entry.id,
          summary: entry.summary,
          details: entry.details,
          sources: ["manual"],
          reason: options.archive
            ? "Manual archive request."
            : "Explicit forget instruction from the user."
        });
      }
    }

    if (mutations.length > 0) {
      await this.applyMutations(mutations);
    }

    return deleted;
  }

  public async readMemoryFile(
    scope: MemoryScope,
    state: MemoryRecordState = "active",
    options: {
      createIfMissing?: boolean;
      excludeUnsafeTopics?: boolean;
    } = {}
  ): Promise<string> {
    const memoryFile = state === "active" ? this.getMemoryFile(scope) : this.getArchiveIndexFile(scope);
    if (!(await fileExists(memoryFile))) {
      if (options.createIfMissing !== false) {
        if (state === "active") {
          await this.rebuildIndex(scope);
        } else {
          await this.rebuildArchiveIndex(scope);
        }
      } else {
        return state === "active"
          ? buildIndexContents(scope, [])
          : buildArchiveIndexContents(scope, []);
      }
    }

    if (options.excludeUnsafeTopics) {
      const entries = await this.listEntries(scope, state, {
        excludeUnsafeTopics: true
      });
      return state === "active"
        ? buildIndexContents(scope, entries)
        : buildArchiveIndexContents(scope, entries);
    }

    return readTextFile(memoryFile);
  }

  public async readHistory(scope: MemoryScope, limit?: number): Promise<MemoryTimelineEvent[]> {
    return (await this.readHistoryWithDiagnostics(scope, limit)).events;
  }

  public async readHistoryWithDiagnostics(
    scope: MemoryScope,
    limit?: number
  ): Promise<HistoryReadResult> {
    const historyPath = this.getHistoryPath(scope);
    if (!(await fileExists(historyPath))) {
      return {
        events: [],
        warnings: [],
        historyPath
      };
    }

    const raw = await readTextFile(historyPath);
    let invalidJsonLineCount = 0;
    let invalidEventCount = 0;
    const parsed = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const candidate = JSON.parse(line) as unknown;
          if (isTimelineEvent(candidate)) {
            return [candidate];
          }

          invalidEventCount += 1;
          return [];
        } catch {
          invalidJsonLineCount += 1;
          return [];
        }
      })
      .sort((left, right) => right.at.localeCompare(left.at));

    return {
      events: typeof limit === "number" ? parsed.slice(0, limit) : parsed,
      warnings: buildHistoryWarnings(historyPath, invalidJsonLineCount, invalidEventCount),
      historyPath
    };
  }

  private async readSyncAuditEntries(): Promise<SyncAuditReadResult> {
    const auditPath = this.getSyncAuditPath();
    if (!(await fileExists(auditPath))) {
      return {
        entries: [],
        warnings: []
      };
    }

    const raw = await readTextFile(auditPath);
    let invalidJsonLineCount = 0;
    let invalidEntryCount = 0;
    const entries = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const parsed = parseMemorySyncAuditEntry(JSON.parse(line) as unknown);
          if (parsed) {
            return [parsed];
          }

          invalidEntryCount += 1;
          return [];
        } catch {
          invalidJsonLineCount += 1;
          return [];
        }
      })
      .sort((left, right) => right.appliedAt.localeCompare(left.appliedAt));

    const warnings: string[] = [];
    if (invalidJsonLineCount > 0) {
      warnings.push(
        `Sync audit source ${auditPath} contains ${invalidJsonLineCount} invalid JSON line(s); malformed audit provenance was ignored.`
      );
    }
    if (invalidEntryCount > 0) {
      warnings.push(
        `Sync audit source ${auditPath} contains ${invalidEntryCount} malformed audit entry line(s); unsupported audit provenance was ignored.`
      );
    }

    return {
      entries,
      warnings
    };
  }

  private async findLatestSyncAuditSummary(
    scope: MemoryScope,
    topic: string,
    id: string,
    latestRolloutPath?: string,
    latestSessionId?: string,
    allowNoopProvenanceMatch = false
  ): Promise<{
    summary: MemorySyncAuditSummary | null;
    warnings: string[];
  }> {
    if (latestRolloutPath === undefined && latestSessionId === undefined) {
      return {
        summary: null,
        warnings: []
      };
    }

    const { entries, warnings } = await this.readSyncAuditEntries();
    const matched = entries.find((entry) => {
      const matchesProvenance =
        latestRolloutPath !== undefined
          ? entry.rolloutPath === latestRolloutPath &&
            (latestSessionId === undefined || entry.sessionId === latestSessionId)
          : latestSessionId !== undefined && entry.sessionId === latestSessionId;

      if (!matchesProvenance) {
        return false;
      }

      return (
        entry.operations.some(
          (operation) =>
            operation.scope === scope && operation.topic === topic && operation.id === id
        ) ||
        (allowNoopProvenanceMatch && (entry.noopOperationCount ?? 0) > 0)
      );
    });

    if (!matched) {
      return {
        summary: null,
        warnings
      };
    }

    const matchedOperations = matched.operations.filter(
      (operation) => operation.scope === scope && operation.topic === topic && operation.id === id
    );
    if (matchedOperations.length === 0) {
      return {
        summary: null,
        warnings
      };
    }

    return {
      summary: {
        auditPath: this.getSyncAuditPath(),
        appliedAt: matched.appliedAt,
        rolloutPath: matched.rolloutPath,
        sessionId: matched.sessionId,
        status: matched.status,
        resultSummary: matched.resultSummary,
        matchedOperationCount: matchedOperations.length,
        noopOperationCount: matched.noopOperationCount ?? 0,
        suppressedOperationCount: matched.suppressedOperationCount ?? 0,
        rejectedOperationCount: matched.rejectedOperationCount ?? 0,
        rejectedReasonCounts: matched.rejectedReasonCounts,
        rejectedOperations: matched.rejectedOperations,
        conflicts: matched.conflicts ?? []
      },
      warnings
    };
  }

  private async appendHistoryEntry(entry: MemoryTimelineEvent): Promise<void> {
    await appendJsonl(this.getHistoryPath(entry.scope), entry);
  }

  private async findEntry(
    scope: MemoryScope,
    state: MemoryRecordState,
    topic: string,
    id: string
  ): Promise<MemoryEntry | null> {
    const entries = await this.listEntries(scope, state);
    return entries.find((entry) => entry.topic === topic && entry.id === id) ?? null;
  }

  public async getSyncState(): Promise<Required<SyncState>> {
    const state = await readJsonFile<unknown>(this.paths.stateFile);
    if (state === null) {
      return normalizeSyncState(null);
    }

    if (!isSyncStateShape(state)) {
      throw new Error(`Invalid sync state file: ${this.paths.stateFile}`);
    }

    return normalizeSyncState(state);
  }

  public async markRolloutProcessed(identity: ProcessedRolloutIdentity): Promise<void> {
    const state = await this.getSyncState();
    const processedAt = new Date().toISOString();
    state.processedRollouts[identity.rolloutPath] = processedAt;
    state.processedRolloutEntries = [
      ...state.processedRolloutEntries.filter((entry) => !sameProcessedIdentity(entry, identity)),
      {
        ...identity,
        processedAt
      }
    ];
    await writeJsonFile(this.paths.stateFile, state);
  }

  public async hasProcessedRollout(identity: ProcessedRolloutIdentity): Promise<boolean> {
    const state = await this.getSyncState();
    return state.processedRolloutEntries.some((entry) => sameProcessedIdentity(entry, identity));
  }

  public async appendSyncAuditEntry(entry: MemorySyncAuditEntry): Promise<void> {
    await ensureDir(this.paths.auditDir);
    await appendJsonl(this.getSyncAuditPath(), entry);
  }

  public async readRecentSyncAuditEntries(limit = 5): Promise<MemorySyncAuditEntry[]> {
    return (await this.readSyncAuditEntries()).entries.slice(0, limit);
  }

  public async writeSyncRecoveryRecord(record: SyncRecoveryRecord): Promise<void> {
    await writeJsonFile(this.getSyncRecoveryPath(), record);
  }

  public async readSyncRecoveryRecord(): Promise<SyncRecoveryRecord | null> {
    const recoveryPath = this.getSyncRecoveryPath();
    const record = await readJsonFile<unknown>(recoveryPath);
    if (record === null) {
      return null;
    }

    if (!isSyncRecoveryRecord(record)) {
      throw new Error(`Invalid sync recovery record: ${recoveryPath}`);
    }

    return normalizeSyncRecoveryRecord(record);
  }

  public async clearSyncRecoveryRecord(): Promise<void> {
    await fs.rm(this.getSyncRecoveryPath(), { force: true });
  }

  public listSuggestedTopics(): readonly string[] {
    return DEFAULT_MEMORY_TOPICS;
  }
}
