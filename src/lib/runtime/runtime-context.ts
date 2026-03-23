import { loadConfig } from "../config/load-config.js";
import { patchConfigFile } from "../config/write-config.js";
import { detectProjectContext } from "../domain/project-context.js";
import { SessionContinuityStore } from "../domain/session-continuity-store.js";
import { SyncService } from "../domain/sync-service.js";
import type {
  AppConfig,
  ConfigScope,
  LoadedConfig,
  ProjectContext
} from "../types.js";

export interface RuntimeContext {
  project: ProjectContext;
  loadedConfig: LoadedConfig;
  syncService: SyncService;
  sessionContinuityStore: SessionContinuityStore;
}

export interface ReloadedRuntimeContext {
  runtime: RuntimeContext;
  configUpdatePath: string;
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

export async function patchConfigAndReloadRuntime(
  cwd: string,
  configScope: ConfigScope,
  updates: Partial<AppConfig>
): Promise<ReloadedRuntimeContext> {
  const initialRuntime = await buildRuntimeContext(cwd);
  const configUpdatePath = await patchConfigFile(
    initialRuntime.project.projectRoot,
    configScope,
    updates
  );

  return {
    runtime: await buildRuntimeContext(cwd),
    configUpdatePath
  };
}
