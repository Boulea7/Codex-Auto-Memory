import path from "node:path";
import { formatMemorySyncAuditEntry } from "../domain/memory-sync-audit.js";
import { buildCompactHistoryPreview } from "../domain/reviewer-history.js";
import { openPath } from "../util/open.js";
import { compileStartupMemory } from "../domain/startup-memory.js";
import type {
  ConfigScope,
  MemoryCommandOutput,
  MemoryReindexOutput,
  MemoryRecordState,
  MemoryScope,
  MemorySyncAuditEntry,
  SyncRecoveryRecord
} from "../types.js";
import {
  buildRuntimeContext,
  patchConfigAndReloadRuntime
} from "../runtime/runtime-context.js";

interface MemoryOptions {
  cwd?: string;
  json?: boolean;
  printStartup?: boolean;
  open?: boolean;
  scope?: MemoryScope | "all";
  recent?: string | boolean;
  enable?: boolean;
  disable?: boolean;
  configScope?: ConfigScope;
}

interface MemoryReindexOptions {
  cwd?: string;
  json?: boolean;
  scope?: MemoryScope | "all";
  state?: MemoryRecordState | "all";
}

function formatPendingSyncRecovery(record: SyncRecoveryRecord, recoveryPath: string): string[] {
  const lines = [
    "Pending sync recovery:",
    `- Recovery file: ${recoveryPath}`,
    `- Failed stage: ${record.failedStage}`,
    `- Rollout: ${record.rolloutPath}`,
    `- Session: ${record.sessionId ?? "unknown"}`,
    `- Status: ${record.status} (${record.appliedCount} operation${record.appliedCount === 1 ? "" : "s"})`,
    `- No-op: ${record.noopOperationCount ?? 0}`,
    `- Suppressed: ${record.suppressedOperationCount ?? 0}`,
    `- Audit entry written: ${record.auditEntryWritten}`,
    `- Failure: ${record.failureMessage}`
  ];

  if (record.conflicts?.length) {
    lines.push("- Conflict review:");
    for (const conflict of record.conflicts) {
      lines.push(`  - [${conflict.source}] ${conflict.topic}: ${conflict.candidateSummary}`);
    }
  }

  return lines;
}

function syncAuditSignature(entry: MemorySyncAuditEntry): string {
  return JSON.stringify({
    rolloutPath: entry.rolloutPath,
    sessionId: entry.sessionId ?? null,
    status: entry.status,
    skipReason: entry.skipReason ?? null,
    isRecovery: entry.isRecovery === true,
    configuredExtractorMode: entry.configuredExtractorMode,
    configuredExtractorName: entry.configuredExtractorName,
    actualExtractorMode: entry.actualExtractorMode,
    actualExtractorName: entry.actualExtractorName,
    appliedCount: entry.appliedCount,
    noopOperationCount: entry.noopOperationCount ?? 0,
    suppressedOperationCount: entry.suppressedOperationCount ?? 0,
    scopesTouched: entry.scopesTouched,
    conflicts: entry.conflicts ?? [],
    resultSummary: entry.resultSummary
  });
}

function formatRecentSyncAuditLines(entries: MemorySyncAuditEntry[], maxGroups: number): {
  lines: string[];
  groupCount: number;
} {
  const preview = buildCompactHistoryPreview(entries, {
    maxGroups,
    getSignature: syncAuditSignature
  });

  const lines = preview.groups.flatMap((group) => [
    ...formatMemorySyncAuditEntry(group.latest),
    ...(group.rawCount > 1 ? [`  Repeated similar sync events hidden: ${group.rawCount - 1}`] : [])
  ]);

  if (preview.omittedRawCount > 0) {
    lines.push(`- older sync events omitted: ${preview.omittedRawCount}`);
  }

  return {
    lines,
    groupCount: preview.groups.length
  };
}

