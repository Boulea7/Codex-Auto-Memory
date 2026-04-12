import { DEFAULT_MEMORY_TOPICS } from "../constants.js";
import type {
  MemoryOperation,
  MemoryOperationRejectionReason,
  RejectedMemoryOperationSummary
} from "../types.js";
import { slugify, trimText } from "../util/text.js";

const allowedTopics = new Set<string>(DEFAULT_MEMORY_TOPICS);
const MAX_REVIEWABLE_MEMORY_OPERATIONS = 12;

const sensitivePatterns = [
  /-----BEGIN (RSA|EC|OPENSSH|PGP) PRIVATE KEY-----/i,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|passwd|cookie|session[_-]?id)\b\s*[:=]/i,
  /\bBearer\s+[A-Za-z0-9._-]{10,}\b/i,
  /\bsk-[A-Za-z0-9]{16,}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bAIza[0-9A-Za-z_-]{20,}\b/,
  /\b[A-Za-z0-9+/]{32,}={1,2}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[bpras]-[0-9a-zA-Z-]{10,}\b/,
  /\bnpm_[A-Za-z0-9]{20,}\b/,
  /\b(?:postgres|mongodb|mysql|redis):\/\/[^\s]{10,}/i
] as const;

const volatilePatterns = [
  /\b(todo|next step|later|for now|temporary|tmp|wip|work in progress|resume here|pick this up later|current worktree|current branch|next message)\b/i,
  /(?:^|[\s(])(?:\.agents\/|\.codex\/|\.gemini\/|\.mcp\.json)(?:[\s)]|$)/i
] as const;

export function containsSensitiveContent(input: string): boolean {
  return sensitivePatterns.some((pattern) => pattern.test(input));
}

function looksVolatile(input: string): boolean {
  return volatilePatterns.some((pattern) => pattern.test(input));
}

export interface FilteredMemoryOperationsDiagnostics {
  operations: MemoryOperation[];
  rejectedOperationCount: number;
  rejectedReasonCounts: Partial<Record<MemoryOperationRejectionReason, number>>;
  rejectedOperations: RejectedMemoryOperationSummary[];
}

interface SanitizedOperationResult {
  operation: MemoryOperation | null;
  rejectedReason?: MemoryOperationRejectionReason;
}

function summarizeRejectedOperation(
  operation: MemoryOperation,
  reason: MemoryOperationRejectionReason
): RejectedMemoryOperationSummary {
  return {
    action: operation.action,
    scope: operation.scope,
    topic: operation.topic,
    id: operation.id,
    reason
  };
}

export function sanitizeOperation(operation: MemoryOperation): SanitizedOperationResult {
  const haystack = [
    operation.id,
    operation.topic,
    operation.summary ?? "",
    ...(operation.details ?? []),
    operation.reason ?? ""
  ].join("\n");

  if (containsSensitiveContent(haystack)) {
    return { operation: null, rejectedReason: "sensitive" };
  }

  if (operation.action === "upsert" && !operation.summary) {
    return { operation: null, rejectedReason: "empty-summary" };
  }

  if (!allowedTopics.has(operation.topic)) {
    return { operation: null, rejectedReason: "unknown-topic" };
  }

  const topic = operation.topic;
  const summary = operation.summary ? trimText(operation.summary.trim(), 220) : undefined;
  const details = operation.details
    ?.map((detail) => trimText(detail.trim(), 240))
    .filter((detail) => detail.length > 0 && !containsSensitiveContent(detail));

  if (looksVolatile(haystack)) {
    return { operation: null, rejectedReason: "volatile" };
  }

  if (operation.action === "upsert" && (!details || details.length === 0) && summary) {
    return {
      operation: {
        ...operation,
        topic,
        id: slugify(operation.id || summary),
        summary,
        details: [summary]
      }
    };
  }

  return {
    operation: {
      ...operation,
      topic,
      id: slugify(operation.id),
      summary,
      details
    }
  };
}

export function filterMemoryOperationsWithDiagnostics(
  operations: MemoryOperation[],
  options: {
    applyCap?: boolean;
  } = {}
): FilteredMemoryOperationsDiagnostics {
  const deduped = new Map<string, MemoryOperation>();
  const rejectedOperations: RejectedMemoryOperationSummary[] = [];
  const rejectedReasonCounts: Partial<Record<MemoryOperationRejectionReason, number>> = {};

  for (const operation of operations) {
    const sanitized = sanitizeOperation(operation);
    if (!sanitized.operation) {
      if (sanitized.rejectedReason) {
        rejectedOperations.push(summarizeRejectedOperation(operation, sanitized.rejectedReason));
        rejectedReasonCounts[sanitized.rejectedReason] =
          (rejectedReasonCounts[sanitized.rejectedReason] ?? 0) + 1;
      }
      continue;
    }

    const key = [
      sanitized.operation.action,
      sanitized.operation.scope,
      sanitized.operation.topic,
      sanitized.operation.id
    ].join(":");
    deduped.set(key, sanitized.operation);
  }

  const accepted = [...deduped.values()];
  const retained = options.applyCap === false ? accepted : accepted.slice(0, MAX_REVIEWABLE_MEMORY_OPERATIONS);
  if (options.applyCap !== false) {
    for (const dropped of accepted.slice(MAX_REVIEWABLE_MEMORY_OPERATIONS)) {
      rejectedOperations.push(summarizeRejectedOperation(dropped, "operation-cap"));
      rejectedReasonCounts["operation-cap"] = (rejectedReasonCounts["operation-cap"] ?? 0) + 1;
    }
  }

  return {
    operations: retained,
    rejectedOperationCount: rejectedOperations.length,
    rejectedReasonCounts,
    rejectedOperations
  };
}

export function filterMemoryOperations(operations: MemoryOperation[]): MemoryOperation[] {
  return filterMemoryOperationsWithDiagnostics(operations).operations;
}

export function applyOperationCapWithDiagnostics(
  operations: MemoryOperation[]
): FilteredMemoryOperationsDiagnostics {
  const prioritized = [
    ...operations.filter((operation) => operation.action !== "upsert"),
    ...operations.filter((operation) => operation.action === "upsert")
  ];
  const retained = prioritized.slice(0, MAX_REVIEWABLE_MEMORY_OPERATIONS);
  const rejectedOperations = prioritized
    .slice(MAX_REVIEWABLE_MEMORY_OPERATIONS)
    .map((operation) => summarizeRejectedOperation(operation, "operation-cap"));

  return {
    operations: retained,
    rejectedOperationCount: rejectedOperations.length,
    rejectedReasonCounts:
      rejectedOperations.length > 0
        ? {
            "operation-cap": rejectedOperations.length
          }
        : {},
    rejectedOperations
  };
}
