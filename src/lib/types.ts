export type MemoryScope = "global" | "project" | "project-local";
export type MemoryRecordState = "active" | "archived";
export type MemoryHistoryRecordState = MemoryRecordState | "deleted";
export type MemoryLifecycleAction =
  | "add"
  | "update"
  | "restore"
  | "delete"
  | "archive"
  | "noop";
export type MemoryLifecycleAttemptOutcome = "applied" | "noop";
export type MemoryLifecycleUpdateKind =
  | "overwrite"
  | "semantic-overwrite"
  | "metadata-only"
  | "restore";
export type MemoryOperationRejectionReason =
  | "unknown-topic"
  | "sensitive"
  | "volatile"
  | "empty-summary"
  | "operation-cap";
export type StartupMemoryOmissionReason =
  | "low-signal"
  | "unsafe-topic"
  | "duplicate-summary"
  | "budget-trimmed"
  | "budget-not-reached"
  | "no-eligible-entry";
export type StartupMemoryOmissionTarget = "highlight" | "topic-file" | "scope-block";
export type StartupMemoryOmissionStage = "selection" | "render";
export type StartupMemoryHighlightSelectionReason = "eligible-highlight";
export type StartupMemoryOmissionBudgetKind = "per-scope-highlight-cap" | "global-highlight-cap" | "line-budget";
export type MemoryRetrievalScope = MemoryScope | "all";
export type MemoryRetrievalResolvedState = MemoryRecordState | "all";
export type MemoryRetrievalStateFilter = MemoryRetrievalResolvedState | "auto";
export type MemoryRetrievalMode = "index" | "markdown-fallback";
export type MemoryRetrievalFallbackReason = "missing" | "invalid" | "stale";
export type MemorySearchStateResolutionOutcome =
  | "active-hit"
  | "archived-hit"
  | "miss-after-both"
  | "explicit-state";
export type MemorySearchExecutionMode = "index-only" | "markdown-fallback-only" | "mixed";
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
  action: "upsert" | "delete" | "archive";
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

export interface RejectedMemoryOperationSummary {
  action: MemoryOperation["action"];
  scope: MemoryScope;
  topic: string;
  id: string;
  reason: MemoryOperationRejectionReason;
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
  globalRank: number;
}

export interface MemorySearchResultWindow {
  start: number;
  end: number;
  limit: number;
}

export interface MemorySearchDiagnosticPath {
  scope: MemoryScope;
  state: MemoryRecordState;
  retrievalMode: MemoryRetrievalMode;
  retrievalFallbackReason?: MemoryRetrievalFallbackReason;
  matchedCount: number;
  returnedCount: number;
  droppedCount: number;
  indexPath: string;
  generatedAt: string | null;
}

export interface MemorySearchDiagnostics {
  anyMarkdownFallback: boolean;
  fallbackReasons: MemoryRetrievalFallbackReason[];
  executionModes: MemoryRetrievalMode[];
  checkedPaths: MemorySearchDiagnosticPath[];
  topicDiagnostics?: TopicFileDiagnostic[];
}

export interface MemorySearchStateResolution {
  outcome: MemorySearchStateResolutionOutcome;
  searchedStates: MemoryRecordState[];
  resolutionReason: string;
}

export interface MemorySearchExecutionSummary {
  mode: MemorySearchExecutionMode;
  retrievalModes: MemoryRetrievalMode[];
  fallbackReasons: MemoryRetrievalFallbackReason[];
}

export interface MemorySearchResponse {
  query: string;
  scope: MemoryRetrievalScope;
  state: MemoryRetrievalStateFilter;
  resolvedState: MemoryRetrievalResolvedState;
  searchOrder: string[];
  totalMatchedCount: number;
  returnedCount: number;
  globalLimitApplied: boolean;
  truncatedCount: number;
  resultWindow: MemorySearchResultWindow;
  fallbackUsed: boolean;
  stateFallbackUsed: boolean;
  markdownFallbackUsed: boolean;
  finalRetrievalMode: MemoryRetrievalMode;
  retrievalMode: MemoryRetrievalMode;
  retrievalFallbackReason?: MemoryRetrievalFallbackReason;
  stateResolution: MemorySearchStateResolution;
  executionSummary: MemorySearchExecutionSummary;
  diagnostics: MemorySearchDiagnostics;
  results: MemorySearchResult[];
  querySurfacing?: {
    suggestedDreamRefs: DreamRelevantMemoryRef[];
    suggestedInstructionFiles: string[];
    topDurableRefs?: DreamRelevantMemoryRef[];
    suggestedTeamEntries?: TeamMemorySuggestion[];
  };
}

