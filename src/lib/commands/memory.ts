import { spawn } from "node:child_process";
import path from "node:path";
import type { MemoryScope } from "../types.js";
import { compileStartupMemory } from "../domain/startup-memory.js";
import { buildRuntimeContext } from "./common.js";

interface MemoryOptions {
  cwd?: string;
  json?: boolean;
  printStartup?: boolean;
  open?: boolean;
}

function openPath(targetPath: string): void {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args =
    process.platform === "darwin"
      ? [targetPath]
      : process.platform === "win32"
        ? ["/c", "start", "", targetPath]
        : [targetPath];

  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

export async function runMemory(options: MemoryOptions = {}): Promise<string> {
  const runtime = await buildRuntimeContext(options.cwd);
  const startup = await compileStartupMemory(
    runtime.syncService.memoryStore,
    runtime.loadedConfig.config.maxStartupLines
  );
  const counts = await Promise.all(
    (["global", "project", "project-local"] satisfies MemoryScope[]).map(async (scope) => ({
      scope,
      count: (await runtime.syncService.memoryStore.listEntries(scope)).length,
      file: runtime.syncService.memoryStore.getMemoryFile(scope)
    }))
  );

  if (options.open) {
    openPath(path.dirname(runtime.syncService.memoryStore.getMemoryFile("project")));
  }

  if (options.json) {
    return JSON.stringify(
      {
        configFiles: runtime.loadedConfig.files,
        warnings: runtime.loadedConfig.warnings,
        startup,
        scopes: counts
      },
      null,
      2
    );
  }

  const lines = [
    "Codex Auto Memory",
    `Project root: ${runtime.project.projectRoot}`,
    `Memory base: ${runtime.syncService.memoryStore.paths.baseDir}`,
    `Config files: ${runtime.loadedConfig.files.length ? runtime.loadedConfig.files.join(", ") : "none"}`,
    ...runtime.loadedConfig.warnings.map((warning) => `Warning: ${warning}`),
    "",
    "Scopes:"
  ];

  for (const item of counts) {
    lines.push(`- ${item.scope}: ${item.count} entr${item.count === 1 ? "y" : "ies"} (${item.file})`);
  }

  if (options.printStartup) {
    lines.push("", "Startup memory:", startup.text.trimEnd());
  }

  return lines.join("\n");
}

