import { loadConfig, type LoadConfigOptions } from "../config/load-config.js";
import { patchConfigFile } from "../config/write-config.js";
import { MemoryRetrievalService } from "../domain/memory-retrieval.js";
import { detectProjectContext } from "../domain/project-context.js";
import { SessionContinuityStore } from "../domain/session-continuity-store.js";
import { SyncService } from "../domain/sync-service.js";
import { ensureExistingDirectory } from "../util/paths.js";
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

export interface RuntimeContextOptions {
  ensureMemoryLayout?: boolean;
  loadConfig?: LoadConfigOptions;
}

export async function buildRuntimeContext(
  cwd = process.cwd(),
  overrides: Partial<AppConfig> = {},
  options: RuntimeContextOptions = {}
): Promise<RuntimeContext> {
  const project = detectProjectContext(await ensureExistingDirectory(cwd));
  const loadedConfig = await loadConfig(project, overrides, options.loadConfig);
  const syncService = new SyncService(project, loadedConfig.config);
  const sessionContinuityStore = new SessionContinuityStore(project, loadedConfig.config);
  if (options.ensureMemoryLayout !== false) {
    await syncService.memoryStore.ensureLayout();
  }

  return {
    project,
    loadedConfig,
    syncService,
    sessionContinuityStore
  };
}

export async function buildReadOnlyMemoryRetrievalService(
  cwd = process.cwd()
): Promise<MemoryRetrievalService> {
  const runtime = await buildRuntimeContext(cwd, {}, { ensureMemoryLayout: false });
  return new MemoryRetrievalService(runtime.syncService.memoryStore);
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