export interface MemoryTimelineEvent {
  at: string;
  action: MemoryLifecycleAction;
  scope: MemoryScope;
  state: MemoryHistoryRecordState;
  topic: string;
  id: string;
  ref?: string;
  summary: string;
  outcome?: MemoryLifecycleAttemptOutcome;
  previousState?: MemoryHistoryRecordState;
  nextState?: MemoryHistoryRecordState;
  updateKind?: MemoryLifecycleUpdateKind;
  reason?: string;
  source?: string;
  sessionId?: string;
  rolloutPath?: string;
}

export interface MemoryLifecycleAttempt {
  at: string;
  action: MemoryLifecycleAction;
  outcome: MemoryLifecycleAttemptOutcome;
  state: MemoryHistoryRecordState | null;
  previousState: MemoryHistoryRecordState | null;
  nextState: MemoryHistoryRecordState | null;
  summary: string;
  updateKind: MemoryLifecycleUpdateKind | null;
  sessionId: string | null;
  rolloutPath: string | null;
}

export interface MemoryAppliedLifecycle {
  at: string;
  action: Exclude<MemoryLifecycleAction, "noop">;
  outcome: "applied";
  state: MemoryHistoryRecordState | null;
  previousState: MemoryHistoryRecordState | null;
  nextState: MemoryHistoryRecordState | null;
  summary: string;
  updateKind: MemoryLifecycleUpdateKind | null;
  sessionId: string | null;
  rolloutPath: string | null;
}

export interface MemoryTimelineResponse {
  ref: string;
  events: MemoryTimelineEvent[];
  warnings: string[];
  latestAudit: MemorySyncAuditSummary | null;
  lineageSummary: MemoryLineageSummary;
  latestAppliedLifecycle: MemoryAppliedLifecycle | null;
  latestLifecycleAttempt: MemoryLifecycleAttempt | null;
}

export interface MemoryLineageSummary {
  eventCount: number;
  firstSeenAt: string | null;
  latestAt: string | null;
  latestAction: Exclude<MemoryLifecycleAction, "noop"> | null;
  latestState: MemoryHistoryRecordState | null;
  latestAttemptedAction: MemoryLifecycleAction | null;
  latestAttemptedState: MemoryHistoryRecordState | null;
  latestAttemptedOutcome: MemoryLifecycleAttemptOutcome | null;
  latestUpdateKind: MemoryLifecycleUpdateKind | null;
  archivedAt: string | null;
  deletedAt: string | null;
  latestAuditStatus: MemorySyncAuditStatus | null;
  refNoopCount: number;
  matchedAuditOperationCount: number;
  rolloutNoopOperationCount: number;
  rolloutSuppressedOperationCount: number;
  rolloutConflictCount: number;
  noopOperationCount: number;
  suppressedOperationCount: number;
  conflictCount: number;
  rejectedOperationCount: number;
  rejectedReasonCounts?: Partial<Record<MemoryOperationRejectionReason, number>>;
}

export interface MemoryDetailsResult extends MemoryRef {
  entry: MemoryEntry;
  path: string;
  approxReadCost: number;
  latestLifecycleAction: Exclude<MemoryLifecycleAction, "noop"> | null;
  latestAppliedLifecycle: MemoryAppliedLifecycle | null;
  latestLifecycleAttempt: MemoryLifecycleAttempt | null;
  latestState: MemoryHistoryRecordState;
  latestSessionId: string | null;
  latestRolloutPath: string | null;
  historyPath: string;
  latestAudit: MemorySyncAuditSummary | null;
  timelineWarningCount: number;
  lineageSummary: MemoryLineageSummary;
  warnings: string[];
}

