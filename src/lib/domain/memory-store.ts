import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_MEMORY_TOPICS } from "../constants.js";
import type {
  AppConfig,
  MemoryEntry,
  MemoryOperation,
  MemoryScope,
  MemorySyncAuditEntry,
  ProcessedRolloutIdentity,
  ProcessedRolloutRecord,
  ProjectContext,
  ScopePaths,
  TopicFileRef
} from "../types.js";
import { appendJsonl, ensureDir, fileExists, readJsonFile, readTextFile, writeJsonFile, writeTextFile } from "../util/fs.js";
import { parseMemorySyncAuditEntry } from "./memory-sync-audit.js";
import { getDefaultMemoryDirectory } from "./project-context.js";

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

const topicNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

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

function parseEntryBlocks(contents: string): MemoryEntry[] {
  const blocks = contents.split(/^## /m).slice(1);
  const entries: MemoryEntry[] = [];
  for (const rawBlock of blocks) {
    const block = `## ${rawBlock}`.trim();
    const headingMatch = block.match(/^##\s+(.+)$/m);
    const metadataMatch = block.match(/<!-- cam:entry (.+?) -->/);
    const summaryMatch = block.match(/^Summary:\s+(.+)$/m);
    const detailsSection = block.match(/^Details:\n([\s\S]*)$/m);

    if (!headingMatch || !metadataMatch || !summaryMatch || !detailsSection) {
      continue;
    }

    const metadataRaw = metadataMatch[1];
    const detailsRaw = detailsSection[1];
    const summaryRaw = summaryMatch[1];
    const headingRaw = headingMatch[1];
    if (!metadataRaw || !detailsRaw || !summaryRaw || !headingRaw) {
      continue;
    }

    let metadata: EntryMetadata;
    try {
      const parsed = JSON.parse(metadataRaw) as unknown;
      if (!isEntryMetadata(parsed)) {
        continue;
      }
      metadata = parsed;
    } catch {
      continue;
    }

    const details = detailsRaw
      .split("\n")
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).trim())
      .filter(Boolean);

    const topicMatch = block.match(/<!-- cam:topic ([a-z0-9-]+) -->/);
    entries.push({
      id: metadata.id ?? headingRaw.trim(),
      scope: metadata.scope,
      topic: topicMatch?.[1] ?? "workflow",
      summary: summaryRaw.trim(),
      details,
      updatedAt: metadata.updatedAt,
      sources: metadata.sources ?? [],
      reason: metadata.reason
    });
  }

  return entries;
}

