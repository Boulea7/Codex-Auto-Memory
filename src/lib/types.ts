export type MemoryScope = "global" | "project" | "project-local";
export type MemoryRecordState = "active" | "archived";
export type MemoryHistoryRecordState = MemoryRecordState | "deleted";
export type MemoryLifecycleAction = "add" | "update" | "delete" | "archive" | "noop";
export type MemoryRetrievalScope = MemoryScope | "all";
export type MemoryRetrievalResolvedState = MemoryRecordState | "all";
export type MemoryRetrievalStateFilter = MemoryRetrievalResolvedState | "auto";
export type MemoryRetrievalMode = "index" | "markdown-fallback";
export type MemoryRetrievalFallbackReason = "missing" | "invalid" | "stale";
export type SessionContinuityScope = "project" | "project-local";
export type SessionContinuityLocalPathStyle = "codex" | "claude";
export type SessionContinuityWriteMode = "merge" | "replace";
export type SessionContinuityAuditTrigger =
  | "manual-save"
  | "manual-refresh"
  | "wrapper-auto-save";

export interface MemoryEntry {
  id: string;
  scope: MemoryScope;
  topic: string;
  summary: string;
  details: string[];
  updatedAt: string;
  sources: string[];
  reason?: string;
}

export interface MemoryOperation {
  action: "upsert" | "delete";
  scope: MemoryScope;
  topic: string;
  id: string;
  summary?: string;
  details?: string[];
  sources?: string[];
  reason?: string;
}

export interface MemoryMutation {
  action: "upsert" | "delete" | "archive";
  scope: MemoryScope;
  topic: string;
  id: string;
  summary?: string;
  details?: string[];
  sources?: string[];
  reason?: string;
}

export interface MemoryRef {
  ref: string;
  scope: MemoryScope;
  state: MemoryRecordState;
  topic: string;
  id: string;
}

export interface MemorySearchResult extends MemoryRef {
  summary: string;
  updatedAt: string;
  matchedFields: string[];
  approxReadCost: number;
}

export interface MemorySearchDiagnosticPath {
  scope: MemoryScope;
  state: MemoryRecordState;
  retrievalMode: MemoryRetrievalMode;
  retrievalFallbackReason?: MemoryRetrievalFallbackReason;
  matchedCount: number;
  indexPath: string;
  generatedAt: string | null;
}

export interface MemorySearchDiagnostics {
  anyMarkdownFallback: boolean;
  fallbackReasons: MemoryRetrievalFallbackReason[];
  checkedPaths: MemorySearchDiagnosticPath[];
}

export interface MemorySearchResponse {
  query: string;
  scope: MemoryRetrievalScope;
  state: MemoryRetrievalStateFilter;
  resolvedState: MemoryRetrievalResolvedState;
  fallbackUsed: boolean;
  stateFallbackUsed: boolean;
  markdownFallbackUsed: boolean;
  retrievalMode: MemoryRetrievalMode;
  retrievalFallbackReason?: MemoryRetrievalFallbackReason;
  diagnostics: MemorySearchDiagnostics;
  results: MemorySearchResult[];
}

export interface MemoryTimelineEvent {
  at: string;
  action: Exclude<MemoryLifecycleAction, "noop">;
  scope: MemoryScope;
  state: MemoryHistoryRecordState;
  topic: string;
  id: string;
  ref?: string;
  summary: string;
  reason?: string;
  source?: string;
  sessionId?: string;
  rolloutPath?: string;
}

export interface MemoryTimelineResponse {
  ref: string;
  events: MemoryTimelineEvent[];
  warnings: string[];
  lineageSummary: MemoryLineageSummary;
}

export interface MemoryLineageSummary {
  eventCount: number;
  firstSeenAt: string | null;
  latestAt: string | null;
  latestAction: Exclude<MemoryLifecycleAction, "noop"> | null;
  latestState: MemoryHistoryRecordState | null;
  archivedAt: string | null;
  deletedAt: string | null;
  latestAuditStatus: MemorySyncAuditStatus | null;
  noopOperationCount: number;
  suppressedOperationCount: number;
  conflictCount: number;
}

