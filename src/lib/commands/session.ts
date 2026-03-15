import { spawn } from "node:child_process";
import { findLatestProjectRollout } from "../domain/rollout.js";
import {
  compileSessionContinuity,
  createEmptySessionContinuityState
} from "../domain/session-continuity.js";
import type { SessionContinuityScope } from "../types.js";
import { SessionContinuitySummarizer } from "../extractor/session-continuity-summarizer.js";
import { buildRuntimeContext } from "./common.js";

type SessionAction = "status" | "save" | "load" | "clear" | "open";

interface SessionOptions {
  cwd?: string;
  json?: boolean;
  printStartup?: boolean;
  rollout?: string;
  scope?: SessionContinuityScope | "both";
}

function openPath(targetPath: string): void {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args =
    process.platform === "darwin"
      ? [targetPath]
      : process.platform === "win32"
        ? ["/c", "start", "", targetPath]
        : [targetPath];

  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
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

export async function runSession(
  action: SessionAction,
  options: SessionOptions = {}
): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const runtime = await buildRuntimeContext(cwd);
  const scope = selectedScope(options.scope);

  if (action === "save") {
    const rolloutPath =
      options.rollout ?? (await findLatestProjectRollout(runtime.project));
    if (!rolloutPath) {
      throw new Error("No relevant rollout found for this project.");
    }

    const { parseRolloutEvidence } = await import("../domain/rollout.js");
    const parsedEvidence = await parseRolloutEvidence(rolloutPath);
    if (!parsedEvidence) {
      throw new Error(`Could not parse rollout evidence from ${rolloutPath}.`);
    }

    const existing = await runtime.sessionContinuityStore.readMergedState();
    const summarizer = new SessionContinuitySummarizer(runtime.loadedConfig.config);
    const summary = await summarizer.summarize(parsedEvidence, existing);
    const written = await runtime.sessionContinuityStore.saveSummary(summary, scope);
    const excludePath = await runtime.sessionContinuityStore.ensureLocalIgnore();

    if (options.json) {
      return JSON.stringify(
        {
          rolloutPath,
          written,
          excludePath,
          summary
        },
        null,
        2
      );
    }

    return [
      `Saved session continuity from ${rolloutPath}`,
      ...written.map((filePath) => `- ${filePath}`),
      ...(excludePath ? [`Local exclude updated: ${excludePath}`] : [])
    ].join("\n");
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

  const projectLocation = await runtime.sessionContinuityStore.getLocation("project");
  const localLocation = await runtime.sessionContinuityStore.getLocation("project-local");
  const mergedState =
    (await runtime.sessionContinuityStore.readMergedState()) ??
    createEmptySessionContinuityState(
      "project-local",
      runtime.project.projectId,
      runtime.project.worktreeId
    );
  const startup = compileSessionContinuity(
    mergedState,
    [projectLocation.path, localLocation.path].filter(Boolean),
    runtime.loadedConfig.config.maxSessionContinuityLines
  );

  if (action === "load") {
    if (options.json) {
      return JSON.stringify(
        {
          projectLocation,
          localLocation,
          mergedState,
          startup
        },
        null,
        2
      );
    }

    const lines = [
      "Session Continuity",
      `Project continuity: ${projectLocation.exists ? "active" : "missing"} (${projectLocation.path})`,
      `Project-local continuity: ${localLocation.exists ? "active" : "missing"} (${localLocation.path})`,
      "",
      `Goal: ${mergedState.goal || "No active goal recorded."}`,
      "",
      "Confirmed working:",
      ...(mergedState.confirmedWorking.length > 0
        ? mergedState.confirmedWorking.map((item) => `- ${item}`)
        : ["- Nothing confirmed yet."]),
      "",
      "Tried and failed:",
      ...(mergedState.triedAndFailed.length > 0
        ? mergedState.triedAndFailed.map((item) => `- ${item}`)
        : ["- No failed approaches recorded."]),
      "",
      "Not yet tried:",
      ...(mergedState.notYetTried.length > 0
        ? mergedState.notYetTried.map((item) => `- ${item}`)
        : ["- No untried approaches recorded."]),
      "",
      "Incomplete / next:",
      ...(mergedState.incompleteNext.length > 0
        ? mergedState.incompleteNext.map((item) => `- ${item}`)
        : ["- No next step recorded."])
    ];

    if (options.printStartup) {
      lines.push("", "Startup continuity:", startup.text.trimEnd());
    }

    return lines.join("\n");
  }

  if (options.json) {
    return JSON.stringify(
      {
        autoLoad: runtime.loadedConfig.config.sessionContinuityAutoLoad,
        autoSave: runtime.loadedConfig.config.sessionContinuityAutoSave,
        localPathStyle: runtime.loadedConfig.config.sessionContinuityLocalPathStyle,
        maxLines: runtime.loadedConfig.config.maxSessionContinuityLines,
        projectLocation,
        localLocation,
        mergedState
      },
      null,
      2
    );
  }

  return [
    "Codex Auto Memory Session Continuity",
    `Auto-load: ${runtime.loadedConfig.config.sessionContinuityAutoLoad}`,
    `Auto-save: ${runtime.loadedConfig.config.sessionContinuityAutoSave}`,
    `Local path style: ${runtime.loadedConfig.config.sessionContinuityLocalPathStyle}`,
    `Shared continuity: ${projectLocation.exists ? "active" : "missing"} (${projectLocation.path})`,
    `Project-local continuity: ${localLocation.exists ? "active" : "missing"} (${localLocation.path})`,
    `Startup continuity line budget: ${runtime.loadedConfig.config.maxSessionContinuityLines}`
  ].join("\n");
}
