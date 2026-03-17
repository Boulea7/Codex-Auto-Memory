import path from "node:path";
import { patchConfigFile } from "../config/write-config.js";
import { formatMemorySyncAuditEntry } from "../domain/memory-sync-audit.js";
import { openPath } from "../util/open.js";
import { compileStartupMemory } from "../domain/startup-memory.js";
import type { ConfigScope, MemoryCommandOutput, MemoryScope } from "../types.js";
import { buildRuntimeContext } from "./common.js";

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

export async function runMemory(options: MemoryOptions = {}): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const configScope = options.configScope ?? "local";
  const selectedScope = options.scope ?? "all";

  if (options.enable && options.disable) {
    throw new Error("Choose either --enable or --disable, not both.");
  }

  let configUpdateMessage: string | undefined;
  const initialRuntime = await buildRuntimeContext(cwd);
  if (options.enable || options.disable) {
    const filePath = await patchConfigFile(initialRuntime.project.projectRoot, configScope, {
      autoMemoryEnabled: Boolean(options.enable)
    });
    configUpdateMessage = `Updated ${configScope} config: ${filePath}`;
  }

  const runtime = await buildRuntimeContext(cwd);
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
  const recentSyncAudit = options.recent
    ? await runtime.syncService.memoryStore.readRecentSyncAuditEntries(recentCount)
    : [];
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
      syncAuditPath: runtime.syncService.memoryStore.getSyncAuditPath()
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

  if (recentSyncAudit.length > 0) {
    lines.push("", `Recent sync events (${recentSyncAudit.length}):`);
    for (const item of recentSyncAudit) {
      lines.push(...formatMemorySyncAuditEntry(item));
    }
  }

  if (options.printStartup) {
    lines.push("", "Startup memory:", startup.text.trimEnd());
  }

  return lines.join("\n");
}
