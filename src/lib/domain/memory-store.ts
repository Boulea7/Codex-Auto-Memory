import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_MEMORY_TOPICS } from "../constants.js";
import type {
  AppConfig,
  MemoryEntry,
  MemoryOperation,
  MemoryScope,
  ProjectContext,
  ScopePaths
} from "../types.js";
import { appendJsonl, ensureDir, fileExists, readJsonFile, readTextFile, writeJsonFile, writeTextFile } from "../util/fs.js";
import { getDefaultMemoryDirectory } from "./project-context.js";

interface SyncState {
  processedRollouts: Record<string, string>;
}

function topicTitle(topic: string): string {
  return topic
    .split(/[-_]/g)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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

    const metadata = JSON.parse(metadataRaw) as {
      id: string;
      scope: MemoryScope;
      updatedAt: string;
      sources?: string[];
      reason?: string;
    };

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
    return path.join(this.getScopeDir(scope), `${topic}.md`);
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
      if (!(await fileExists(this.getMemoryFile(scope)))) {
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
      const contents = await readTextFile(path.join(scopeDir, fileName));
      const parsed = parseEntryBlocks(contents).map((entry) => ({ ...entry, topic }));
      entries.push(...parsed);
    }

    return entries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  public async listTopics(scope: MemoryScope): Promise<string[]> {
    const entries = await this.listEntries(scope);
    return Array.from(new Set(entries.map((entry) => entry.topic))).sort();
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
        : ["- No topic files yet."]),
      "",
      "## Highlights",
      ...(entries.length
        ? entries.slice(0, 120).map((entry) => `- ${entry.topic}/${entry.id}: ${entry.summary}`)
        : ["- No memory entries yet."])
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
      const entry: MemoryEntry = {
        id: operation.id,
        scope: operation.scope,
        topic: operation.topic,
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
      await fs.rm(topicFile);
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

  public async getSyncState(): Promise<SyncState> {
    return (await readJsonFile<SyncState>(this.paths.stateFile)) ?? { processedRollouts: {} };
  }

  public async markRolloutProcessed(rolloutPath: string): Promise<void> {
    const state = await this.getSyncState();
    state.processedRollouts[rolloutPath] = new Date().toISOString();
    await writeJsonFile(this.paths.stateFile, state);
  }

  public async hasProcessedRollout(rolloutPath: string): Promise<boolean> {
    const state = await this.getSyncState();
    return rolloutPath in state.processedRollouts;
  }

  public async appendAuditLog(payload: Record<string, unknown>): Promise<void> {
    await appendJsonl(path.join(this.paths.auditDir, "sync-log.jsonl"), payload);
  }

  public async readRecentAuditEntries(limit = 5): Promise<Record<string, unknown>[]> {
    const auditPath = path.join(this.paths.auditDir, "sync-log.jsonl");
    if (!(await fileExists(auditPath))) {
      return [];
    }

    const raw = await readTextFile(auditPath);
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-limit)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .reverse();
  }

  public listSuggestedTopics(): readonly string[] {
    return DEFAULT_MEMORY_TOPICS;
  }
}
