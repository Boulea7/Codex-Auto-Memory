import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_ID } from "../constants.js";
import type {
  AppConfig,
  ExistingSessionContinuityState,
  RolloutEvidence,
  SessionContinuityDiagnostics,
  SessionContinuityGenerationResult,
  SessionContinuityLayerSummary,
  SessionContinuitySummary
} from "../types.js";
import { runCommandCapture } from "../util/process.js";
import { trimText } from "../util/text.js";
import {
  NEXT_STEP_PATTERNS,
  UNTRIED_PATTERNS,
  buildSessionContinuityEvidenceCounts,
  collectSessionContinuityEvidenceBuckets,
  extractPatternMatches,
  hasEvidenceBuckets,
  looksLocalSpecific,
  mergeItems,
  normalizeMessage
} from "./session-continuity-evidence.js";
import type { SessionContinuityEvidenceBuckets } from "./session-continuity-evidence.js";
import { buildSessionContinuityPrompt } from "./session-continuity-prompt.js";
const PROJECT_NOTE_PATTERNS = [
  /\b(requires|must|must run|need to run|before running|use pnpm|use bun|use npm|prefer|service|redis|postgres|docker|environment|env var|setup)\b/iu,
  /(需要|必须|先启动|运行前|使用 pnpm|使用 bun|使用 npm|环境变量|服务|数据库|Redis|Docker)/u
];

function extractProjectNotes(messages: string[]): { project: string[]; projectLocal: string[] } {
  const project: string[] = [];
  const projectLocal: string[] = [];

  for (const message of messages) {
    if (!PROJECT_NOTE_PATTERNS.some((pattern) => pattern.test(message))) {
      continue;
    }
    const normalized = normalizeMessage(message);
    if (!normalized) {
      continue;
    }
    if (looksLocalSpecific(normalized)) {
      projectLocal.push(normalized);
    } else {
      project.push(normalized);
    }
  }

  return {
    project: mergeItems(project).slice(0, 6),
    projectLocal: mergeItems(projectLocal).slice(0, 6)
  };
}

function buildLayerSummary(
  existing: SessionContinuityLayerSummary | null | undefined,
  next: Partial<SessionContinuityLayerSummary>
): SessionContinuityLayerSummary {
  return {
    goal: next.goal || existing?.goal || "",
    confirmedWorking: mergeItems(next.confirmedWorking, existing?.confirmedWorking),
    triedAndFailed: mergeItems(next.triedAndFailed, existing?.triedAndFailed),
    notYetTried: mergeItems(next.notYetTried, existing?.notYetTried),
    incompleteNext: mergeItems(next.incompleteNext, existing?.incompleteNext),
    filesDecisionsEnvironment: mergeItems(
      next.filesDecisionsEnvironment,
      existing?.filesDecisionsEnvironment
    )
  };
}

const layerKeys = [
  "confirmedWorking",
  "triedAndFailed",
  "notYetTried",
  "incompleteNext",
  "filesDecisionsEnvironment"
] satisfies Array<keyof SessionContinuityLayerSummary>;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isValidLayerSummary(value: unknown): value is SessionContinuityLayerSummary {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<Record<keyof SessionContinuityLayerSummary, unknown>>;
  if (typeof candidate.goal !== "string") {
    return false;
  }

  return layerKeys.every((key) => isStringArray(candidate[key]));
}

function isValidSessionContinuitySummary(value: unknown): value is SessionContinuitySummary {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<Record<keyof SessionContinuitySummary, unknown>>;
  if (
    candidate.sourceSessionId !== undefined &&
    typeof candidate.sourceSessionId !== "string"
  ) {
    return false;
  }

  return (
    isValidLayerSummary(candidate.project) &&
    isValidLayerSummary(candidate.projectLocal)
  );
}

function hasEvidenceBearingContent(summary: SessionContinuitySummary): boolean {
  return [summary.project, summary.projectLocal].some((layer) =>
    layerKeys.some((key) => layer[key].length > 0)
  );
}

function shouldFallbackForLowSignal(
  summary: SessionContinuitySummary,
  buckets: SessionContinuityEvidenceBuckets
): boolean {
  return hasEvidenceBuckets(buckets) && !hasEvidenceBearingContent(summary);
}

function heuristicSummary(
  evidence: RolloutEvidence,
  existingState?: ExistingSessionContinuityState,
  buckets = collectSessionContinuityEvidenceBuckets(evidence)
): SessionContinuitySummary {
  const recentUserMessages = evidence.userMessages.map((message) => trimText(message, 240));
  const recentAgentMessages = evidence.agentMessages.map((message) => trimText(message, 240));
  const recentMessages = [...recentAgentMessages.slice(-10), ...recentUserMessages.slice(-10)];
  const recentMessagesReversed = [...recentMessages].reverse();
  const untriedCandidates =
    buckets.explicitUntried.length > 0
      ? buckets.explicitUntried
      : extractPatternMatches(recentMessagesReversed, UNTRIED_PATTERNS, 6);
  const projectUntried = untriedCandidates.filter((item) => !looksLocalSpecific(item));
  const localUntried = untriedCandidates.filter(looksLocalSpecific);
  const nextSteps =
    buckets.explicitNextSteps.length > 0
      ? buckets.explicitNextSteps
      : extractPatternMatches(recentMessagesReversed, NEXT_STEP_PATTERNS, 4);
  const fallbackNext =
    nextSteps.length > 0
      ? nextSteps
      : recentUserMessages.length > 0
        ? [`Continue with the latest request: ${recentUserMessages.at(-1)}`]
        : [];
  const notes = extractProjectNotes(recentMessages);
  const existingProject = existingState?.project;
  const existingLocal = existingState?.projectLocal;
  const sharedGoal = recentUserMessages.at(-1) ?? existingProject?.goal ?? existingLocal?.goal ?? "";

  return {
    sourceSessionId: evidence.sessionId,
    project: buildLayerSummary(existingProject, {
      goal: sharedGoal,
      confirmedWorking: buckets.recentSuccessfulCommands,
      triedAndFailed: buckets.recentFailedCommands,
      notYetTried: projectUntried,
      filesDecisionsEnvironment: notes.project
    }),
    projectLocal: buildLayerSummary(existingLocal, {
      goal: existingLocal?.goal ?? "",
      notYetTried: localUntried,
      incompleteNext: fallbackNext,
      filesDecisionsEnvironment: [
        ...buckets.detectedFileWrites,
        ...notes.projectLocal
      ]
    })
  };
}

