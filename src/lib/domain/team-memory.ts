import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig, ProjectContext, SessionContinuityScope, TeamMemorySuggestion, TeamMemorySummary } from "../types.js";
import { appendJsonl, ensureDir, fileExists, readJsonFile, readTextFile, writeJsonFileAtomic } from "../util/fs.js";
import { getDefaultMemoryDirectory } from "./project-context.js";

interface TeamMemoryEntry {
  id: string;
  topic: string;
  summary: string;
  details: string[];
  scopeHint: SessionContinuityScope;
  updatedAt: string;
  path: string;
}

interface TeamMemoryIndexPayload {
  version: 1;
  generatedAt: string;
  sourceRoot: string;
  topicCount: number;
  entryCount: number;
  warningCount: number;
  sourceFiles: string[];
  entries: TeamMemoryEntry[];
}

interface TeamMemoryPaths {
  sourceIndexFile: string;
  sourceDir: string;
  indexDir: string;
  indexFile: string;
  auditFile: string;
  recoveryFile: string;
}

interface InspectTeamMemoryOptions {
  autoBuild?: boolean;
}

interface TeamMemoryInspection {
  summary: TeamMemorySummary;
  entries: TeamMemoryEntry[];
}

function buildTeamMemoryPaths(project: ProjectContext, config: AppConfig): TeamMemoryPaths {
  const baseDir = config.autoMemoryDirectory ?? getDefaultMemoryDirectory();
  const teamBaseDir = path.join(baseDir, "projects", project.projectId, "team");
  const auditDir = path.join(baseDir, "projects", project.projectId, "audit");

  return {
    sourceIndexFile: path.join(project.projectRoot, "TEAM_MEMORY.md"),
    sourceDir: path.join(project.projectRoot, "team-memory"),
    indexDir: teamBaseDir,
    indexFile: path.join(teamBaseDir, "retrieval-index.json"),
    auditFile: path.join(auditDir, "team-memory-log.jsonl"),
    recoveryFile: path.join(auditDir, "team-memory-recovery.json")
  };
}

function normalizeQueryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .map((term) => term.trim())
    .filter(Boolean);
}

function buildSuggestion(entry: TeamMemoryEntry, matchedQuery: string): TeamMemorySuggestion {
  return {
    key: `team:${entry.topic}:${entry.id}`,
    topic: entry.topic,
    scopeHint: entry.scopeHint,
    summary: entry.summary,
    path: entry.path,
    approxReadCost: entry.details.length + 4,
    matchedQuery,
    reason: `Matched team memory from ${entry.topic}.`
  };
}

function isSessionContinuityScope(value: unknown): value is SessionContinuityScope {
  return value === "project" || value === "project-local";
}

function parseTeamEntryBlock(block: string, topic: string, filePath: string): TeamMemoryEntry | null {
  const headingMatch = block.match(/^##\s+(.+)$/m);
  const metadataMatch = block.match(/<!-- cam:team-entry (.+?) -->/);
  const summaryMatch = block.match(/^Summary:\s+(.+)$/m);
  const detailsSection = block.match(/^Details:\n([\s\S]*)$/m);
  if (!headingMatch || !metadataMatch || !summaryMatch || !detailsSection) {
    return null;
  }

  let metadata: Record<string, unknown>;
  try {
    metadata = JSON.parse(metadataMatch[1] ?? "{}") as Record<string, unknown>;
  } catch {
    return null;
  }

  const detailLines = (detailsSection[1] ?? "").split("\n");
  if (detailLines.some((line) => line.trim().length > 0 && !line.startsWith("- "))) {
    return null;
  }

  return {
    id: String(metadata.id ?? headingMatch[1]?.trim() ?? ""),
    topic,
    summary: summaryMatch[1]?.trim() ?? "",
    details: detailLines
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).trim())
      .filter(Boolean),
    scopeHint: isSessionContinuityScope(metadata.scopeHint) ? metadata.scopeHint : "project",
    updatedAt:
      typeof metadata.updatedAt === "string" && metadata.updatedAt.length > 0
        ? metadata.updatedAt
        : new Date(0).toISOString(),
    path: filePath
  };
}

