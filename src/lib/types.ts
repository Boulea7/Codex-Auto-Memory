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