export interface MemoryDetailsResult extends MemoryRef {
  entry: MemoryEntry;
  path: string;
  approxReadCost: number;
  latestLifecycleAction: Exclude<MemoryLifecycleAction, "noop"> | null;
  latestState: MemoryHistoryRecordState;
  latestSessionId: string | null;
  latestRolloutPath: string | null;
  historyPath: string;
  latestAudit: MemorySyncAuditSummary | null;
  timelineWarningCount: number;
  lineageSummary: MemoryLineageSummary;
  warnings: string[];
}

export interface MemorySyncAuditSummary {
  auditPath: string;
  appliedAt: string;
  rolloutPath: string;
  sessionId?: string;
  status: MemorySyncAuditStatus;
  resultSummary: string;
  noopOperationCount: number;
  suppressedOperationCount: number;
  conflicts: MemoryConflictCandidate[];
}

export interface MemoryApplyRecord {
  operation: MemoryMutation;
  lifecycleAction: MemoryLifecycleAction;
  previousState?: MemoryRecordState;
  nextState?: MemoryHistoryRecordState;
}

export type MemoryConflictSource = "within-rollout" | "existing-memory";

export type MemoryConflictResolution = "suppressed";

export interface MemoryConflictCandidate {
  scope: MemoryScope;
  topic: string;
  candidateSummary: string;
  conflictsWith: string[];
  source: MemoryConflictSource;
  resolution: MemoryConflictResolution;
}

export interface CompiledStartupMemory {
  text: string;
  lineCount: number;
  sourceFiles: string[];
  topicFiles: TopicFileRef[];
}

export interface TopicFileRef {
  scope: MemoryScope;
  topic: string;
  path: string;
}

export interface AppConfig {
  autoMemoryEnabled: boolean;
  autoMemoryDirectory?: string;
  extractorMode: "codex" | "heuristic";
  defaultScope: Exclude<MemoryScope, "global">;
  maxStartupLines: number;
  sessionContinuityAutoLoad: boolean;
  sessionContinuityAutoSave: boolean;
  sessionContinuityLocalPathStyle: SessionContinuityLocalPathStyle;
  maxSessionContinuityLines: number;
  codexBinary: string;
}

export interface LoadedConfig {
  config: AppConfig;
  warnings: string[];
  files: string[];
}

export type ConfigScope = "user" | "project" | "local";

export interface ProjectContext {
  cwd: string;
  projectRoot: string;
  projectId: string;
  worktreeId: string;
  gitRoot?: string;
  gitDir?: string;
  gitCommonDir?: string;
}

export interface ScopePaths {
  baseDir: string;
  globalDir: string;
  projectDir: string;
  projectLocalDir: string;
  stateFile: string;
  auditDir: string;
  syncRecoveryFile: string;
}

export interface SessionContinuityPaths {
  sharedDir: string;
  sharedFile: string;
  localDir: string;
  localFile: string;
  claudeSessionDir: string;
  codexSessionDir: string;
  auditDir: string;
  auditFile: string;
  recoveryFile: string;
}

export interface RolloutToolCall {
  callId?: string;
  name: string;
  arguments: string;
  output?: string;
}

export interface RolloutMeta {
  sessionId: string;
  createdAt: string;
  createdAtMs: number;
  cwd: string;
  rolloutPath: string;
  isSubagent?: boolean;
  forkedFromSessionId?: string;
}

export interface RolloutEvidence {
  sessionId: string;
  createdAt: string;
  cwd: string;
  userMessages: string[];
  agentMessages: string[];
  toolCalls: RolloutToolCall[];
  rolloutPath: string;
  isSubagent?: boolean;
  forkedFromSessionId?: string;
}

export interface SessionContinuityState {
  kind: "session-continuity";
  scope: SessionContinuityScope;
  projectId: string;
  worktreeId: string;
  updatedAt: string;
  status: "active" | "paused" | "done";
  sourceSessionId?: string;
  goal: string;
  confirmedWorking: string[];
  triedAndFailed: string[];
  notYetTried: string[];
  incompleteNext: string[];
  filesDecisionsEnvironment: string[];
}

