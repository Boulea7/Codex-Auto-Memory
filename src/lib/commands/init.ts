import { configPaths } from "../config/load-config.js";
import { MemoryStore } from "../domain/memory-store.js";
import { detectProjectContext, getDefaultMemoryDirectory } from "../domain/project-context.js";
import { updateGitignoreLine, writeJsonFile } from "../util/fs.js";
import type { AppConfig } from "../types.js";

interface InitOptions {
  cwd?: string;
  force?: boolean;
}

export async function runInit(options: InitOptions = {}): Promise<string> {
  const project = detectProjectContext(options.cwd);
  const projectConfigPath = configPaths.getProjectConfigPath(project.projectRoot);
  const localConfigPath = configPaths.getLocalConfigPath(project.projectRoot);
  const projectConfig: Omit<AppConfig, "autoMemoryDirectory"> = {
    autoMemoryEnabled: true,
    extractorMode: "codex",
    defaultScope: "project",
    maxStartupLines: 200,
    codexBinary: "codex"
  };

  await writeJsonFile(projectConfigPath, projectConfig);
  await writeJsonFile(localConfigPath, {
    autoMemoryEnabled: true
  });
  await updateGitignoreLine(project.projectRoot, ".codex-auto-memory.local.json");

  const config: AppConfig = {
    ...projectConfig,
    autoMemoryDirectory: getDefaultMemoryDirectory()
  };
  const store = new MemoryStore(project, config);
  await store.ensureLayout();

  return [
    `Initialized Codex Auto Memory in ${project.projectRoot}`,
    `- Project config: ${projectConfigPath}`,
    `- Local override: ${localConfigPath}`,
    `- Memory root: ${store.paths.baseDir}`,
    `- Project memory: ${store.paths.projectDir}`,
    "",
    "Next steps:",
    "- Use `cam memory --print-startup` to inspect the startup block.",
    "- Use `cam run` instead of `codex` to enable automatic sync."
  ].join("\n");
}
