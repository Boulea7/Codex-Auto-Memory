import type {
  MemoryConflictCandidate,
  MemoryEntry,
  MemoryOperation,
  MemoryScope
} from "../types.js";

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

const reviewableTopics = new Set(["preferences", "workflow", "commands"]);
const replacementDeleteReasonPattern = /^Superseded by a newer /u;
const packageManagerValues = ["pnpm", "npm", "yarn", "bun"] as const;
const repoSearchValues = ["rg", "ripgrep", "grep"] as const;
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

function commandSignature(command: string): string | null {
  const normalized = command.toLowerCase().trim();
  if (/\b(?:pnpm|npm|bun|yarn)\s+(test|lint|build|install)\b/u.test(normalized)) {
    return normalized.match(/\b(?:pnpm|npm|bun|yarn)\s+(test|lint|build|install)\b/u)?.[1] ?? null;
  }

  if (/\bcargo\s+(test|build|check)\b/u.test(normalized)) {
    return normalized.match(/\bcargo\s+(test|build|check)\b/u)?.[1] ?? null;
  }

  if (/\b(?:pytest|jest|vitest|go test|dotnet test|rake)\b/u.test(normalized)) {
    return "test";
  }

  if (/\b(?:tsc|vite build|next build|gradle|mvn|make)\b/u.test(normalized)) {
    return "build";
  }

  return null;
}

function extractCommandChoice(text: string): DirectiveChoice[] {
  const commandMatch = text.match(/`([^`]+)`/u);
  const command = commandMatch?.[1]?.trim();
  if (!command) {
    return [];
  }

  const signature = commandSignature(command);
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

  return [
    ...extractValueChoice(operation.summary, packageManagerValues, "package-manager"),
    ...extractValueChoice(operation.summary, repoSearchValues, "repo-search")
  ];
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

function hasRetainedHighConfidenceCandidate(
  reviews: CandidateReview[],
  retainedIndices: Set<number>,
  groupKey: string
): boolean {
  return reviews.some(
    (review) =>
      review.groupKey === groupKey &&
      review.highConfidence &&
      retainedIndices.has(review.index)
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

  const groupsNeedingDeleteSuppression = new Set<string>();
  for (const review of reviews) {
    if (!suppressedIndices.has(review.index)) {
      continue;
    }

    if (!hasRetainedHighConfidenceCandidate(reviews, retainedIndices, review.groupKey)) {
      groupsNeedingDeleteSuppression.add(review.groupKey);
    }
  }

  const keptOperations = operations.filter((operation, index) => {
    if (suppressedIndices.has(index)) {
      return false;
    }

    if (!isReplacementDelete(operation)) {
      return true;
    }

    return !groupsNeedingDeleteSuppression.has(buildGroupKey(operation.scope, operation.topic));
  });

  return {
    operations: keptOperations,
    suppressedOperationCount: operations.length - keptOperations.length,
    conflicts
  };
}