async function listTeamMarkdownFiles(sourceDir: string): Promise<string[]> {
  if (!(await fileExists(sourceDir))) {
    return [];
  }

  return (await fs.readdir(sourceDir))
    .filter((fileName) => fileName.endsWith(".md"))
    .sort((left, right) => left.localeCompare(right))
    .map((fileName) => path.join(sourceDir, fileName));
}

async function collectTeamEntries(paths: TeamMemoryPaths): Promise<{ entries: TeamMemoryEntry[]; warningCount: number; sourceFiles: string[] }> {
  const markdownFiles = await listTeamMarkdownFiles(paths.sourceDir);
  const sourceFiles = [
    ...(await fileExists(paths.sourceIndexFile) ? [paths.sourceIndexFile] : []),
    ...markdownFiles
  ];
  const entries: TeamMemoryEntry[] = [];
  let warningCount = 0;

  for (const filePath of markdownFiles) {
    const topic = path.basename(filePath, ".md");
    const contents = await readTextFile(filePath);
    const firstBlockIndex = contents.search(/^## /m);
    if (firstBlockIndex < 0) {
      continue;
    }

    const rawBlocks = contents
      .slice(firstBlockIndex)
      .split(/^## /m)
      .slice(1)
      .map((rawBlock) => `## ${rawBlock}`.trim());
    for (const block of rawBlocks) {
      const entry = parseTeamEntryBlock(block, topic, filePath);
      if (!entry) {
        warningCount += 1;
        continue;
      }
      entries.push(entry);
    }
  }

  return { entries, warningCount, sourceFiles };
}

function isTeamMemoryIndexPayload(value: unknown): value is TeamMemoryIndexPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<TeamMemoryIndexPayload>;
  return (
    candidate.version === 1 &&
    typeof candidate.generatedAt === "string" &&
    typeof candidate.sourceRoot === "string" &&
    typeof candidate.topicCount === "number" &&
    typeof candidate.entryCount === "number" &&
    typeof candidate.warningCount === "number" &&
    Array.isArray(candidate.sourceFiles) &&
    Array.isArray(candidate.entries)
  );
}

async function isIndexStale(indexPath: string, payload: TeamMemoryIndexPayload): Promise<boolean> {
  const indexStats = await fs.stat(indexPath);
  for (const sourceFile of payload.sourceFiles) {
    if (!(await fileExists(sourceFile))) {
      return true;
    }
    const stats = await fs.stat(sourceFile);
    if (stats.mtimeMs > indexStats.mtimeMs) {
      return true;
    }
  }
  return false;
}

export async function rebuildTeamMemoryIndex(
  project: ProjectContext,
  config: AppConfig
): Promise<TeamMemoryInspection> {
  const paths = buildTeamMemoryPaths(project, config);
  const hasAnySource =
    (await fileExists(paths.sourceIndexFile)) || (await fileExists(paths.sourceDir));
  if (!hasAnySource) {
    return {
      summary: {
        available: false,
        status: "missing",
        sourceRoot: null,
        indexPath: paths.indexFile,
        generatedAt: null,
        topicCount: 0,
        entryCount: 0,
        warningCount: 0
      },
      entries: []
    };
  }

  await ensureDir(paths.indexDir);
  const { entries, warningCount, sourceFiles } = await collectTeamEntries(paths);
  const payload: TeamMemoryIndexPayload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceRoot: paths.sourceDir,
    topicCount: new Set(entries.map((entry) => entry.topic)).size,
    entryCount: entries.length,
    warningCount,
    sourceFiles,
    entries
  };

  try {
    await writeJsonFileAtomic(paths.indexFile, payload);
    await appendJsonl(paths.auditFile, {
      recordedAt: payload.generatedAt,
      sourceRoot: payload.sourceRoot,
      topicCount: payload.topicCount,
      entryCount: payload.entryCount,
      warningCount: payload.warningCount
    });
    await fs.rm(paths.recoveryFile, { force: true });
  } catch (error) {
    await writeJsonFileAtomic(paths.recoveryFile, {
      recordedAt: new Date().toISOString(),
      failureMessage: error instanceof Error ? error.message : String(error),
      indexPath: paths.indexFile
    });
    throw error;
  }

  return {
    summary: {
      available: true,
      status: "available",
      sourceRoot: payload.sourceRoot,
      indexPath: paths.indexFile,
      generatedAt: payload.generatedAt,
      topicCount: payload.topicCount,
      entryCount: payload.entryCount,
      warningCount: payload.warningCount
    },
    entries
  };
}

