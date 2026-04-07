import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_MEMORY_TOPICS } from "../constants.js";
import type {
  AppConfig,
  MemoryApplyRecord,
  MemoryDetailsResult,
  MemoryEntry,
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
  buildMemoryRef,
  classifyUpsertLifecycle,
  isMemoryHistoryRecordState,
  nextHistoryStateForLifecycle,
  parseMemoryRef
} from "./memory-lifecycle.js";
import { normalizeMemorySearchDiagnostics } from "./memory-retrieval-contract.js";
import { getDefaultMemoryDirectory } from "./project-context.js";
import { isSyncRecoveryRecord } from "./recovery-records.js";

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

interface HistoryReadResult {
  events: MemoryTimelineEvent[];
  warnings: string[];
  historyPath: string;
}

interface TimelineReadResult extends MemoryTimelineResponse {
  latestAudit: MemorySyncAuditSummary | null;
  latestEvent: MemoryTimelineEvent | null;
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
  expectedSnapshots: FileSnapshot[];
}

interface MemoryStoreFileOps {
  writeTextFile(filePath: string, contents: string): Promise<void>;
  deleteFile(filePath: string): Promise<void>;
}

const topicNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const retrievalIndexVersion = 1 as const;

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
  for (const block of rawBlocks) {
    const parsed = parseEntryBlock(block);
    if (!parsed) {
      unsafeReason ??= "it contains malformed or unsupported entry blocks";
      continue;
    }

    entries.push({
      ...parsed,
      topic
    });
  }

  if (normalizeManagedText(prelude) !== normalizeManagedText(topicFileHeader(topic))) {
    unsafeReason ??= "it contains unsupported manual content outside managed memory entries";
  }

  return {
    entries,
    safeToRewrite: unsafeReason === undefined,
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
  const lines = [
    `# ${topicTitle(scope)} Memory`,
    "",
    "This file is the concise startup index for this scope.",
    "It is intentionally short so it can be injected into Codex at session start.",
    "",
    "## Topics",
    ...(sortedEntries.length
      ? Array.from(new Set(sortedEntries.map((entry) => entry.topic))).map((topic) => {
          const count = sortedEntries.filter((entry) => entry.topic === topic).length;
          return `- [${topic}.md](${topic}.md): ${count} entr${count === 1 ? "y" : "ies"}`;
        })
      : ["- No topic files yet."])
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
    archivedAt: null,
    deletedAt: null,
    latestAuditStatus: null,
    noopOperationCount: 0,
    suppressedOperationCount: 0,
    conflictCount: 0
  };
}

