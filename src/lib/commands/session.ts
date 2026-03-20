import { persistSessionContinuity } from "../domain/session-continuity-persistence.js";
import { findLatestProjectRollout } from "../domain/rollout.js";
import type { RuntimeContext } from "../runtime/runtime-context.js";
import { buildRuntimeContext } from "../runtime/runtime-context.js";
import type { SessionContinuityScope } from "../types.js";
import { openPath } from "../util/open.js";
import {
  buildPersistedSessionJson,
  buildSessionLoadJson,
  buildSessionStatusJson,
  formatPersistedSessionText,
  formatSessionLoadText,
  formatSessionStatusText,
  loadSessionInspectionView
} from "./session-presenters.js";

type SessionAction = "status" | "save" | "refresh" | "load" | "clear" | "open";
type RolloutSelectionKind =
  | "explicit-rollout"
  | "pending-recovery-marker"
  | "latest-audit-entry"
  | "latest-primary-rollout";

interface RolloutSelection {
  kind: RolloutSelectionKind;
  rolloutPath: string;
}

interface SessionOptions {
  cwd?: string;
  json?: boolean;
  printStartup?: boolean;
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

async function selectRefreshRollout(
  runtime: RuntimeContext,
  scope: SessionContinuityScope | "both",
  explicitRollout?: string
): Promise<RolloutSelection> {
  if (explicitRollout) {
    return {
      kind: "explicit-rollout",
      rolloutPath: explicitRollout
    };
  }

  const recoveryRecord = await runtime.sessionContinuityStore.readRecoveryRecord();
  if (recoveryRecord?.scope === scope) {
    return {
      kind: "pending-recovery-marker",
      rolloutPath: recoveryRecord.rolloutPath
    };
  }

  const latestAuditEntry =
    await runtime.sessionContinuityStore.readLatestAuditEntryMatchingScope(scope);
  if (latestAuditEntry) {
    return {
      kind: "latest-audit-entry",
      rolloutPath: latestAuditEntry.rolloutPath
    };
  }

  const latestPrimaryRollout = await findLatestProjectRollout(runtime.project);
  if (latestPrimaryRollout) {
    return {
      kind: "latest-primary-rollout",
      rolloutPath: latestPrimaryRollout
    };
  }

  throw new Error("No relevant rollout found for this project.");
}

export async function runSession(
  action: SessionAction,
  options: SessionOptions = {}
): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const runtime = await buildRuntimeContext(cwd);
  const scope = selectedScope(options.scope);

  if (action === "save" || action === "refresh") {
    const rolloutSelection =
      action === "refresh"
        ? await selectRefreshRollout(runtime, scope, options.rollout)
        : {
            kind: options.rollout ? "explicit-rollout" : "latest-primary-rollout",
            rolloutPath: options.rollout ?? (await findLatestProjectRollout(runtime.project)) ?? ""
          };

    if (!rolloutSelection.rolloutPath) {
      throw new Error("No relevant rollout found for this project.");
    }

    const persisted = await persistSessionContinuity({
      runtime,
      rolloutPath: rolloutSelection.rolloutPath,
      scope,
      trigger: action === "refresh" ? "manual-refresh" : "manual-save",
      writeMode: action === "refresh" ? "replace" : "merge"
    });

    if (options.json) {
      return buildPersistedSessionJson(action, persisted, rolloutSelection);
    }

    return formatPersistedSessionText(action, persisted, rolloutSelection);
  }

  if (action === "clear") {
    const cleared = await runtime.sessionContinuityStore.clear(scope);
    if (options.json) {
      return JSON.stringify({ cleared }, null, 2);
    }

    return cleared.length > 0
      ? [`Cleared session continuity files:`, ...cleared.map((filePath) => `- ${filePath}`)].join(
          "\n"
        )
      : "No session continuity files were active.";
  }

  if (action === "open") {
    await runtime.sessionContinuityStore.ensureLocalLayout();
    openPath(runtime.sessionContinuityStore.paths.localDir);
    return [
      `Opened local continuity directory: ${runtime.sessionContinuityStore.paths.localDir}`,
      `Shared continuity directory: ${runtime.sessionContinuityStore.paths.sharedDir}`
    ].join("\n");
  }

  const view = await loadSessionInspectionView(runtime);

  if (action === "load") {
    if (options.json) {
      return buildSessionLoadJson(view);
    }

    return formatSessionLoadText(view, options.printStartup);
  }

  if (options.json) {
    return buildSessionStatusJson(view);
  }

  return formatSessionStatusText(view);
}
