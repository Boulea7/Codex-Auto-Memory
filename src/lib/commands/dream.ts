import { buildRuntimeContext } from "../runtime/runtime-context.js";
import {
  buildDreamSnapshot,
  inspectDreamSidecar,
  persistDreamSnapshot
} from "../domain/dream-sidecar.js";
import { findLatestProjectRollout } from "../domain/rollout.js";
import type { SessionContinuityScope } from "../types.js";

type DreamAction = "build" | "inspect";

interface DreamOptions {
  cwd?: string;
  json?: boolean;
  rollout?: string;
  scope?: SessionContinuityScope | "both";
}

function selectedScope(scope?: SessionContinuityScope | "both"): SessionContinuityScope | "both" {
  if (!scope) {
    return "both";
  }

  if (scope === "project" || scope === "project-local" || scope === "both") {
    return scope;
  }

  throw new Error("Scope must be one of: project, project-local, both.");
}

async function resolveRollout(runtime: Awaited<ReturnType<typeof buildRuntimeContext>>, rollout?: string): Promise<string> {
  if (rollout) {
    return rollout;
  }

  const latestPrimaryRollout = await findLatestProjectRollout(runtime.project);
  if (!latestPrimaryRollout) {
    throw new Error("No relevant rollout found for this project.");
  }

  return latestPrimaryRollout;
}

export async function runDream(
  action: DreamAction,
  options: DreamOptions = {}
): Promise<string> {
  const runtime = await buildRuntimeContext(options.cwd ?? process.cwd(), {}, {
    ensureMemoryLayout: false
  });

  if (action === "inspect") {
    const inspection = await inspectDreamSidecar(runtime);
    if (options.json) {
      return JSON.stringify(
        {
          enabled: inspection.enabled,
          autoBuild: inspection.autoBuild,
          snapshots: inspection.snapshots,
          auditPath: inspection.auditPath,
          recoveryPath: inspection.recoveryPath
        },
        null,
        2
      );
    }

    return [
      "Codex Auto Memory Dream Sidecar",
      `Enabled: ${inspection.enabled}`,
      `Auto-build: ${inspection.autoBuild}`,
      `Project snapshot: ${inspection.snapshots.project.status} (${inspection.snapshots.project.latestPath ?? "none"})`,
      `Project-local snapshot: ${inspection.snapshots.projectLocal.status} (${inspection.snapshots.projectLocal.latestPath ?? "none"})`,
      `Audit: ${inspection.auditPath}`,
      `Recovery: ${inspection.recoveryPath}`
    ].join("\n");
  }

  const scope = selectedScope(options.scope);
  const rolloutPath = await resolveRollout(runtime, options.rollout);
  const snapshot = await buildDreamSnapshot({
    runtime,
    rolloutPath
  });
  const persisted = await persistDreamSnapshot({
    runtime,
    snapshot,
    scope
  });

  if (options.json) {
    return JSON.stringify(
      {
        action: "build",
        enabled: runtime.loadedConfig.config.dreamSidecarEnabled === true,
        autoBuild: runtime.loadedConfig.config.dreamSidecarAutoBuild === true,
        snapshot: persisted.snapshot,
        snapshotPaths: persisted.snapshotPaths,
        auditPath: persisted.auditPath,
        recoveryPath: persisted.recoveryPath
      },
      null,
      2
    );
  }

  return [
    `Built dream sidecar snapshot from ${rolloutPath}`,
    `Snapshot paths: ${persisted.snapshotPaths.join(", ")}`,
    `Relevant refs: ${persisted.snapshot.relevantMemoryRefs.length}`,
    `Pending promotions: ${
      persisted.snapshot.promotionCandidates.instructionLikeCandidates.length +
      persisted.snapshot.promotionCandidates.durableMemoryCandidates.length
    }`,
    `Audit: ${persisted.auditPath}`
  ].join("\n");
}