export interface ManualMutationFollowUp {
  timelineRefs: string[];
  detailsRefs: string[];
}

export interface ManualMutationSummary {
  matchedCount: number;
  appliedCount: number;
  noopCount: number;
  affectedCount: number;
}

export interface ManualMutationPrimaryEntry {
  ref: string;
  timelineRef: string;
  detailsRef: string | null;
  lifecycleAction: MemoryLifecycleAction;
}

export interface RolloutReviewerSummary {
  matchedAuditOperationCount: number;
  noopOperationCount: number;
  suppressedOperationCount: number;
  rejectedOperationCount: number;
  rejectedReasonCounts?: Partial<Record<MemoryOperationRejectionReason, number>>;
  rolloutConflictCount: number;
  uniqueAuditCount: number;
  auditCountsDeduplicated: boolean;
  warningCount: number;
  warningsByEntryRef?: Record<string, number>;
}

export interface ManualMutationReviewEntry {
  ref: string;
  timelineRef: string;
  detailsRef: string | null;
  scope: MemoryScope;
  state: MemoryRecordState;
  topic: string;
  id: string;
  path: string | null;
  historyPath: string;
  lifecycleAction: MemoryLifecycleAction;
  latestLifecycleAction: Exclude<MemoryLifecycleAction, "noop"> | null;
  latestAppliedLifecycle: MemoryAppliedLifecycle | null;
  latestLifecycleAttempt: MemoryLifecycleAttempt | null;
  latestState: MemoryHistoryRecordState;
  latestSessionId: string | null;
  latestRolloutPath: string | null;
  latestAudit: MemorySyncAuditSummary | null;
  timelineWarningCount: number;
  lineageSummary: MemoryLineageSummary;
  warnings: string[];
  entry: MemoryEntry;
}

export interface ManualMutationRememberPayload {
  action: "remember";
  mutationKind: "remember";
  entryCount: number;
  warningCount: number;
  uniqueAuditCount: number;
  auditCountsDeduplicated: boolean;
  warningsByEntryRef: Record<string, number>;
  leadEntryRef: string;
  leadEntryIndex: number;
  detailsAvailable: boolean;
  reviewRefState: MemoryRecordState;
  matchedCount: number;
  appliedCount: number;
  noopCount: number;
  affectedCount: number;
  affectedRefs: string[];
  summary: ManualMutationSummary;
  reviewerSummary: RolloutReviewerSummary;
  primaryEntry: ManualMutationPrimaryEntry;
  followUp: ManualMutationFollowUp;
  nextRecommendedActions: string[];
  entries: ManualMutationReviewEntry[];
  text: string;
  scope: MemoryScope;
  topic: string;
  id: string;
  ref: string;
  timelineRef: string;
  detailsRef: string | null;
  path: string | null;
  historyPath: string;
  lifecycleAction: MemoryLifecycleAction;
  latestLifecycleAction: Exclude<MemoryLifecycleAction, "noop"> | null;
  latestAppliedLifecycle: MemoryAppliedLifecycle | null;
  latestLifecycleAttempt: MemoryLifecycleAttempt | null;
  latestState: MemoryHistoryRecordState;
  latestSessionId: string | null;
  latestRolloutPath: string | null;
  latestAudit: MemorySyncAuditSummary | null;
  timelineWarningCount: number;
  lineageSummary: MemoryLineageSummary;
  warnings: string[];
  entry: MemoryEntry;
}