function buildDiagnostics(
  evidence: RolloutEvidence,
  preferredPath: SessionContinuityDiagnostics["preferredPath"],
  actualPath: SessionContinuityDiagnostics["actualPath"],
  buckets: SessionContinuityEvidenceBuckets,
  fallbackReason?: SessionContinuityDiagnostics["fallbackReason"],
  codexExitCode?: number
): SessionContinuityDiagnostics {
  return {
    generatedAt: new Date().toISOString(),
    rolloutPath: evidence.rolloutPath,
    sourceSessionId: evidence.sessionId,
    preferredPath,
    actualPath,
    fallbackReason,
    codexExitCode,
    evidenceCounts: buildSessionContinuityEvidenceCounts(buckets)
  };
}

interface CodexAttemptResult {
  summary: SessionContinuitySummary | null;
  fallbackReason?: SessionContinuityDiagnostics["fallbackReason"];
  codexExitCode?: number;
}

export class SessionContinuitySummarizer {
  private readonly schemaPath: string;

  public constructor(
    private readonly config: AppConfig,
    schemaPath = fileURLToPath(new URL("../../../schemas/session-continuity.schema.json", import.meta.url))
  ) {
    this.schemaPath = schemaPath;
  }

  public async summarize(
    evidence: RolloutEvidence,
    existingState?: ExistingSessionContinuityState
  ): Promise<SessionContinuitySummary> {
    return (await this.summarizeWithDiagnostics(evidence, existingState)).summary;
  }

  public async summarizeWithDiagnostics(
    evidence: RolloutEvidence,
    existingState?: ExistingSessionContinuityState
  ): Promise<SessionContinuityGenerationResult> {
    const buckets = collectSessionContinuityEvidenceBuckets(evidence);
    if (this.config.extractorMode !== "codex") {
      return {
        summary: heuristicSummary(evidence, existingState, buckets),
        diagnostics: buildDiagnostics(
          evidence,
          "heuristic",
          "heuristic",
          buckets,
          "configured-heuristic"
        )
      };
    }

    const attempt = await this.codexSummary(evidence, existingState, buckets);
    if (attempt.summary) {
      return {
        summary: attempt.summary,
        diagnostics: buildDiagnostics(
          evidence,
          "codex",
          "codex",
          buckets,
          undefined,
          attempt.codexExitCode
        )
      };
    }

    return {
      summary: heuristicSummary(evidence, existingState, buckets),
      diagnostics: buildDiagnostics(
        evidence,
        "codex",
        "heuristic",
        buckets,
        attempt.fallbackReason,
        attempt.codexExitCode
      )
    };
  }

  private async codexSummary(
    evidence: RolloutEvidence,
    existingState?: ExistingSessionContinuityState,
    buckets = collectSessionContinuityEvidenceBuckets(evidence)
  ): Promise<CodexAttemptResult> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `${APP_ID}-session-`));
    const outputPath = path.join(tempDir, "session-continuity.json");
    const prompt = buildSessionContinuityPrompt(evidence, existingState, buckets);

    const args = [
      "exec",
      "--ephemeral",
      "--skip-git-repo-check",
      "--color",
      "never",
      "--output-schema",
      this.schemaPath,
      "-o",
      outputPath,
      "-"
    ];

    const result = runCommandCapture(this.config.codexBinary, args, evidence.cwd, process.env, prompt);
    if (result.exitCode !== 0) {
      await fs.rm(tempDir, { recursive: true, force: true });
      return {
        summary: null,
        fallbackReason: "codex-command-failed",
        codexExitCode: result.exitCode
      };
    }

    try {
      const raw = await fs.readFile(outputPath, "utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        return {
          summary: null,
          fallbackReason: "invalid-json",
          codexExitCode: result.exitCode
        };
      }

      if (!isValidSessionContinuitySummary(parsed)) {
        return {
          summary: null,
          fallbackReason: "invalid-structure",
          codexExitCode: result.exitCode
        };
      }

      const summary: SessionContinuitySummary = {
        ...parsed,
        sourceSessionId: parsed.sourceSessionId ?? evidence.sessionId
      };
      if (shouldFallbackForLowSignal(summary, buckets)) {
        return {
          summary: null,
          fallbackReason: "low-signal",
          codexExitCode: result.exitCode
        };
      }

      return {
        summary,
        codexExitCode: result.exitCode
      };
    } catch {
      return {
        summary: null,
        fallbackReason: "invalid-structure",
        codexExitCode: result.exitCode
      };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
}