function topicFileContents(topic: string, entries: MemoryEntry[]): string {
  const header = [
    `# ${topicTitle(topic)}`,
    "",
    `<!-- cam:topic ${topic} -->`,
    "",
    "This file is maintained by Codex Auto Memory. You may edit summaries or details directly.",
    ""
  ].join("\n");

  const blocks = entries
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((entry) => entryBlock(entry))
    .join("\n");

  return `${header}${blocks}`.trimEnd() + "\n";
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

export class MemoryStore {
  public readonly paths: ScopePaths;

  public constructor(
    private readonly project: ProjectContext,
    private readonly config: AppConfig
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
      auditDir: path.join(baseDir, "projects", project.projectId, "audit")
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

  public getSyncAuditPath(): string {
    return path.join(this.paths.auditDir, "sync-log.jsonl");
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
      const memoryFile = this.getMemoryFile(scope);
      if (!(await fileExists(memoryFile))) {
        await this.rebuildIndex(scope);
        continue;
      }

      const contents = await readTextFile(memoryFile);
      if (matchesLegacyEmptyIndex(scope, contents)) {
        await this.rebuildIndex(scope);
      }
    }
  }

  public async listEntries(scope: MemoryScope): Promise<MemoryEntry[]> {
    const scopeDir = this.getScopeDir(scope);
    if (!(await fileExists(scopeDir))) {
      return [];
    }

    const files = await fs.readdir(scopeDir);
    const entries: MemoryEntry[] = [];
    for (const fileName of files) {
      if (!fileName.endsWith(".md") || fileName === "MEMORY.md") {
        continue;
      }

      const topic = fileName.replace(/\.md$/u, "");
      if (!topicNamePattern.test(topic)) {
        continue;
      }
      const contents = await readTextFile(path.join(scopeDir, fileName));
      const parsed = parseEntryBlocks(contents).map((entry) => ({ ...entry, topic }));
      entries.push(...parsed);
    }

    return entries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  public async listTopics(scope: MemoryScope): Promise<string[]> {
    return (await this.listTopicRefs(scope)).map((entry) => entry.topic);
  }

  public async listTopicRefs(scope: MemoryScope): Promise<TopicFileRef[]> {
    const scopeDir = this.getScopeDir(scope);
    if (!(await fileExists(scopeDir))) {
      return [];
    }

    const files = await fs.readdir(scopeDir);
    return files
      .filter((fileName) => fileName.endsWith(".md") && fileName !== "MEMORY.md")
      .map((fileName) => ({
        scope,
        topic: fileName.replace(/\.md$/u, ""),
        path: path.join(scopeDir, fileName)
      }))
      .filter((entry) => topicNamePattern.test(entry.topic))
      .sort((left, right) => left.topic.localeCompare(right.topic));
  }

  public async rebuildIndex(scope: MemoryScope): Promise<void> {
    const entries = await this.listEntries(scope);
    const lines = [
      `# ${topicTitle(scope)} Memory`,
      "",
      "This file is the concise startup index for this scope.",
      "It is intentionally short so it can be injected into Codex at session start.",
      "",
      "## Topics",
      ...(entries.length
        ? Array.from(new Set(entries.map((entry) => entry.topic))).map((topic) => {
            const count = entries.filter((entry) => entry.topic === topic).length;
            return `- [${topic}.md](${topic}.md): ${count} entr${count === 1 ? "y" : "ies"}`;
          })
        : ["- No topic files yet."])
    ];

    await writeTextFile(this.getMemoryFile(scope), `${lines.join("\n")}\n`);
  }

  public async applyOperations(operations: MemoryOperation[]): Promise<MemoryOperation[]> {
    await this.ensureLayout();
    const applied: MemoryOperation[] = [];
    for (const operation of operations) {
      if (operation.action === "delete") {
        const deleted = await this.deleteEntry(operation.scope, operation.topic, operation.id);
        if (deleted) {
          applied.push(operation);
        }
        continue;
      }

      if (!operation.summary) {
        continue;
      }

      const updatedAt = new Date().toISOString();
      const topic = normalizeTopicName(operation.topic);
      const entry: MemoryEntry = {
        id: operation.id,
        scope: operation.scope,
        topic,
        summary: operation.summary,
        details: operation.details?.length ? operation.details : [operation.summary],
        updatedAt,
        sources: operation.sources ?? [],
        reason: operation.reason
      };

      await this.upsertEntry(entry);
      applied.push({
        ...operation,
        details: entry.details,
        sources: entry.sources,
        reason: entry.reason
      });
    }

    const touchedScopes = new Set(applied.map((operation) => operation.scope));
    for (const scope of touchedScopes) {
      await this.rebuildIndex(scope);
    }

    return applied;
  }

  public async remember(
    scope: MemoryScope,
    topic: string,
    id: string,
    summary: string,
    details: string[],
    reason?: string
  ): Promise<void> {
    await this.applyOperations([
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
  }

  private async upsertEntry(entry: MemoryEntry): Promise<void> {
    const topicFile = this.getTopicFile(entry.scope, entry.topic);
    const entries = (await fileExists(topicFile))
      ? parseEntryBlocks(await readTextFile(topicFile)).map((current) => ({
          ...current,
          topic: entry.topic
        }))
      : [];

    const nextEntries = [...entries.filter((current) => current.id !== entry.id), entry];
    await writeTextFile(topicFile, topicFileContents(entry.topic, nextEntries));
  }

  private async deleteEntry(scope: MemoryScope, topic: string, id: string): Promise<boolean> {
    const topicFile = this.getTopicFile(scope, topic);
    if (!(await fileExists(topicFile))) {
      return false;
    }

    const contents = await readTextFile(topicFile);
    const existingEntries = parseEntryBlocks(contents).map((entry) => ({
      ...entry,
      topic
    }));
    const nextEntries = existingEntries.filter((entry) => entry.id !== id);
    if (nextEntries.length === existingEntries.length) {
      return false;
    }

    if (nextEntries.length === 0) {
      await fs.rm(topicFile, { force: true });
    } else {
      await writeTextFile(topicFile, topicFileContents(topic, nextEntries));
    }

    return true;
  }

  public async forget(scope: MemoryScope | "all", query: string): Promise<MemoryEntry[]> {
    const scopes: MemoryScope[] =
      scope === "all" ? ["global", "project", "project-local"] : [scope];
    const deleted: MemoryEntry[] = [];
    const normalizedQuery = query.toLowerCase();

    for (const currentScope of scopes) {
      const entries = await this.listEntries(currentScope);
      for (const entry of entries) {
        const haystack = `${entry.id}\n${entry.summary}\n${entry.details.join("\n")}`.toLowerCase();
        if (!haystack.includes(normalizedQuery)) {
          continue;
        }

        await this.deleteEntry(currentScope, entry.topic, entry.id);
        deleted.push(entry);
      }

      await this.rebuildIndex(currentScope);
    }

    return deleted;
  }

  public async readMemoryFile(scope: MemoryScope): Promise<string> {
    const memoryFile = this.getMemoryFile(scope);
    if (!(await fileExists(memoryFile))) {
      await this.rebuildIndex(scope);
    }

    return readTextFile(memoryFile);
  }

  public async getSyncState(): Promise<Required<SyncState>> {
    return normalizeSyncState(await readJsonFile<SyncState>(this.paths.stateFile));
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
      .slice(-limit)
      .reverse();
  }

  public listSuggestedTopics(): readonly string[] {
    return DEFAULT_MEMORY_TOPICS;
  }
}
