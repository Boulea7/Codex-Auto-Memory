import type {
  MemoryConflictCandidate,
  MemoryEntry,
  MemoryOperation,
  MemoryScope
} from "../types.js";
import { canonicalCommandSignature } from "./command-signatures.js";

interface DirectiveChoice {
  key: string;
  value: string;
}

interface CandidateReview {
  index: number;
  operation: MemoryOperation;
  groupKey: string;
  choices: DirectiveChoice[];
  highConfidence: boolean;
}

export interface ReviewedMemoryOperations {
  operations: MemoryOperation[];
  suppressedOperationCount: number;
  conflicts: MemoryConflictCandidate[];
}

const reviewableTopics = new Set([
  "preferences",
  "workflow",
  "commands",
  "reference",
  "architecture",
  "debugging",
  "patterns"
]);
const replacementDeleteReasonPattern = /^Superseded by a newer /u;
const packageManagerValues = ["pnpm", "npm", "yarn", "bun"] as const;
const repoSearchValues = ["rg", "ripgrep", "grep"] as const;
const canonicalStoreValues = ["markdown", "sqlite", "database", "vector"] as const;
const debuggingDependencyValues = ["redis", "postgres", "docker"] as const;
const hedgedCorrectionPattern =
  /(?:\bmaybe\b|\bperhaps\b|\bif possible\b|\bwhen possible\b|\bfor now\b|\bprobably\b|\busually\b|\bsometimes\b|\btry\b|\bconsider\b|\bmight\b|\bcould\b|尽量|如果可以|可能|暂时)/iu;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildGroupKey(scope: MemoryScope, topic: string): string {
  return `${scope}::${topic}`;
}

function isHighConfidenceReplacement(operation: MemoryOperation): boolean {
  if (operation.action !== "upsert") {
    return false;
  }

  if (operation.reason === "Explicit user correction that should replace stale memory.") {
    return !hedgedCorrectionPattern.test(operation.summary ?? "");
  }

  return false;
}

function hasCommandReplacementDelete(
  operations: MemoryOperation[],
  operation: MemoryOperation
): boolean {
  return operations.some(
    (candidate) =>
      candidate.action === "delete" &&
      candidate.scope === operation.scope &&
      candidate.topic === operation.topic &&
      isReplacementDelete(candidate)
  );
}