function buildLineageSummary(
  events: MemoryTimelineEvent[],
  latestAudit: MemorySyncAuditSummary | null
): MemoryLineageSummary {
  if (events.length === 0) {
    return {
      ...buildEmptyLineageSummary(),
      latestAuditStatus: latestAudit?.status ?? null,
      noopOperationCount: latestAudit?.noopOperationCount ?? 0,
      suppressedOperationCount: latestAudit?.suppressedOperationCount ?? 0,
      conflictCount: latestAudit?.conflicts.length ?? 0
    };
  }

  const chronologicalEvents = [...events].sort((left, right) => left.at.localeCompare(right.at));
  const latestEvent = events[0] ?? null;
  const archivedEvent =
    chronologicalEvents.find((event) => event.action === "archive") ?? null;
  const deletedEvent =
    chronologicalEvents.find((event) => event.action === "delete") ?? null;

  return {
    eventCount: events.length,
    firstSeenAt: chronologicalEvents[0]?.at ?? null,
    latestAt: latestEvent?.at ?? null,
    latestAction: latestEvent?.action ?? null,
    latestState: latestEvent?.state ?? null,
    archivedAt: archivedEvent?.at ?? null,
    deletedAt: deletedEvent?.at ?? null,
    latestAuditStatus: latestAudit?.status ?? null,
    noopOperationCount: latestAudit?.noopOperationCount ?? 0,
    suppressedOperationCount: latestAudit?.suppressedOperationCount ?? 0,
    conflictCount: latestAudit?.conflicts.length ?? 0
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
      event.action === "delete" ||
      event.action === "archive") &&
    isMemoryScope(event.scope) &&
    isMemoryHistoryRecordState(event.state) &&
    typeof event.topic === "string" &&
    typeof event.id === "string" &&
    typeof event.summary === "string" &&
    (event.ref === undefined || typeof event.ref === "string") &&
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
  const normalizedTerms = query
    .trim()
    .toLowerCase()
    .split(/\s+/u)
    .filter(Boolean);
  if (normalizedTerms.length === 0) {
    return null;
  }

  const matchedFields: string[] = [];
  let score = 0;

  for (const [field, value] of fields) {
    const haystack = value.toLowerCase();
    if (!normalizedTerms.every((term) => haystack.includes(term))) {
      continue;
    }
    matchedFields.push(field);
    score += field === "summary" ? 4 : field === "details" ? 2 : 3;
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

  public async rebuildRetrievalSidecars(options: {
    scope?: MemoryScope | "all";
    state?: MemoryRecordState | "all";
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

    await this.ensureLayout();
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
    const topicFiles = await this.listTopicMarkdownFiles(scope, state);
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

  public async listEntries(
    scope: MemoryScope,
    state: MemoryRecordState = "active"
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
      entries.push(...parseTopicFile(contents, topic).entries);
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
    return files
      .filter(
        (fileName) =>
          fileName.endsWith(".md") &&
          fileName !== "MEMORY.md" &&
          fileName !== "ARCHIVE.md"
      )
      .map((fileName) => ({
        scope,
        topic: fileName.replace(/\.md$/u, ""),
        path: path.join(scopeDir, fileName)
      }))
      .filter((entry) => topicNamePattern.test(entry.topic))
      .sort((left, right) => left.topic.localeCompare(right.topic));
  }

  public async rebuildIndex(scope: MemoryScope): Promise<void> {
    const entries = await this.listEntries(scope, "active");
    await this.fileOps.writeTextFile(this.getMemoryFile(scope), buildIndexContents(scope, entries));
  }

  public async rebuildArchiveIndex(scope: MemoryScope): Promise<void> {
    const entries = await this.listEntries(scope, "archived");
    await this.fileOps.writeTextFile(
      this.getArchiveIndexFile(scope),
      buildArchiveIndexContents(scope, entries)
    );
  }

  public async rebuildRetrievalIndex(
    scope: MemoryScope,
    state: MemoryRecordState = "active"
  ): Promise<void> {
    const entries = await this.listEntries(scope, state);
    await this.fileOps.writeTextFile(
      this.getRetrievalIndexFile(scope, state),
      buildRetrievalIndexContents(scope, state, entries)
    );
  }

  public async getEntryByRef(ref: string): Promise<MemoryDetailsResult | null> {
    const parsed = parseMemoryRef(ref);
    if (!parsed) {
      return null;
    }

    const entry = await this.findEntry(parsed.scope, parsed.state, parsed.topic, parsed.id);
    if (!entry) {
      return null;
    }

    const timeline = await this.readTimelineWithDiagnostics(ref);
    const latestEvent = timeline.latestEvent;
    const latestAudit = timeline.latestAudit;
    const warnings = [...timeline.warnings];
    if (latestEvent && !latestAudit && (latestEvent.rolloutPath || latestEvent.sessionId)) {
      warnings.push(
        `Lifecycle history exists for ${ref}, but no matching sync audit entry was found in ${this.getSyncAuditPath()}.`
      );
    }

    if ((latestAudit?.noopOperationCount ?? 0) > 0) {
      warnings.push(
        `Latest sync audit recorded ${latestAudit?.noopOperationCount ?? 0} no-op operation(s).`
      );
    }

    if ((latestAudit?.suppressedOperationCount ?? 0) > 0) {
      warnings.push(
        `Latest sync audit suppressed ${latestAudit?.suppressedOperationCount ?? 0} operation(s).`
      );
    }

    if ((latestAudit?.conflicts.length ?? 0) > 0) {
      warnings.push(
        `Latest sync audit includes ${latestAudit?.conflicts.length ?? 0} suppressed conflict candidate(s).`
      );
    }

    return {
      ...parsed,
      entry,
      path:
        parsed.state === "active"
          ? this.getTopicFile(parsed.scope, parsed.topic)
          : this.getArchiveTopicFile(parsed.scope, parsed.topic),
      approxReadCost: entry.details.length + 4,
      latestLifecycleAction: latestEvent?.action ?? null,
      latestState: latestEvent?.state ?? parsed.state,
      latestSessionId: latestEvent?.sessionId ?? null,
      latestRolloutPath: latestEvent?.rolloutPath ?? null,
      historyPath: this.getHistoryPath(parsed.scope),
      latestAudit,
      timelineWarningCount: timeline.warnings.length,
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
    const results: Array<MemorySearchResult & { score: number }> = [];
    const diagnostics: MemorySearchDiagnosticPath[] = [];
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
            indexPath: retrievalIndex.indexPath,
            generatedAt: retrievalIndex.generatedAt
          });
          continue;
        }

        usedFallback = true;
        fallbackReason ??= retrievalIndex.fallbackReason ?? "missing";
        const entries = await this.listEntries(scope, state);
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
          indexPath: retrievalIndex.indexPath,
          generatedAt: retrievalIndex.generatedAt
        });
      }
    }

    const normalizedResults = results
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return right.updatedAt.localeCompare(left.updatedAt);
      })
      .slice(0, options.limit ?? 10)
      .map(({ score: _score, ...result }) => result);

    return {
      results: normalizedResults,
      retrievalMode:
        matchedViaFallback || (!matchedViaIndex && usedFallback)
          ? "markdown-fallback"
          : "index",
      retrievalFallbackReason:
        matchedViaFallback || (!matchedViaIndex && usedFallback) ? fallbackReason : undefined,
      diagnostics: normalizeMemorySearchDiagnostics(diagnostics)
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
        latestEvent: null
      };
    }

    const history = await this.readHistoryWithDiagnostics(parsed.scope);
    const events = history.events
      .filter((entry) => entry.id === parsed.id && entry.topic === parsed.topic)
      .sort((left, right) => right.at.localeCompare(left.at));
    const latestEvent = events[0] ?? null;
    const latestEventHasProvenance = Boolean(latestEvent?.rolloutPath || latestEvent?.sessionId);
    const olderEventHasProvenance = events
      .slice(1)
      .some((event) => Boolean(event.rolloutPath || event.sessionId));
    const latestAudit = await this.findLatestSyncAuditSummary(
      parsed.scope,
      parsed.topic,
      parsed.id,
      latestEvent?.rolloutPath,
      latestEvent?.sessionId
    );
    const warnings = [...history.warnings];
    if (latestEvent && !latestAudit && latestEventHasProvenance) {
      warnings.push(
        `Lifecycle history exists for ${ref}, but no matching sync audit entry was found in ${this.getSyncAuditPath()}.`
      );
    }
    if (latestEvent && !latestEventHasProvenance && olderEventHasProvenance) {
      warnings.push(
        `Latest lifecycle event for ${ref} has no rollout/session provenance, so latestAudit was not backfilled from an older sync audit entry.`
      );
    }

    return {
      ref,
      events,
      warnings,
      lineageSummary: buildLineageSummary(events, latestAudit),
      latestAudit,
      latestEvent
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
    const expectedSnapshots = new Map<string, FileSnapshot>();
    const getFileSnapshot = async (filePath: string): Promise<FileSnapshot> => ({
      path: filePath,
      contents: await this.readTextFileIfExists(filePath)
    });

    const getTopicSnapshot = async (
      scope: MemoryScope,
      topic: string,
      state: MemoryRecordState
    ): Promise<void> => {
      const topicFile = this.topicFilePath(scope, topic, state);
      if (expectedSnapshots.has(topicFile)) {
        return;
      }

      const snapshot = await getFileSnapshot(topicFile);
      if (snapshot.contents === null) {
        expectedSnapshots.set(topicFile, snapshot);
        return;
      }

      const contents = snapshot.contents;
      const parsed = parseTopicFile(contents, topic);
      if (!parsed.safeToRewrite) {
        throw new Error(
          `Cannot rewrite topic file ${topicFile} because ${parsed.unsafeReason ?? "it is not safely round-trippable"}. Fix the file manually before editing durable memory.`
        );
      }

      expectedSnapshots.set(topicFile, snapshot);
    };

    for (const mutation of mutations) {
      if (!scopeStates.has(mutation.scope)) {
        scopeStates.set(mutation.scope, await this.loadScopeMutationState(mutation.scope));
      }

      const scopeState = scopeStates.get(mutation.scope);
      if (!scopeState) {
        continue;
      }

      const topic = normalizeTopicName(mutation.topic);
      await getTopicSnapshot(mutation.scope, topic, "active");
      const existingActive = this.findEntryInEntries(scopeState.activeEntries, topic, mutation.id);
      const existingArchived = this.findEntryInEntries(
        scopeState.archivedEntries,
        topic,
        mutation.id
      );

      if (mutation.action === "archive" || existingArchived) {
        await getTopicSnapshot(mutation.scope, topic, "archived");
      }

      if (mutation.action === "upsert") {
        if (!mutation.summary) {
          throw new Error(
            `Invalid upsert mutation for ${mutation.scope}/${topic}/${mutation.id}: summary is required.`
          );
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
          applied.push({
            operation: appliedOperation,
            lifecycleAction,
            previousState: "active",
            nextState: "active"
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

    for (const change of fileChanges) {
      if (expectedSnapshots.has(change.path)) {
        continue;
      }
      expectedSnapshots.set(change.path, await getFileSnapshot(change.path));
    }

    return {
      applied,
      fileChanges,
      expectedSnapshots: Array.from(expectedSnapshots.values())
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

  private async assertSnapshotsUnchanged(expectedSnapshots: FileSnapshot[]): Promise<void> {
    for (const snapshot of expectedSnapshots) {
      const currentContents = await this.readTextFileIfExists(snapshot.path);
      if (currentContents !== snapshot.contents) {
        throw new Error(
          `Cannot apply durable memory changes because ${snapshot.path} changed since the mutation plan was built. Re-run the operation after reviewing the latest file contents.`
        );
      }
    }
  }

  private async commitPlannedFileChanges(
    fileChanges: PlannedFileChange[],
    expectedSnapshots: FileSnapshot[]
  ): Promise<void> {
    if (fileChanges.length === 0) {
      return;
    }

    await this.assertSnapshotsUnchanged(expectedSnapshots);
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
    const plan = await this.buildMutationCommitPlan(mutations, options);
    await this.commitPlannedFileChanges(plan.fileChanges, plan.expectedSnapshots);
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
    const normalizedQuery = query.toLowerCase();

    for (const currentScope of scopes) {
      const entries = await this.listEntries(currentScope, "active");
      for (const entry of entries) {
        const haystack = `${entry.id}\n${entry.summary}\n${entry.details.join("\n")}`.toLowerCase();
        if (!haystack.includes(normalizedQuery)) {
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
    state: MemoryRecordState = "active"
  ): Promise<string> {
    const memoryFile = state === "active" ? this.getMemoryFile(scope) : this.getArchiveIndexFile(scope);
    if (!(await fileExists(memoryFile))) {
      if (state === "active") {
        await this.rebuildIndex(scope);
      } else {
        await this.rebuildArchiveIndex(scope);
      }
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

  private async readSyncAuditEntries(): Promise<MemorySyncAuditEntry[]> {
    const auditPath = this.getSyncAuditPath();
    if (!(await fileExists(auditPath))) {
      return [];
    }

    const raw = await readTextFile(auditPath);
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const parsed = parseMemorySyncAuditEntry(JSON.parse(line) as unknown);
          return parsed ? [parsed] : [];
        } catch {
          return [];
        }
      })
      .sort((left, right) => right.appliedAt.localeCompare(left.appliedAt));
  }

  private async findLatestSyncAuditSummary(
    scope: MemoryScope,
    topic: string,
    id: string,
    latestRolloutPath?: string,
    latestSessionId?: string
  ): Promise<MemorySyncAuditSummary | null> {
    if (latestRolloutPath === undefined && latestSessionId === undefined) {
      return null;
    }

    const entries = await this.readSyncAuditEntries();
    const matched =
      entries.find(
          (entry) =>
            latestRolloutPath !== undefined &&
            entry.rolloutPath === latestRolloutPath &&
            (latestSessionId === undefined || entry.sessionId === latestSessionId) &&
            entry.operations.some(
              (operation) =>
                operation.scope === scope && operation.topic === topic && operation.id === id
            )
      );

    if (!matched) {
      return null;
    }

    return {
      auditPath: this.getSyncAuditPath(),
      appliedAt: matched.appliedAt,
      rolloutPath: matched.rolloutPath,
      sessionId: matched.sessionId,
      status: matched.status,
      resultSummary: matched.resultSummary,
      noopOperationCount: matched.noopOperationCount ?? 0,
      suppressedOperationCount: matched.suppressedOperationCount ?? 0,
      conflicts: matched.conflicts ?? []
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
    return (await this.readSyncAuditEntries()).slice(0, limit);
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

    return record;
  }

  public async clearSyncRecoveryRecord(): Promise<void> {
    await fs.rm(this.getSyncRecoveryPath(), { force: true });
  }

  public listSuggestedTopics(): readonly string[] {
    return DEFAULT_MEMORY_TOPICS;
  }
}
