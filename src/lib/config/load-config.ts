import os from "node:os";
import path from "node:path";
import { APP_ID, DEFAULT_STARTUP_LINE_LIMIT } from "../constants.js";
import type { AppConfig, LoadedConfig, ProjectContext } from "../types.js";
import { fileExists, readJsonFile } from "../util/fs.js";
import { resolveAppPath } from "../util/paths.js";
import { appConfigSchema, rawProjectConfigSchema, type RawProjectConfig } from "./schema.js";

const defaultConfig: AppConfig = {
  autoMemoryEnabled: true,
  extractorMode: "codex",
  defaultScope: "project",
  maxStartupLines: DEFAULT_STARTUP_LINE_LIMIT,
  codexBinary: "codex"
};

function getManagedConfigPath(): string {
  const fromEnv = process.env.CAM_MANAGED_CONFIG;
  if (fromEnv) {
    return resolveAppPath(fromEnv);
  }

  switch (process.platform) {
    case "darwin":
      return "/Library/Application Support/CodexAutoMemory/config.json";
    case "win32":
      return "C:\\Program Files\\CodexAutoMemory\\config.json";
    default:
      return "/etc/codex-auto-memory/config.json";
  }
}

function getUserConfigPath(): string {
  return path.join(os.homedir(), ".config", APP_ID, "config.json");
}

function getProjectConfigPath(projectRoot: string): string {
  return path.join(projectRoot, "codex-auto-memory.json");
}

function getLocalConfigPath(projectRoot: string): string {
  return path.join(projectRoot, ".codex-auto-memory.local.json");
}

function sanitizeProjectConfig(
  source: RawProjectConfig,
  filePath: string,
  warnings: string[],
  allowDirectoryOverride: boolean
): Partial<AppConfig> {
  const parsed = rawProjectConfigSchema.parse(source);
  if (!allowDirectoryOverride && parsed.autoMemoryDirectory) {
    warnings.push(
      `Ignored autoMemoryDirectory from ${filePath}. Shared project config cannot redirect memory storage.`
    );
  }

  return Object.fromEntries(
    Object.entries({
      autoMemoryEnabled: parsed.autoMemoryEnabled,
      extractorMode: parsed.extractorMode,
      defaultScope: parsed.defaultScope,
      maxStartupLines: parsed.maxStartupLines,
      codexBinary: parsed.codexBinary,
      autoMemoryDirectory: allowDirectoryOverride ? parsed.autoMemoryDirectory : undefined
    }).filter(([, value]) => value !== undefined)
  ) as Partial<AppConfig>;
}

export async function loadConfig(
  project: ProjectContext,
  overrides: Partial<AppConfig> = {}
): Promise<LoadedConfig> {
  const warnings: string[] = [];
  const files: string[] = [];

  const managedFile = getManagedConfigPath();
  const userFile = getUserConfigPath();
  const projectFile = getProjectConfigPath(project.projectRoot);
  const localFile = getLocalConfigPath(project.projectRoot);

  let merged: Partial<AppConfig> = { ...defaultConfig };

  const userConfig = await readJsonFile<RawProjectConfig>(userFile);
  if (userConfig) {
    files.push(userFile);
    merged = {
      ...merged,
      ...sanitizeProjectConfig(userConfig, userFile, warnings, true)
    };
  }

  const projectConfig = await readJsonFile<RawProjectConfig>(projectFile);
  if (projectConfig) {
    files.push(projectFile);
    merged = {
      ...merged,
      ...sanitizeProjectConfig(projectConfig, projectFile, warnings, false)
    };
  }

  const localConfig = await readJsonFile<RawProjectConfig>(localFile);
  if (localConfig) {
    files.push(localFile);
    merged = {
      ...merged,
      ...sanitizeProjectConfig(localConfig, localFile, warnings, true)
    };
  }

  merged = {
    ...merged,
    ...overrides
  };

  const managedConfig = await readJsonFile<RawProjectConfig>(managedFile);
  if (managedConfig) {
    files.push(managedFile);
    merged = {
      ...merged,
      ...sanitizeProjectConfig(managedConfig, managedFile, warnings, true)
    };
  }

  const parsed = appConfigSchema.parse(merged);
  if (parsed.autoMemoryDirectory) {
    parsed.autoMemoryDirectory = resolveAppPath(parsed.autoMemoryDirectory);
  }

  return {
    config: parsed,
    warnings,
    files
  };
}

export async function configFilesExist(projectRoot: string): Promise<boolean> {
  return (
    (await fileExists(getProjectConfigPath(projectRoot))) ||
    (await fileExists(getLocalConfigPath(projectRoot))) ||
    (await fileExists(getUserConfigPath()))
  );
}

export const configPaths = {
  getManagedConfigPath,
  getUserConfigPath,
  getProjectConfigPath,
  getLocalConfigPath
};