export interface ManualMutationForgetPayload {
  action: "forget";
  mutationKind: "forget";
  entryCount: number;
  warningCount: number;
  uniqueAuditCount: number;
  auditCountsDeduplicated: boolean;
  warningsByEntryRef: Record<string, number>;
  leadEntryRef: string | null;
  leadEntryIndex: number | null;
  detailsAvailable: boolean;
  reviewRefState: MemoryRecordState | null;
  detailsUsableEntryCount: number;
  timelineOnlyEntryCount: number;
  query: string;
  scope: MemoryScope | "all";
  archive: boolean;
  matchedCount: number;
  appliedCount: number;
  noopCount: number;
  affectedCount: number;
  affectedRefs: string[];
  summary: ManualMutationSummary;
  reviewerSummary: RolloutReviewerSummary;
  primaryEntry: ManualMutationPrimaryEntry | null;
  followUp: ManualMutationFollowUp;
  nextRecommendedActions: string[];
  entries: ManualMutationReviewEntry[];
  ref: string | null;
  timelineRef: string | null;
  detailsRef: string | null;
  path: string | null;
  historyPath: string | null;
  lifecycleAction: MemoryLifecycleAction | null;
  latestLifecycleAction: Exclude<MemoryLifecycleAction, "noop"> | null;
  latestAppliedLifecycle: MemoryAppliedLifecycle | null;
  latestLifecycleAttempt: MemoryLifecycleAttempt | null;
  latestState: MemoryHistoryRecordState | null;
  latestSessionId: string | null;
  latestRolloutPath: string | null;
  latestAudit: MemorySyncAuditSummary | null;
  timelineWarningCount: number;
  lineageSummary: MemoryLineageSummary | null;
  warnings: string[];
  entry: MemoryEntry | null;
}

export type ManualMutationPayload =
  | ManualMutationRememberPayload
  | ManualMutationForgetPayload;

export interface MemorySyncAuditSummary {
  auditPath: string;
  appliedAt: string;
  rolloutPath: string;
  sessionId?: string;
  status: MemorySyncAuditStatus;
  resultSummary: string;
  matchedOperationCount: number;
  noopOperationCount: number;
  suppressedOperationCount: number;
  rejectedOperationCount: number;
  rejectedReasonCounts?: Partial<Record<MemoryOperationRejectionReason, number>>;
  rejectedOperations?: RejectedMemoryOperationSummary[];
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
  highlights: StartupMemoryHighlight[];
  omissions: StartupMemoryOmission[];
  omissionCounts: Partial<Record<StartupMemoryOmissionReason, number>>;
  topicFileOmissionCounts: Partial<Record<StartupMemoryOmissionReason, number>>;
  omissionCountsByTargetAndStage: {
    highlight: { selection: number; render: number };
    topicFile: { selection: number; render: number };
    scopeBlock: { selection: number; render: number };
  };
  omittedHighlightCount: number;
  omittedTopicFileCount: number;
  topicRefCountsByScope: {
    global: { discovered: number; rendered: number; omitted: number };
    project: { discovered: number; rendered: number; omitted: number };
    projectLocal: { discovered: number; rendered: number; omitted: number };
  };
  sectionsRendered: {
    projectLocal: boolean;
    project: boolean;
    global: boolean;
    highlights: boolean;
    topicFiles: boolean;
  };
}