export interface SessionContinuityLayerSummary {
  goal: string;
  confirmedWorking: string[];
  triedAndFailed: string[];
  notYetTried: string[];
  incompleteNext: string[];
  filesDecisionsEnvironment: string[];
}

export interface SessionContinuitySummary {
  sourceSessionId?: string;
  project: SessionContinuityLayerSummary;
  projectLocal: SessionContinuityLayerSummary;
}

export type SessionContinuityExtractorPath = "codex" | "heuristic";

export type SessionContinuityConfidence = "high" | "medium" | "low";

export type SessionContinuityFallbackReason =
  | "codex-command-failed"
  | "invalid-json"
  | "invalid-structure"
  | "low-signal"
  | "configured-heuristic";

export interface SessionContinuityEvidenceCounts {
  successfulCommands: number;
  failedCommands: number;
  fileWrites: number;
  nextSteps: number;
  untried: number;
}

export interface SessionContinuityDiagnostics {
  generatedAt: string;
  rolloutPath: string;
  sourceSessionId: string;
  preferredPath: SessionContinuityExtractorPath;
  actualPath: SessionContinuityExtractorPath;
  confidence: SessionContinuityConfidence;
  warnings: string[];
  fallbackReason?: SessionContinuityFallbackReason;
  codexExitCode?: number;
  evidenceCounts: SessionContinuityEvidenceCounts;
}

export interface SessionContinuityGenerationResult {
  summary: SessionContinuitySummary;
  diagnostics: SessionContinuityDiagnostics;
}

export interface SessionContinuityAuditEntry {
  generatedAt: string;
  projectId: string;
  worktreeId: string;
  configuredExtractorMode: SessionContinuityExtractorPath;
  trigger?: SessionContinuityAuditTrigger;
  writeMode?: SessionContinuityWriteMode;
  scope: SessionContinuityScope | "both";
  rolloutPath: string;
  sourceSessionId: string;
  preferredPath: SessionContinuityExtractorPath;
  actualPath: SessionContinuityExtractorPath;
  confidence?: SessionContinuityConfidence;
  warnings?: string[];
  fallbackReason?: SessionContinuityFallbackReason;
  codexExitCode?: number;
  evidenceCounts: SessionContinuityEvidenceCounts;
  writtenPaths: string[];
}

export interface ExistingSessionContinuityState {
  project?: SessionContinuityState | null;
  projectLocal?: SessionContinuityState | null;
}

export interface SessionContinuityLocation {
  scope: SessionContinuityScope;
  path: string;
  exists: boolean;
}

export interface CompiledSessionContinuity {
  text: string;
  lineCount: number;
  sourceFiles: string[];
}

export type MemorySyncAuditStatus = "applied" | "no-op" | "skipped";

export type MemorySyncAuditSkipReason = "already-processed" | "no-rollout-evidence";

export interface MemorySyncAuditEntry {
  appliedAt: string;
  projectId: string;
  worktreeId: string;
  rolloutPath: string;
  sessionId?: string;
  configuredExtractorMode: AppConfig["extractorMode"];
  configuredExtractorName: string;
  actualExtractorMode: AppConfig["extractorMode"];
  actualExtractorName: string;
  extractorMode: AppConfig["extractorMode"];
  extractorName: string;
  sessionSource: string;
  status: MemorySyncAuditStatus;
  skipReason?: MemorySyncAuditSkipReason;
  isRecovery?: boolean;
  appliedCount: number;
  noopOperationCount?: number;
  suppressedOperationCount?: number;
  scopesTouched: MemoryScope[];
  resultSummary: string;
  conflicts?: MemoryConflictCandidate[];
  operations: MemoryOperation[];
}

export type SyncRecoveryFailedStage = "audit-write" | "processed-state-write";

export interface SyncRecoveryRecord {
  recordedAt: string;
  projectId: string;
  worktreeId: string;
  rolloutPath: string;
  sessionId?: string;
  configuredExtractorMode: AppConfig["extractorMode"];
  configuredExtractorName: string;
  actualExtractorMode: AppConfig["extractorMode"];
  actualExtractorName: string;
  status: "applied" | "no-op";
  appliedCount: number;
  noopOperationCount?: number;
  suppressedOperationCount?: number;
  scopesTouched: MemoryScope[];
  conflicts?: MemoryConflictCandidate[];
  failedStage: SyncRecoveryFailedStage;
  failureMessage: string;
  auditEntryWritten: boolean;
}

