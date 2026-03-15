import { APP_NAME } from "../constants.js";
import { loadConfig } from "../config/load-config.js";
import { detectProjectContext } from "../domain/project-context.js";
import { SyncService } from "../domain/sync-service.js";
import { SessionContinuityStore } from "../domain/session-continuity-store.js";
import type { AppConfig, LoadedConfig, ProjectContext } from "../types.js";

export interface RuntimeContext {
  project: ProjectContext;
  loadedConfig: LoadedConfig;
  syncService: SyncService;
  sessionContinuityStore: SessionContinuityStore;
}

export async function buildRuntimeContext(
  cwd = process.cwd(),
  overrides: Partial<AppConfig> = {}
): Promise<RuntimeContext> {
  const project = detectProjectContext(cwd);
  const loadedConfig = await loadConfig(project, overrides);
  const syncService = new SyncService(project, loadedConfig.config);
  const sessionContinuityStore = new SessionContinuityStore(project, loadedConfig.config);
  await syncService.memoryStore.ensureLayout();
  return {
    project,
    loadedConfig,
    syncService,
    sessionContinuityStore
  };
}

export function formatWarnings(warnings: string[]): string[] {
  return warnings.map((warning) => `${APP_NAME} warning: ${warning}`);
}
