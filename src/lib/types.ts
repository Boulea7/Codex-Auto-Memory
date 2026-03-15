export type MemoryScope = "global" | "project" | "project-local";

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
}

export interface RolloutEvidence {
  sessionId: string;
  createdAt: string;
  cwd: string;
  userMessages: string[];
  agentMessages: string[];
  toolCalls: RolloutToolCall[];
  rolloutPath: string;
}

export interface SyncResult {
  applied: MemoryOperation[];
  skipped: boolean;
  message: string;
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