export interface ProcessedRolloutIdentity {
  projectId: string;
  worktreeId: string;
  sessionId: string;
  rolloutPath: string;
  sizeBytes: number;
  mtimeMs: number;
}

export interface ProcessedRolloutRecord extends ProcessedRolloutIdentity {
  processedAt: string;
}

export interface MemoryCommandScopeSummary {
  scope: MemoryScope;
  count: number;
  file: string;
  topics: string[];
}

export interface MemoryCommandOutput {
  configUpdateMessage?: string;
  configFiles: string[];
  warnings: string[];
  startup: CompiledStartupMemory;
  loadedFiles: string[];
  topicFiles: TopicFileRef[];
  startupFilesByScope: {
    global: string[];
    project: string[];
    projectLocal: string[];
  };
  topicFilesByScope: {
    global: TopicFileRef[];
    project: TopicFileRef[];
    projectLocal: TopicFileRef[];
  };
  startupBudget: {
    usedLines: number;
    maxLines: number;
  };
  refCountsByScope: {
    global: { startupFiles: number; topicFiles: number };
    project: { startupFiles: number; topicFiles: number };
    projectLocal: { startupFiles: number; topicFiles: number };
  };
  scopes: MemoryCommandScopeSummary[];
  editTargets: {
    global: string;
    project: string;
    projectLocal: string;
  };
  recentSyncAudit: MemorySyncAuditEntry[];
  recentAudit: MemorySyncAuditEntry[];
  syncAuditPath: string;
  pendingSyncRecovery: SyncRecoveryRecord | null;
  syncRecoveryPath: string;
}

export interface MemoryReindexCheck {
  scope: MemoryScope;
  state: MemoryRecordState;
  status: "ok";
  indexPath: string;
  generatedAt: string;
  topicFileCount: number;
  topicFiles: string[];
}

export interface MemoryReindexOutput {
  projectRoot: string;
  requestedScope: MemoryScope | "all";
  requestedState: MemoryRecordState | "all";
  rebuilt: MemoryReindexCheck[];
  summary: string;
}

export interface SyncResult {
  applied: MemoryOperation[];
  skipped: boolean;
  message: string;
}

export type ContinuityRecoveryFailedStage = "audit-write";

export interface ContinuityRecoveryRecord {
  recordedAt: string;
  projectId: string;
  worktreeId: string;
  rolloutPath: string;
  sourceSessionId: string;
  trigger?: SessionContinuityAuditTrigger;
  writeMode?: SessionContinuityWriteMode;
  scope: SessionContinuityScope | "both";
  writtenPaths: string[];
  preferredPath: SessionContinuityExtractorPath;
  actualPath: SessionContinuityExtractorPath;
  confidence?: SessionContinuityConfidence;
  warnings?: string[];
  fallbackReason?: SessionContinuityFallbackReason;
  codexExitCode?: number;
  evidenceCounts: SessionContinuityEvidenceCounts;
  failedStage: ContinuityRecoveryFailedStage;
  failureMessage: string;
}

export type AuditSeverity = "high" | "medium" | "low" | "info";

export type AuditClassification =
  | "confirmed-risk"
  | "synthetic-test-fixture"
  | "generic-local-path"
  | "manual-review-needed";

export type AuditSourceType = "working-tree" | "git-history";

export interface AuditFinding {
  ruleId: string;
  severity: AuditSeverity;
  classification: AuditClassification;
  sourceType: AuditSourceType;
  location: string;
  summary: string;
  snippet: string;
  recommendation: string;
}

export interface AuditReport {
  generatedAt: string;
  cwd: string;
  findings: AuditFinding[];
  summary: {
    total: number;
    bySeverity: Record<AuditSeverity, number>;
    byClassification: Record<AuditClassification, number>;
  };
}
