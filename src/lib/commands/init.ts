import { configPaths } from "../config/load-config.js";
import { rawProjectConfigSchema } from "../config/schema.js";
import { MemoryStore } from "../domain/memory-store.js";
import { detectProjectContext, getDefaultMemoryDirectory } from "../domain/project-context.js";
import { SessionContinuityStore } from "../domain/session-continuity-store.js";
import { fileExists, readJsonFile, updateGitignoreLine, writeJsonFile } from "../util/fs.js";
import { resolveAppPath } from "../util/paths.js";
import type { AppConfig } from "../types.js";

interface InitOptions {
  cwd?: string;
  force?: boolean;
}

async function ensureInitConfigShape(
  filePath: string,
  label: "project" | "local"
): Promise<void> {
  if (!(await fileExists(filePath))) {
    return;
  }

  let raw: unknown;
  try {
    raw = await readJsonFile<unknown>(filePath);
  } catch {
    throw new Error(
      `Existing ${label} config at ${filePath} is invalid. Re-run with --force to overwrite it.`
    );
  }

  try {
    rawProjectConfigSchema.parse(raw);
  } catch {
    throw new Error(
      `Existing ${label} config at ${filePath} is invalid. Re-run with --force to overwrite it.`
    );
  }
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
    sessionContinuityAutoLoad: false,
    sessionContinuityAutoSave: false,
    sessionContinuityLocalPathStyle: "codex",
    maxSessionContinuityLines: 60,
    codexBinary: "codex"
  };

  if (!options.force) {
    await ensureInitConfigShape(projectConfigPath, "project");
    await ensureInitConfigShape(localConfigPath, "local");
  }

  if (options.force || !(await fileExists(projectConfigPath))) {
    await writeJsonFile(projectConfigPath, projectConfig);
  }
  if (options.force || !(await fileExists(localConfigPath))) {
    await writeJsonFile(localConfigPath, {
      autoMemoryEnabled: true
    });
  }
  await updateGitignoreLine(project.projectRoot, ".codex-auto-memory.local.json");

  const persistedProjectConfig = rawProjectConfigSchema.parse(
    (await readJsonFile(projectConfigPath)) ?? projectConfig
  );
  const persistedLocalConfig = rawProjectConfigSchema.parse(
    (await readJsonFile(localConfigPath)) ?? { autoMemoryEnabled: true }
  );
  const config: AppConfig = {
    ...projectConfig,
    ...persistedProjectConfig,
    ...persistedLocalConfig,
    autoMemoryDirectory: persistedLocalConfig.autoMemoryDirectory
      ? resolveAppPath(persistedLocalConfig.autoMemoryDirectory)
      : getDefaultMemoryDirectory()
  };
  const store = new MemoryStore(project, config);
  const continuityStore = new SessionContinuityStore(project, config);
  const excludePath = await continuityStore.ensureLocalIgnore();

  return [
    `Initialized Codex Auto Memory in ${project.projectRoot}`,
    `- Project config: ${projectConfigPath}`,
    `- Local override: ${localConfigPath}`,
    `- Memory root: ${store.paths.baseDir}`,
    `- Project memory: ${store.paths.projectDir}`,
    ...(excludePath ? [`- Local exclude: ${excludePath}`] : []),
    "",
    "Next steps:",
    "- Use `cam memory --print-startup` to inspect the startup block.",
    "- Use `cam run` instead of `codex` to enable automatic sync."
  ].join("\n");
}