export interface TopicFileRef {
  scope: MemoryScope;
  topic: string;
  path: string;
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

export type MemoryLayoutDiagnosticKind =
  | "malformed-topic-filename"
  | "orphan-topic-markdown"
  | "misplaced-index-markdown"
  | "unexpected-markdown"
  | "unexpected-sidecar"
  | "missing-index"
  | "index-drift";

export interface MemoryLayoutDiagnostic {
  scope: MemoryScope;
  state: MemoryRecordState;
  kind: MemoryLayoutDiagnosticKind;
  path: string;
  fileName: string;
  message: string;
}

export interface StartupMemoryHighlight {
  scope: MemoryScope;
  topic: string;
  id: string;
  summary: string;
  selectionReason: StartupMemoryHighlightSelectionReason;
  selectionRank: number;
}

export interface StartupMemoryOmission {
  scope: MemoryScope;
  topic: string;
  id?: string;
  summary?: string;
  reason: StartupMemoryOmissionReason;
  target?: StartupMemoryOmissionTarget;
  stage?: StartupMemoryOmissionStage;
  budgetKind?: StartupMemoryOmissionBudgetKind;
  unsafeTopicReason?: string;
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
  dreamSidecarEnabled?: boolean;
  dreamSidecarAutoBuild?: boolean;
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

export interface DreamSidecarPaths {
  sharedDir: string;
  sharedFile: string;
  localDir: string;
  localFile: string;
  reviewDir: string;
  registryFile: string;
  auditDir: string;
  auditFile: string;
  recoveryFile: string;
  candidateAuditFile: string;
  candidateRecoveryFile: string;
}

export interface InstructionMemoryFile {
  kind:
    | "agents-root"
    | "claude-project"
    | "claude-hidden"
    | "gemini-project"
    | "gemini-hidden";
  path: string;
}

export interface InstructionMemoryLayer {
  detectedFiles: InstructionMemoryFile[];
}

export interface InstructionProposalTarget {
  path: string;
  kind: InstructionMemoryFile["kind"];
  exists: boolean;
  selectionReason?: string;
}

export interface InstructionProposalArtifact {
  schemaVersion: 2;
  proposalOnly: true;
  neverAutoEditsInstructionFiles: true;
  artifactDir: string;
  selectedTargetByPolicy: InstructionProposalTarget;
  resolvedApplyTarget: InstructionProposalTarget | null;
  selectedTarget: InstructionProposalTarget;
  rankedTargets: InstructionProposalTarget[];
  candidate: {
    candidateId: string;
    targetSurface: "instruction-memory";
    originKind: DreamCandidateOriginKind;
    sourceSection: DreamPromotionCandidate["sourceSection"];
    targetScopeHint: SessionContinuityScope | "unknown";
    rolloutPath: string;
    summary: string;
    details: string[];
  };
  normalizedInstruction: {
    summary: string;
    details: string[];
    sourceSection: DreamPromotionCandidate["sourceSection"];
    continuityScopeHint: SessionContinuityScope;
  };
  managedBlock: {
    formatVersion: "cam-dream-instruction-v2";
    startMarker: string;
    endMarker: string;
    body: string;
    digestSha256: string;
  };
  applyReadiness: {
    status: "safe" | "blocked" | "stale";
    recommendedOperation:
      | "create-file"
      | "append-block"
      | "replace-block"
      | "manual-rebase"
      | "blocked";
    blockedReason?: string;
    targetSnapshotDigestSha256?: string | null;
    existingManagedBlockDigestSha256?: string | null;
    staleReason?: string;
  };
  patchPlan: {
    unifiedDiff: string;
    diffDigestSha256: string;
    lineEnding: "\n" | "\r\n" | "\r";
    operation: "create-file" | "append-block" | "replace-block";
    anchor: "end-of-file" | "existing-managed-block";
  } | null;
  manualWorkflow: {
    summaryPath: string;
    diffPath: string;
    applyPrepPath: string;
    nextRecommendedActions: string[];
  };
  guidanceBlock: string;
  patchPreview: string;
  artifactPath: string;
  sourceContext: {
    candidateId: string;
    rolloutPath: string;
    sourceSection: DreamPromotionCandidate["sourceSection"];
    continuityScopeHint: SessionContinuityScope | "unknown";
  };
}

export interface RolloutToolCall {
  callId?: string;
  name: string;
  arguments: string;
  output?: string;
}

export type RolloutProvenanceKind = "primary" | "subagent";

export interface RolloutMeta {
  sessionId: string;
  createdAt: string;
  createdAtMs: number;
  cwd: string;
  rolloutPath: string;
  provenanceKind?: RolloutProvenanceKind;
  isSubagent?: boolean;
  forkedFromSessionId?: string;
}

export interface RolloutEvidence {
  sessionId: string;
  createdAt: string;
  cwd: string;
  userMessages: string[];
  agentMessages: string[];
  orderedMessages?: RolloutTranscriptMessage[];
  toolCalls: RolloutToolCall[];
  rolloutPath: string;
  provenanceKind?: RolloutProvenanceKind;
  isSubagent?: boolean;
  forkedFromSessionId?: string;
}

export interface RolloutTranscriptMessage {
  role: "user" | "agent";
  message: string;
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
  provenanceKind?: RolloutProvenanceKind;
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
  provenanceKind?: RolloutProvenanceKind;
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

export type ContinuityStartupMode = "startup";

export type ContinuityStartupProvenanceKind = "temporary-continuity";

export type ContinuityStartupSectionKind =
  | "sources"
  | "goal"
  | "confirmed-working"
  | "tried-and-failed"
  | "not-yet-tried"
  | "incomplete-next"
  | "files-decisions-environment";

export type ContinuityStartupSourceKind = "shared" | "project-local";

export type ContinuityStartupOmissionReason = "budget-trimmed";

export type ContinuityStartupOmissionTarget = "source-file" | "section";

export type ContinuityStartupOmissionStage = "render";

export interface ContinuityStartupOmission {
  target: ContinuityStartupOmissionTarget;
  stage: ContinuityStartupOmissionStage;
  reason: ContinuityStartupOmissionReason;
  path?: string;
  section?: ContinuityStartupSectionKind;
  sourceKind?: ContinuityStartupSourceKind;
}

export interface CompiledSessionContinuity {
  text: string;
  lineCount: number;
  continuityMode: ContinuityStartupMode;
  continuityProvenanceKind: ContinuityStartupProvenanceKind;
  sourceFiles: string[];
  candidateSourceFiles: string[];
  continuitySourceKinds: ContinuityStartupSourceKind[];
  continuitySectionKinds: ContinuityStartupSectionKind[];
  sectionsRendered: {
    sources: boolean;
    goal: boolean;
    confirmedWorking: boolean;
    triedAndFailed: boolean;
    notYetTried: boolean;
    incompleteNext: boolean;
    filesDecisionsEnvironment: boolean;
  };
  omissions: ContinuityStartupOmission[];
  omissionCounts: Partial<Record<ContinuityStartupOmissionReason, number>>;
  futureCompactionSeam: {
    kind: "session-summary-placeholder";
    rebuildsStartupSections: true;
    keepsDurableMemorySeparate: true;
  };
}

export interface DreamContinuityLayer {
  goal: string;
  confirmedWorking: string[];
  triedAndFailed: string[];
  notYetTried: string[];
  incompleteNext: string[];
  filesDecisionsEnvironment: string[];
}

export interface DreamRelevantMemoryRef {
  ref: string;
  reason: string;
  approxReadCost: number;
  matchedQuery: string;
}

export interface TeamMemorySuggestion {
  key: string;
  topic: string;
  scopeHint: SessionContinuityScope;
  summary: string;
  path: string;
  approxReadCost: number;
  matchedQuery: string;
  reason: string;
}

export interface TeamMemorySummary {
  available: boolean;
  status: "missing" | "available" | "invalid" | "stale";
  sourceRoot: string | null;
  indexPath: string | null;
  generatedAt: string | null;
  topicCount: number;
  entryCount: number;
  warningCount: number;
}

export interface DreamPromotionCandidate {
  summary: string;
  details: string[];
  reason: string;
  continuityScopeHint: SessionContinuityScope;
  sourceSection:
    | "goal"
    | "confirmedWorking"
    | "triedAndFailed"
    | "notYetTried"
    | "incompleteNext"
    | "filesDecisionsEnvironment";
}

export interface DreamPromotionCandidates {
  instructionLikeCandidates: DreamPromotionCandidate[];
  durableMemoryCandidates: DreamPromotionCandidate[];
}

export type DreamCandidateTargetSurface = "durable-memory" | "instruction-memory";

export type DreamCandidateOriginKind = RolloutProvenanceKind;

export type DreamCandidateStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "promoted"
  | "stale"
  | "blocked";

export interface DreamCandidateReviewState {
  decisionAt: string;
  note?: string;
  decision: "approved" | "rejected" | "pending";
  reviewerSessionId?: string;
}

export interface DreamCandidateAdoptionState {
  adoptedAt: string;
  adoptionKind: "manual";
  adoptedFromBlockedSubagent: true;
  note?: string;
  adoptedBySessionId?: string;
}

export interface DreamCandidatePromotionState {
  eligible: boolean;
  eligibleReason?: string;
  promotedAt?: string;
  promotionOutcome?: "applied" | "noop" | "proposal-only" | "blocked";
  preparedAt?: string;
  preparedPreviewDigest?: string;
  preparedArtifactPath?: string;
  applyPreparedAt?: string;
  applyReadinessStatus?: "safe" | "blocked" | "stale";
  resultRef?: string;
  resultAuditPath?: string;
  proposalArtifactPath?: string;
  selectedTargetFile?: string;
  selectedTargetKind?: InstructionMemoryFile["kind"];
  guidanceDigest?: string;
  patchDigest?: string;
}

export interface DreamCandidateRecord {
  candidateId: string;
  observationFingerprint: string;
  targetSurface: DreamCandidateTargetSurface;
  originKind: DreamCandidateOriginKind;
  targetScopeHint: SessionContinuityScope | "unknown";
  topicHint: string;
  idHint: string;
  status: DreamCandidateStatus;
  summary: string;
  details: string[];
  reason: string;
  sourceSection: DreamPromotionCandidate["sourceSection"];
  firstSeenAt: string;
  lastSeenAt: string;
  lastSeenRolloutPath: string;
  lastSeenSnapshotPath: string | null;
  review?: DreamCandidateReviewState;
  adoption?: DreamCandidateAdoptionState;
  promotion: DreamCandidatePromotionState;
  blockedReason?: string;
}

export interface DreamCandidateRegistry {
  version: 1;
  updatedAt: string;
  entries: DreamCandidateRecord[];
}

export interface DreamQueueSummary {
  totalCount: number;
  statusCounts: Partial<Record<DreamCandidateStatus, number>>;
  surfaceCounts: Partial<Record<DreamCandidateTargetSurface, number>>;
  originCounts: Partial<Record<DreamCandidateOriginKind, number>>;
}

export interface DreamSidecarSnapshot {
  version: 1;
  generatedAt: string;
  projectId: string;
  worktreeId: string;
  rolloutPath: string;
  sourceProvenanceKind?: RolloutProvenanceKind;
  continuityCompaction: {
    project: DreamContinuityLayer;
    projectLocal: DreamContinuityLayer;
  };
  relevantMemoryRefs: DreamRelevantMemoryRef[];
  promotionCandidates: DreamPromotionCandidates;
  teamMemory: TeamMemorySummary;
}

export interface DreamSidecarAuditEntry {
  generatedAt: string;
  projectId: string;
  worktreeId: string;
  rolloutPath: string;
  sourceProvenanceKind?: RolloutProvenanceKind;
  snapshotPaths: string[];
  relevantMemoryRefCount: number;
  pendingPromotionCount: number;
}

export type DreamSidecarRecoveryStage = "snapshot-write" | "audit-write";

export interface DreamSidecarRecoveryRecord {
  recordedAt: string;
  projectId: string;
  worktreeId: string;
  rolloutPath: string;
  failedStage: DreamSidecarRecoveryStage;
  failureMessage: string;
  snapshotPaths: string[];
}

export type DreamCandidateAuditAction =
  | "observed"
  | "adopted"
  | "review-approved"
  | "review-rejected"
  | "review-deferred"
  | "promotion-prepared"
  | "apply-prepared"
  | "promotion-applied"
  | "promotion-noop"
  | "promotion-proposal-only"
  | "promotion-blocked"
  | "marked-stale";

export interface DreamCandidateAuditEntry {
  recordedAt: string;
  candidateId: string;
  action: DreamCandidateAuditAction;
  status: DreamCandidateStatus;
  targetSurface: DreamCandidateTargetSurface;
  originKind: DreamCandidateOriginKind;
  rolloutPath: string;
  note?: string;
  resultRef?: string;
  resultAuditPath?: string;
}

export type DreamCandidateRecoveryStage =
  | "registry-write"
  | "adoption-write"
  | "candidate-audit-write"
  | "proposal-artifact-write"
  | "promotion-bridge";

export interface DreamCandidateRecoveryRecord {
  recordedAt: string;
  candidateId?: string;
  failedStage: DreamCandidateRecoveryStage;
  failureMessage: string;
  registryPath: string;
}

export interface DreamSidecarSummary {
  enabled: boolean;
  autoBuild: boolean;
  status: "disabled" | "missing" | "available" | "invalid" | "stale";
  latestPath: string | null;
  generatedAt: string | null;
  rolloutPath: string | null;
  relevantMemoryRefCount: number;
  pendingPromotionCount: number;
  suggestedRefCount: number;
  teamMemory?: TeamMemorySummary;
  queueSummary?: DreamQueueSummary;
  candidateRegistryPath?: string;
  candidateAuditPath?: string;
}

export interface DreamSidecarInspection {
  enabled: boolean;
  autoBuild: boolean;
  snapshots: {
    project: DreamSidecarSummary;
    projectLocal: DreamSidecarSummary;
  };
  auditPath: string;
  recoveryPath: string;
  queueSummary: DreamQueueSummary;
  candidateRegistryPath: string;
  candidateAuditPath: string;
  candidateRecoveryPath: string;
}

export type MemorySyncAuditStatus = "applied" | "no-op" | "skipped";

export type MemorySyncAuditSkipReason =
  | "already-processed"
  | "no-rollout-evidence"
  | "subagent-rollout";

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
  rejectedOperationCount?: number;
  rejectedReasonCounts?: Partial<Record<MemoryOperationRejectionReason, number>>;
  rejectedOperations?: RejectedMemoryOperationSummary[];
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
  rejectedOperationCount?: number;
  rejectedReasonCounts?: Partial<Record<MemoryOperationRejectionReason, number>>;
  rejectedOperations?: RejectedMemoryOperationSummary[];
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
  topicDiagnostics: TopicFileDiagnostic[];
  layoutDiagnostics: MemoryLayoutDiagnostic[];
  startupOmissions: StartupMemoryOmission[];
  startupOmissionCounts: Partial<Record<StartupMemoryOmissionReason, number>>;
  topicFileOmissionCounts: Partial<Record<StartupMemoryOmissionReason, number>>;
  startupOmissionCountsByTargetAndStage: {
    highlight: { selection: number; render: number };
    topicFile: { selection: number; render: number };
    scopeBlock: { selection: number; render: number };
  };
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
  highlightCount: number;
  omittedHighlightCount: number;
  omittedTopicFileCount: number;
  highlightsByScope: {
    global: StartupMemoryHighlight[];
    project: StartupMemoryHighlight[];
    projectLocal: StartupMemoryHighlight[];
  };
  startupSectionsRendered: {
    projectLocal: boolean;
    project: boolean;
    global: boolean;
    highlights: boolean;
    topicFiles: boolean;
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
  topicRefCountsByScope: {
    global: { discovered: number; rendered: number; omitted: number };
    project: { discovered: number; rendered: number; omitted: number };
    projectLocal: { discovered: number; rendered: number; omitted: number };
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
  instructionLayer: InstructionMemoryLayer;
  loadReasons: {
    startup: string[];
    dreamSidecar: string[];
  };
  startupBudgetLedger: {
    usedLines: number;
    maxLines: number;
    sectionFlags: CompiledStartupMemory["sectionsRendered"];
    omissionCounts: CompiledStartupMemory["omissionCounts"];
  };
  instructionReviewLane?: {
    queueSummary: DreamQueueSummary;
    pendingInstructionCandidateCount: number;
    approvedInstructionCandidateCount: number;
    blockedSubagentInstructionCandidateCount: number;
    latestProposalArtifactPath: string | null;
    candidateRecoveryPath: string;
    detectedInstructionTargets: string[];
  };
  dreamSidecar: DreamSidecarSummary;
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
  topicDiagnostics: TopicFileDiagnostic[];
  layoutDiagnostics: MemoryLayoutDiagnostic[];
  summary: string;
}

export interface SyncResult {
  applied: MemoryOperation[];
  skipped: boolean;
  message: string;
}

export type ContinuityRecoveryFailedStage = "summary-write" | "audit-write";

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
  provenanceKind?: RolloutProvenanceKind;
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

export interface SessionResumeContext {
  goal: string;
  nextSteps: string[];
  instructionFiles: string[];
  suggestedDurableRefs: DreamRelevantMemoryRef[];
  topDurableRefs?: DreamRelevantMemoryRef[];
  suggestedTeamEntries?: TeamMemorySuggestion[];
  continuitySourceFiles?: string[];
}
