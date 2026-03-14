import { runCommandCapture } from "../util/process.js";
import { buildRuntimeContext } from "./common.js";

interface DoctorOptions {
  cwd?: string;
}

export async function runDoctor(options: DoctorOptions = {}): Promise<string> {
  const runtime = await buildRuntimeContext(options.cwd);
  const featureResult = runCommandCapture(
    runtime.loadedConfig.config.codexBinary,
    ["features", "list"],
    runtime.project.cwd
  );

  const lines = [
    "Codex Auto Memory Doctor",
    `Project root: ${runtime.project.projectRoot}`,
    `Project id: ${runtime.project.projectId}`,
    `Worktree id: ${runtime.project.worktreeId}`,
    `Memory root: ${runtime.syncService.memoryStore.paths.baseDir}`,
    `Auto memory enabled: ${runtime.loadedConfig.config.autoMemoryEnabled}`,
    `Extractor mode: ${runtime.loadedConfig.config.extractorMode}`,
    `Config files: ${runtime.loadedConfig.files.length ? runtime.loadedConfig.files.join(", ") : "none"}`,
    ...runtime.loadedConfig.warnings.map((warning) => `Warning: ${warning}`),
    "",
    "Codex feature flags:",
    featureResult.exitCode === 0
      ? featureResult.stdout.trim()
      : `Unable to inspect feature flags: ${featureResult.stderr.trim() || "unknown error"}`
  ];

  return lines.join("\n");
}

