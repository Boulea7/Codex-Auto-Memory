import os from "node:os";
import path from "node:path";
import {
  APP_ID,
  DEFAULT_SESSION_CONTINUITY_LINE_LIMIT,
  DEFAULT_STARTUP_LINE_LIMIT
} from "../constants.js";
import type { AppConfig, LoadedConfig, ProjectContext } from "../types.js";
import { fileExists, readJsonFile } from "../util/fs.js";
import { resolveAppPath } from "../util/paths.js";
import { appConfigSchema, rawProjectConfigSchema, type RawProjectConfig } from "./schema.js";

const defaultConfig: AppConfig = {
  autoMemoryEnabled: true,
  extractorMode: "codex",
  defaultScope: "project",
  maxStartupLines: DEFAULT_STARTUP_LINE_LIMIT,
  sessionContinuityAutoLoad: false,
  sessionContinuityAutoSave: false,
  sessionContinuityLocalPathStyle: "codex",
  maxSessionContinuityLines: DEFAULT_SESSION_CONTINUITY_LINE_LIMIT,
  dreamSidecarEnabled: false,
  dreamSidecarAutoBuild: false,
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
  allowDirectoryOverride: boolean,
  allowSessionContinuityOverride: boolean,
  allowCodexBinaryOverride: boolean
): Partial<AppConfig> {
  const parsed = rawProjectConfigSchema.parse(source);
  if (!allowDirectoryOverride && parsed.autoMemoryDirectory) {
    warnings.push(
      `Ignored autoMemoryDirectory from ${filePath}. Shared project config cannot redirect memory storage.`
    );
  }
  if (
    !allowSessionContinuityOverride &&
    (parsed.sessionContinuityAutoLoad !== undefined ||
      parsed.sessionContinuityAutoSave !== undefined ||
      parsed.sessionContinuityLocalPathStyle !== undefined ||
      parsed.maxSessionContinuityLines !== undefined)
  ) {
    warnings.push(
      `Ignored session continuity local settings from ${filePath}. Shared project config cannot force local session continuity behavior.`
    );
  }
  if (!allowCodexBinaryOverride && parsed.codexBinary) {
    warnings.push(
      `Ignored codexBinary from ${filePath}. Shared project config cannot override the executable used to launch Codex.`
    );
  }

  return Object.fromEntries(
    Object.entries({
      autoMemoryEnabled: parsed.autoMemoryEnabled,
      extractorMode: parsed.extractorMode,
      defaultScope: parsed.defaultScope,
      maxStartupLines: parsed.maxStartupLines,
      sessionContinuityAutoLoad: allowSessionContinuityOverride
        ? parsed.sessionContinuityAutoLoad
        : undefined,
      sessionContinuityAutoSave: allowSessionContinuityOverride
        ? parsed.sessionContinuityAutoSave
        : undefined,
      sessionContinuityLocalPathStyle: allowSessionContinuityOverride
        ? parsed.sessionContinuityLocalPathStyle
        : undefined,
      maxSessionContinuityLines: allowSessionContinuityOverride
        ? parsed.maxSessionContinuityLines
        : undefined,
      dreamSidecarEnabled: parsed.dreamSidecarEnabled,
      dreamSidecarAutoBuild: parsed.dreamSidecarAutoBuild,
      codexBinary: allowCodexBinaryOverride ? parsed.codexBinary : undefined,
      autoMemoryDirectory: allowDirectoryOverride ? parsed.autoMemoryDirectory : undefined
    }).filter(([, value]) => value !== undefined)
  ) as Partial<AppConfig>;
}

async function readOptionalConfigFile(
  filePath: string,
  label: "managed" | "user" | "project" | "local",
  warnings: string[]
): Promise<RawProjectConfig | null> {
  try {
    return await readJsonFile<RawProjectConfig>(filePath);
  } catch (error) {
    warnings.push(
      `Ignored invalid ${label} config at ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

export interface LoadConfigOptions {
  allowProjectCodexBinaryOverride?: boolean;
  allowLocalCodexBinaryOverride?: boolean;
}

export async function loadConfig(
  project: ProjectContext,
  overrides: Partial<AppConfig> = {},
  options: LoadConfigOptions = {}
): Promise<LoadedConfig> {
  const warnings: string[] = [];
  const files: string[] = [];

  const managedFile = getManagedConfigPath();
  const userFile = getUserConfigPath();
  const projectFile = getProjectConfigPath(project.projectRoot);
  const localFile = getLocalConfigPath(project.projectRoot);

  let merged: Partial<AppConfig> = { ...defaultConfig };

  const userConfig = await readOptionalConfigFile(userFile, "user", warnings);
  if (userConfig) {
    files.push(userFile);
    merged = {
      ...merged,
      ...sanitizeProjectConfig(userConfig, userFile, warnings, true, true, true)
    };
  }

  const projectConfig = await readOptionalConfigFile(projectFile, "project", warnings);
  if (projectConfig) {
    files.push(projectFile);
    merged = {
      ...merged,
      ...sanitizeProjectConfig(
        projectConfig,
        projectFile,
        warnings,
        false,
        false,
        options.allowProjectCodexBinaryOverride === true
      )
    };
  }

  const localConfig = await readOptionalConfigFile(localFile, "local", warnings);
  if (localConfig) {
    files.push(localFile);
    merged = {
      ...merged,
      ...sanitizeProjectConfig(
        localConfig,
        localFile,
        warnings,
        true,
        true,
        options.allowLocalCodexBinaryOverride !== false
      )
    };
  }

  merged = {
    ...merged,
    ...overrides
  };

  const managedConfig = await readOptionalConfigFile(managedFile, "managed", warnings);
  if (managedConfig) {
    files.push(managedFile);
    merged = {
      ...merged,
      ...sanitizeProjectConfig(managedConfig, managedFile, warnings, true, true, true)
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
