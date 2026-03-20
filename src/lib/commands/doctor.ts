import { runCommandCapture } from "../util/process.js";
import { buildNativeReadinessReport, parseCodexFeatures } from "../runtime/codex-features.js";
import { buildRuntimeContext } from "../runtime/runtime-context.js";

interface DoctorOptions {
  cwd?: string;
  json?: boolean;
}

export async function runDoctor(options: DoctorOptions = {}): Promise<string> {
  const runtime = await buildRuntimeContext(options.cwd);
  const featureResult = runCommandCapture(
    runtime.loadedConfig.config.codexBinary,
    ["features", "list"],
    runtime.project.cwd
  );
  const parsedFeatures =
    featureResult.exitCode === 0 ? parseCodexFeatures(featureResult.stdout) : [];
  const readiness = buildNativeReadinessReport(parsedFeatures);

  if (options.json) {
    return JSON.stringify(
      {
        projectRoot: runtime.project.projectRoot,
        projectId: runtime.project.projectId,
        worktreeId: runtime.project.worktreeId,
        memoryRoot: runtime.syncService.memoryStore.paths.baseDir,
        autoMemoryEnabled: runtime.loadedConfig.config.autoMemoryEnabled,
        extractorMode: runtime.loadedConfig.config.extractorMode,
        configFiles: runtime.loadedConfig.files,
        warnings: runtime.loadedConfig.warnings,
        features: parsedFeatures,
        readiness
      },
      null,
      2
    );
  }

  const lines = [
    "Codex Auto Memory Doctor",
    `Project root: ${runtime.project.projectRoot}`,
    `Project id: ${runtime.project.projectId}`,
    `Worktree id: ${runtime.project.worktreeId}`,
    `Memory root: ${runtime.syncService.memoryStore.paths.baseDir}`,
    `Auto memory enabled: ${runtime.loadedConfig.config.autoMemoryEnabled}`,
    `Extractor mode: ${runtime.loadedConfig.config.extractorMode}`,
    `Companion session source: rollout-jsonl`,
    `Companion runtime injector: wrapper-base-instructions`,
    `Config files: ${runtime.loadedConfig.files.length ? runtime.loadedConfig.files.join(", ") : "none"}`,
    ...runtime.loadedConfig.warnings.map((warning) => `Warning: ${warning}`),
    "",
    "Native readiness:",
    `- memories: ${readiness.memories ? `${readiness.memories.stage}/${readiness.memories.enabled}` : "missing"}`,
    `- codex_hooks: ${readiness.hooks ? `${readiness.hooks.stage}/${readiness.hooks.enabled}` : "missing"}`,
    `- summary: ${readiness.summary}`,
    "",
    "Codex feature flags:",
    featureResult.exitCode === 0
      ? featureResult.stdout.trim()
        : `Unable to inspect feature flags: ${featureResult.stderr.trim() || "unknown error"}`
  ];

  return lines.join("\n");
}