export async function runMemory(options: MemoryOptions = {}): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const configScope = options.configScope ?? "local";
  const selectedScope = options.scope ?? "all";

  if (options.enable && options.disable) {
    throw new Error("Choose either --enable or --disable, not both.");
  }

  let configUpdateMessage: string | undefined;
  let runtime = await buildRuntimeContext(cwd);
  if (options.enable || options.disable) {
    const reloaded = await patchConfigAndReloadRuntime(cwd, configScope, {
      autoMemoryEnabled: Boolean(options.enable)
    });
    runtime = reloaded.runtime;
    configUpdateMessage = `Updated ${configScope} config: ${reloaded.configUpdatePath}`;
  }
  const startup = await compileStartupMemory(
    runtime.syncService.memoryStore,
    runtime.loadedConfig.config.maxStartupLines
  );
  const allScopes = ["global", "project", "project-local"] satisfies MemoryScope[];
  const scopesToShow = selectedScope === "all" ? allScopes : [selectedScope];
  const recentCount =
    typeof options.recent === "string" ? Math.max(1, Number.parseInt(options.recent, 10) || 5) : 5;
  const scopes = await Promise.all(
    scopesToShow.map(async (scope) => ({
      scope,
      count: (await runtime.syncService.memoryStore.listEntries(scope)).length,
      file: runtime.syncService.memoryStore.getMemoryFile(scope),
      topics: await runtime.syncService.memoryStore.listTopics(scope)
    }))
  );
  const recentSyncAuditPreviewEntries = options.recent
    ? await runtime.syncService.memoryStore.readRecentSyncAuditEntries(recentCount * 2)
    : [];
  const recentSyncAudit = recentSyncAuditPreviewEntries.slice(0, recentCount);
  let pendingSyncRecovery = null;
  try {
    pendingSyncRecovery = await runtime.syncService.memoryStore.readSyncRecoveryRecord();
  } catch (error) {
    runtime.loadedConfig.warnings.push(
      `Sync recovery record could not be read: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const startupFilesByScope = {
    global: startup.sourceFiles.filter(
      (filePath) => filePath === runtime.syncService.memoryStore.getMemoryFile("global")
    ),
    project: startup.sourceFiles.filter(
      (filePath) => filePath === runtime.syncService.memoryStore.getMemoryFile("project")
    ),
    projectLocal: startup.sourceFiles.filter(
      (filePath) => filePath === runtime.syncService.memoryStore.getMemoryFile("project-local")
    )
  };
  const topicFilesByScope = {
    global: startup.topicFiles.filter((topicFile) => topicFile.scope === "global"),
    project: startup.topicFiles.filter((topicFile) => topicFile.scope === "project"),
    projectLocal: startup.topicFiles.filter((topicFile) => topicFile.scope === "project-local")
  };
  const startupBudget = {
    usedLines: startup.lineCount,
    maxLines: runtime.loadedConfig.config.maxStartupLines
  };
  const refCountsByScope = {
    global: {
      startupFiles: startupFilesByScope.global.length,
      topicFiles: topicFilesByScope.global.length
    },
    project: {
      startupFiles: startupFilesByScope.project.length,
      topicFiles: topicFilesByScope.project.length
    },
    projectLocal: {
      startupFiles: startupFilesByScope.projectLocal.length,
      topicFiles: topicFilesByScope.projectLocal.length
    }
  };
  const editTargets = {
    global: runtime.syncService.memoryStore.getMemoryFile("global"),
    project: runtime.syncService.memoryStore.getMemoryFile("project"),
    projectLocal: runtime.syncService.memoryStore.getMemoryFile("project-local")
  };

  if (options.open) {
    const targetScope = selectedScope === "all" ? "project" : selectedScope;
    openPath(path.dirname(runtime.syncService.memoryStore.getMemoryFile(targetScope)));
  }

  if (options.json) {
    const output: MemoryCommandOutput = {
      configUpdateMessage,
      configFiles: runtime.loadedConfig.files,
      warnings: runtime.loadedConfig.warnings,
      startup,
      loadedFiles: startup.sourceFiles,
      topicFiles: startup.topicFiles,
      startupFilesByScope,
      topicFilesByScope,
      startupBudget,
      refCountsByScope,
      scopes,
      editTargets,
      recentSyncAudit,
      recentAudit: recentSyncAudit,
      syncAuditPath: runtime.syncService.memoryStore.getSyncAuditPath(),
      pendingSyncRecovery,
      syncRecoveryPath: runtime.syncService.memoryStore.getSyncRecoveryPath()
    };
    return JSON.stringify(
      output,
      null,
      2
    );
  }

  const lines = [
    "Codex Auto Memory",
    `Project root: ${runtime.project.projectRoot}`,
    `Memory base: ${runtime.syncService.memoryStore.paths.baseDir}`,
    `Auto memory enabled: ${runtime.loadedConfig.config.autoMemoryEnabled}`,
    `Config files: ${runtime.loadedConfig.files.length ? runtime.loadedConfig.files.join(", ") : "none"}`,
    `Startup budget: ${startupBudget.usedLines}/${startupBudget.maxLines} lines | Refs: global ${refCountsByScope.global.startupFiles}/${refCountsByScope.global.topicFiles}, project ${refCountsByScope.project.startupFiles}/${refCountsByScope.project.topicFiles}, project-local ${refCountsByScope.projectLocal.startupFiles}/${refCountsByScope.projectLocal.topicFiles}`,
    "Startup loaded files are the index files actually quoted into the current startup payload.",
    "Topic files on demand stay as references until a later read needs them.",
    ...(configUpdateMessage ? [configUpdateMessage] : []),
    ...runtime.loadedConfig.warnings.map((warning) => `Warning: ${warning}`),
    "",
    "Edit paths:",
    `- global: ${editTargets.global}`,
    `- project: ${editTargets.project}`,
    `- project-local: ${editTargets.projectLocal}`,
    "",
    "Scopes:"
  ];

  for (const item of scopes) {
    lines.push(`- ${item.scope}: ${item.count} entr${item.count === 1 ? "y" : "ies"} (${item.file})`);
    if (item.topics.length > 0) {
      lines.push(`  Topics: ${item.topics.join(", ")}`);
    }
  }

  lines.push("", "Startup loaded files:");
  if (startup.sourceFiles.length > 0) {
    for (const filePath of startup.sourceFiles) {
      lines.push(`- ${filePath}`);
    }
  } else {
    lines.push("- No memory files fit into the current startup budget.");
  }

  lines.push("", "Topic files on demand:");
  const topicGroups = [
    ["global", topicFilesByScope.global],
    ["project", topicFilesByScope.project],
    ["project-local", topicFilesByScope.projectLocal]
  ] as const;
  for (const [scopeLabel, files] of topicGroups) {
    lines.push(`- ${scopeLabel}:`);
    if (files.length === 0) {
      lines.push("  - none");
      continue;
    }

    for (const topicFile of files) {
      lines.push(`  - ${topicFile.topic}: ${topicFile.path}`);
    }
  }

  if (recentSyncAuditPreviewEntries.length > 0) {
    const compactRecentSyncAudit = formatRecentSyncAuditLines(
      recentSyncAuditPreviewEntries,
      recentCount
    );
    lines.push("", `Recent sync events (${compactRecentSyncAudit.groupCount} grouped):`);
    lines.push(...compactRecentSyncAudit.lines);
  }

  if (pendingSyncRecovery) {
    lines.push("", ...formatPendingSyncRecovery(
      pendingSyncRecovery,
      runtime.syncService.memoryStore.getSyncRecoveryPath()
    ));
  }

  if (options.printStartup) {
    lines.push("", "Startup memory:", startup.text.trimEnd());
  }

  return lines.join("\n");
}

function normalizeMemoryReindexScope(scope: MemoryScope | "all" | undefined): MemoryScope | "all" {
  if (!scope || scope === "all") {
    return "all";
  }

  if (scope === "global" || scope === "project" || scope === "project-local") {
    return scope;
  }

  throw new Error(`Unsupported memory reindex scope "${scope}".`);
}

function normalizeMemoryReindexState(
  state: MemoryRecordState | "all" | undefined
): MemoryRecordState | "all" {
  if (!state || state === "all") {
    return "all";
  }

  if (state === "active" || state === "archived") {
    return state;
  }

  throw new Error(`Unsupported memory reindex state "${state}".`);
}

export async function runMemoryReindex(options: MemoryReindexOptions = {}): Promise<string> {
  const runtime = await buildRuntimeContext(options.cwd ?? process.cwd());
  const requestedScope = normalizeMemoryReindexScope(options.scope);
  const requestedState = normalizeMemoryReindexState(options.state);
  const rebuilt = await runtime.syncService.memoryStore.rebuildRetrievalSidecars({
    scope: requestedScope,
    state: requestedState
  });
  const summary =
    rebuilt.length === 1
      ? "Rebuilt 1 retrieval sidecar from Markdown canonical memory."
      : `Rebuilt ${rebuilt.length} retrieval sidecar(s) from Markdown canonical memory.`;

  const output: MemoryReindexOutput = {
    projectRoot: runtime.project.projectRoot,
    requestedScope,
    requestedState,
    rebuilt,
    summary
  };

  if (options.json) {
    return JSON.stringify(output, null, 2);
  }

  return [
    "Codex Auto Memory Retrieval Sidecar Reindex",
    `Project root: ${output.projectRoot}`,
    `Requested scope: ${output.requestedScope}`,
    `Requested state: ${output.requestedState}`,
    output.summary,
    "",
    "Rebuilt sidecars:",
    ...output.rebuilt.map(
      (check) =>
        `- ${check.scope}/${check.state}: ${check.indexPath} | generatedAt: ${check.generatedAt} | topicFiles: ${check.topicFileCount}`
    ),
    "",
    "Markdown memory remains canonical; retrieval-index.json is a rebuildable acceleration sidecar."
  ].join("\n");
}