export async function inspectTeamMemory(
  project: ProjectContext,
  config: AppConfig,
  options: InspectTeamMemoryOptions = {}
): Promise<TeamMemoryInspection> {
  const paths = buildTeamMemoryPaths(project, config);
  const hasAnySource =
    (await fileExists(paths.sourceIndexFile)) || (await fileExists(paths.sourceDir));
  if (!hasAnySource) {
    return {
      summary: {
        available: false,
        status: "missing",
        sourceRoot: null,
        indexPath: paths.indexFile,
        generatedAt: null,
        topicCount: 0,
        entryCount: 0,
        warningCount: 0
      },
      entries: []
    };
  }

  const payload = await readJsonFile<TeamMemoryIndexPayload>(paths.indexFile);
  if (!payload || !isTeamMemoryIndexPayload(payload)) {
    if (options.autoBuild) {
      return rebuildTeamMemoryIndex(project, config);
    }
    return {
      summary: {
        available: false,
        status: "invalid",
        sourceRoot: paths.sourceDir,
        indexPath: paths.indexFile,
        generatedAt: null,
        topicCount: 0,
        entryCount: 0,
        warningCount: 0
      },
      entries: []
    };
  }

  if (await isIndexStale(paths.indexFile, payload)) {
    if (options.autoBuild) {
      return rebuildTeamMemoryIndex(project, config);
    }
    return {
      summary: {
        available: true,
        status: "stale",
        sourceRoot: payload.sourceRoot,
        indexPath: paths.indexFile,
        generatedAt: payload.generatedAt,
        topicCount: payload.topicCount,
        entryCount: payload.entryCount,
        warningCount: payload.warningCount
      },
      entries: payload.entries
    };
  }

  return {
    summary: {
      available: true,
      status: "available",
      sourceRoot: payload.sourceRoot,
      indexPath: paths.indexFile,
      generatedAt: payload.generatedAt,
      topicCount: payload.topicCount,
      entryCount: payload.entryCount,
      warningCount: payload.warningCount
    },
    entries: payload.entries
  };
}

export async function searchTeamMemory(
  project: ProjectContext,
  config: AppConfig,
  query: string,
  limit = 3,
  options: InspectTeamMemoryOptions = {}
): Promise<TeamMemorySuggestion[]> {
  const inspection = await inspectTeamMemory(project, config, options);
  if (inspection.summary.status !== "available") {
    return [];
  }
  const normalizedTerms = normalizeQueryTerms(query);
  if (normalizedTerms.length === 0) {
    return inspection.entries.slice(0, limit).map((entry) => buildSuggestion(entry, query));
  }

  return inspection.entries
    .filter((entry) => {
      const haystack = `${entry.topic}\n${entry.id}\n${entry.summary}\n${entry.details.join("\n")}`.toLowerCase();
      return normalizedTerms.every((term) => haystack.includes(term));
    })
    .slice(0, limit)
    .map((entry) => buildSuggestion(entry, query));
}