function extractCommandChoice(text: string): DirectiveChoice[] {
  const commandMatch = text.match(/`([^`]+)`/u);
  const command = commandMatch?.[1]?.trim();
  if (!command) {
    return [];
  }

  const signature = canonicalCommandSignature(command);
  if (!signature) {
    return [];
  }

  return [
    {
      key: `command:${signature}`,
      value: command.toLowerCase()
    }
  ];
}

function extractValueChoice(
  text: string,
  values: readonly string[],
  key: string
): DirectiveChoice[] {
  const normalized = text.toLowerCase();

  for (const value of values) {
    const escaped = escapeRegExp(value);
    const patterns = [
      new RegExp(`\\b(?:we\\s+)?use\\s+${escaped}\\b`, "u"),
      new RegExp(`\\bprefer\\s+${escaped}\\b`, "u"),
      new RegExp(`\\balways\\s+use\\s+${escaped}\\b`, "u"),
      new RegExp(`\\bnot\\s+[^,.]+[,，]\\s*(?:actually\\s+)?use\\s+${escaped}\\b`, "u"),
      new RegExp(`(?:使用|用|优先用|优先使用)\\s*${escaped}\\b`, "u"),
      new RegExp(`(?:别用|不要用)[^，,。.;；]*[，,]\\s*用\\s*${escaped}\\b`, "u")
    ];

    if (patterns.some((pattern) => pattern.test(normalized))) {
      return [
        {
          key,
          value
        }
      ];
    }
  }

  return [];
}

function extractDirectiveChoices(operation: MemoryOperation): DirectiveChoice[] {
  if (operation.action !== "upsert" || !operation.summary) {
    return [];
  }

  if (operation.topic === "commands") {
    return extractCommandChoice(operation.summary);
  }

  if (operation.topic === "reference") {
    return extractReferenceChoices(operation.summary);
  }

  if (operation.topic === "architecture") {
    return extractArchitectureChoices(operation.summary);
  }

  if (operation.topic === "debugging") {
    return extractDebuggingChoices(operation.summary);
  }

  if (operation.topic === "patterns") {
    return extractPatternChoices(operation.summary);
  }

  return [
    ...extractValueChoice(operation.summary, packageManagerValues, "package-manager"),
    ...extractValueChoice(operation.summary, repoSearchValues, "repo-search")
  ];
}

function normalizeReferenceUrl(url: string): string {
  return url.replace(/[),.;]+$/u, "").trim().toLowerCase();
}

function extractReferenceChoices(text: string): DirectiveChoice[] {
  const normalized = text.toLowerCase();
  const urlMatch = text.match(/https?:\/\/[^\s)]+/iu)?.[0];
  const url = urlMatch ? normalizeReferenceUrl(urlMatch) : null;
  const category =
    /\bdashboard\b|仪表盘/u.test(normalized)
      ? "dashboard"
      : /\brunbook\b|操作手册|run book/u.test(normalized)
        ? "runbook"
        : /\bdoc(?:s|umentation)?\b|文档/u.test(normalized)
          ? "docs"
          : /\b(?:linear|jira|issue tracker|issues?)\b|缺陷追踪|问题追踪/u.test(normalized)
            ? "issue-tracker"
            : "pointer";

  if (url) {
    return [
      {
        key: `reference:${category}`,
        value: url
      }
    ];
  }

  const trackerMatch = normalized.match(/\b(linear|jira|github issues?)\b/iu)?.[1];
  if (trackerMatch) {
    return [
      {
        key: `reference:${category}`,
        value: trackerMatch.toLowerCase()
      }
    ];
  }

  return [];
}

function extractArchitectureChoices(text: string): DirectiveChoice[] {
  const normalized = text.toLowerCase();
  if (!/\b(canonical|source of truth|db-first|markdown-first|database-first)\b|规范存储|主真相/u.test(text)) {
    return [];
  }

  if (/markdown-first|markdown.*source of truth|markdown.*canonical/u.test(normalized)) {
    return [
      {
        key: "architecture:canonical-store",
        value: "markdown"
      }
    ];
  }

  const choice = extractValueChoice(normalized, canonicalStoreValues, "architecture:canonical-store");
  if (choice.length > 0) {
    return choice;
  }

  if (/db-first|database-first|数据库优先/u.test(normalized)) {
    return [
      {
        key: "architecture:canonical-store",
        value: "database"
      }
    ];
  }

  return [];
}

function extractDebuggingChoices(text: string): DirectiveChoice[] {
  const normalized = text.toLowerCase();
  const choices: DirectiveChoice[] = [];

  for (const value of debuggingDependencyValues) {
    const pattern = new RegExp(`\\b${escapeRegExp(value)}\\b`, "iu");
    if (!pattern.test(normalized)) {
      continue;
    }

    if (
      /\b(?:does not require|doesn't require|is not required|not required|without)\b|不需要|无需/u.test(
        text
      )
    ) {
      choices.push({
        key: `debugging:required-service:${value}`,
        value: "not-required"
      });
      continue;
    }

    if (
      /\b(requires?|needs?|start|before running|must be running|running before|before integration tests)\b|需要|必须|先启动/u.test(
        text
      )
    ) {
      choices.push({
        key: `debugging:required-service:${value}`,
        value: "required"
      });
    }
  }

  return choices;
}

function extractPatternChoices(text: string): DirectiveChoice[] {
  const normalized = text.toLowerCase().replace(/\s+/gu, " ");
  if (/search\s*->\s*timeline\s*->\s*details/u.test(normalized)) {
    return [
      {
        key: "patterns:retrieval-flow",
        value: "search->timeline->details"
      }
    ];
  }

  if (/mcp\s*->\s*local bridge\s*->\s*resolved cli/u.test(normalized)) {
    return [
      {
        key: "patterns:route-order",
        value: "mcp->local-bridge->resolved-cli"
      }
    ];
  }

  return [];
}

function choicesConflict(left: DirectiveChoice[], right: DirectiveChoice[]): boolean {
  return left.some((leftChoice) =>
    right.some(
      (rightChoice) =>
        leftChoice.key === rightChoice.key && leftChoice.value !== rightChoice.value
    )
  );
}

function buildConflictCandidate(
  operation: MemoryOperation,
  source: MemoryConflictCandidate["source"],
  conflictsWith: string[]
): MemoryConflictCandidate | null {
  if (operation.action !== "upsert" || !operation.summary || conflictsWith.length === 0) {
    return null;
  }

  return {
    scope: operation.scope,
    topic: operation.topic,
    candidateSummary: operation.summary,
    conflictsWith,
    source,
    resolution: "suppressed"
  };
}

function findPreferredWithinRolloutWinner(
  review: CandidateReview,
  conflictingReviews: CandidateReview[]
): CandidateReview | null {
  const highConfidenceReviews = [review, ...conflictingReviews]
    .filter((candidate) => candidate.highConfidence)
    .sort((left, right) => right.index - left.index);

  return highConfidenceReviews[0] ?? null;
}

function entryDirectiveChoices(entry: MemoryEntry): DirectiveChoice[] {
  return extractDirectiveChoices({
    action: "upsert",
    scope: entry.scope,
    topic: entry.topic,
    id: entry.id,
    summary: entry.summary,
    details: entry.details,
    sources: entry.sources,
    reason: entry.reason
  });
}

function shouldKeepReplacementDelete(
  operation: MemoryOperation,
  reviews: CandidateReview[],
  retainedIndices: Set<number>,
  existingEntries: MemoryEntry[]
): boolean {
  const targetEntry = existingEntries.find(
    (entry) =>
      entry.scope === operation.scope &&
      entry.topic === operation.topic &&
      entry.id === operation.id
  );
  if (!targetEntry) {
    return true;
  }

  const targetChoices = entryDirectiveChoices(targetEntry);
  if (targetChoices.length === 0) {
    return true;
  }

  return reviews.some(
    (review) =>
      retainedIndices.has(review.index) &&
      review.highConfidence &&
      review.operation.scope === operation.scope &&
      review.operation.topic === operation.topic &&
      choicesConflict(review.choices, targetChoices)
  );
}

function isReplacementDelete(operation: MemoryOperation): boolean {
  return (
    operation.action === "delete" &&
    typeof operation.reason === "string" &&
    replacementDeleteReasonPattern.test(operation.reason)
  );
}

export function reviewExtractedMemoryOperations(
  operations: MemoryOperation[],
  existingEntries: MemoryEntry[]
): ReviewedMemoryOperations {
  const reviews = operations
    .map((operation, index): CandidateReview | null => {
      if (
        operation.action !== "upsert" ||
        !operation.summary ||
        !reviewableTopics.has(operation.topic)
      ) {
        return null;
      }

      const choices = extractDirectiveChoices(operation);
      if (choices.length === 0) {
        return null;
      }

      return {
        index,
        operation,
        groupKey: buildGroupKey(operation.scope, operation.topic),
        choices,
        highConfidence:
          isHighConfidenceReplacement(operation) ||
          (operation.topic === "commands" && hasCommandReplacementDelete(operations, operation))
      };
    })
    .filter((review): review is CandidateReview => Boolean(review));

  if (reviews.length === 0) {
    return {
      operations,
      suppressedOperationCount: 0,
      conflicts: []
    };
  }

  const suppressedIndices = new Set<number>();
  const retainedIndices = new Set(reviews.map((review) => review.index));
  const conflicts: MemoryConflictCandidate[] = [];

  for (const review of reviews) {
    const conflictingReviews = reviews
      .filter(
        (candidate) =>
          candidate.index !== review.index &&
          candidate.groupKey === review.groupKey &&
          choicesConflict(review.choices, candidate.choices)
      );
    const conflictingCandidates = conflictingReviews
      .map((candidate) => candidate.operation.summary)
      .filter((summary): summary is string => typeof summary === "string");
    const preferredWithinRolloutWinner = findPreferredWithinRolloutWinner(
      review,
      conflictingReviews
    );

    const conflictingExisting = existingEntries
      .filter(
        (entry) =>
          entry.scope === review.operation.scope &&
          entry.topic === review.operation.topic &&
          choicesConflict(review.choices, extractDirectiveChoices({
            action: "upsert",
            scope: entry.scope,
            topic: entry.topic,
            id: entry.id,
            summary: entry.summary,
            details: entry.details,
            sources: entry.sources,
            reason: entry.reason
          }))
      )
      .map((entry) => entry.summary);

    const shouldSuppressForWithinRollout =
      conflictingReviews.length > 0 &&
      (preferredWithinRolloutWinner
        ? preferredWithinRolloutWinner.index !== review.index
        : true);
    const hasExistingConflict = conflictingExisting.length > 0;
    const shouldSuppress =
      shouldSuppressForWithinRollout || (hasExistingConflict && !review.highConfidence);

    if (!shouldSuppress) {
      continue;
    }

    suppressedIndices.add(review.index);
    retainedIndices.delete(review.index);

    const withinRolloutConflict = buildConflictCandidate(
      review.operation,
      "within-rollout",
      conflictingCandidates
    );
    if (withinRolloutConflict) {
      conflicts.push(withinRolloutConflict);
    }

    const existingMemoryConflict = buildConflictCandidate(
      review.operation,
      "existing-memory",
      conflictingExisting
    );
    if (existingMemoryConflict) {
      conflicts.push(existingMemoryConflict);
    }
  }

  const keptOperations = operations.filter((operation, index) => {
    if (suppressedIndices.has(index)) {
      return false;
    }

    if (!isReplacementDelete(operation)) {
      return true;
    }

    return shouldKeepReplacementDelete(operation, reviews, retainedIndices, existingEntries);
  });

  return {
    operations: keptOperations,
    suppressedOperationCount: operations.length - keptOperations.length,
    conflicts
  };
}
