import { APP_NAME } from "../constants.js";
import { loadConfig } from "../config/load-config.js";
import { detectProjectContext } from "../domain/project-context.js";
import { SyncService } from "../domain/sync-service.js";
import type { AppConfig, LoadedConfig, ProjectContext } from "../types.js";

export interface RuntimeContext {
  project: ProjectContext;
  loadedConfig: LoadedConfig;
  syncService: SyncService;
}

export async function buildRuntimeContext(
  cwd = process.cwd(),
  overrides: Partial<AppConfig> = {}
): Promise<RuntimeContext> {
  const project = detectProjectContext(cwd);
  const loadedConfig = await loadConfig(project, overrides);
  const syncService = new SyncService(project, loadedConfig.config);
  await syncService.memoryStore.ensureLayout();
  return {
    project,
    loadedConfig,
    syncService
  };
}

export function formatWarnings(warnings: string[]): string[] {
  return warnings.map((warning) => `${APP_NAME} warning: ${warning}`);
}

