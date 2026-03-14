import { DEFAULT_MEMORY_TOPICS } from "../constants.js";
import type { MemoryOperation } from "../types.js";
import { slugify, trimText } from "../util/text.js";

const allowedTopics = new Set<string>(DEFAULT_MEMORY_TOPICS);

const sensitivePatterns = [
  /-----BEGIN (RSA|EC|OPENSSH|PGP) PRIVATE KEY-----/i,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|passwd|cookie|session[_-]?id)\b\s*[:=]/i,
  /\bBearer\s+[A-Za-z0-9._-]{10,}\b/i,
  /\bsk-[A-Za-z0-9]{16,}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bAIza[0-9A-Za-z_-]{20,}\b/,
  /\b[A-Za-z0-9+/]{32,}={0,2}\b/
] as const;

const volatilePatterns = [
  /\b(todo|next step|later|for now|temporary|tmp|wip|work in progress)\b/i,
  /\bI will\b/i,
  /\bcurrently\b/i
] as const;

export function containsSensitiveContent(input: string): boolean {
  return sensitivePatterns.some((pattern) => pattern.test(input));
}

function looksVolatile(input: string): boolean {
  return volatilePatterns.some((pattern) => pattern.test(input));
}

export function sanitizeOperation(operation: MemoryOperation): MemoryOperation | null {
  const haystack = [
    operation.id,
    operation.topic,
    operation.summary ?? "",
    ...(operation.details ?? []),
    operation.reason ?? ""
  ].join("\n");

  if (containsSensitiveContent(haystack)) {
    return null;
  }

  if (operation.action === "upsert" && !operation.summary) {
    return null;
  }

  const topic = allowedTopics.has(operation.topic) ? operation.topic : "workflow";
  const summary = operation.summary ? trimText(operation.summary.trim(), 220) : undefined;
  const details = operation.details
    ?.map((detail) => trimText(detail.trim(), 240))
    .filter((detail) => detail.length > 0 && !containsSensitiveContent(detail));

  if (summary && looksVolatile(summary) && topic !== "debugging") {
    return null;
  }

  if (operation.action === "upsert" && (!details || details.length === 0) && summary) {
    return {
      ...operation,
      topic,
      id: slugify(operation.id || summary),
      summary,
      details: [summary]
    };
  }

  return {
    ...operation,
    topic,
    id: slugify(operation.id),
    summary,
    details
  };
}

export function filterMemoryOperations(operations: MemoryOperation[]): MemoryOperation[] {
  const deduped = new Map<string, MemoryOperation>();

  for (const operation of operations) {
    const sanitized = sanitizeOperation(operation);
    if (!sanitized) {
      continue;
    }

    const key = [
      sanitized.action,
      sanitized.scope,
      sanitized.topic,
      sanitized.id
    ].join(":");
    deduped.set(key, sanitized);
  }

  return [...deduped.values()].slice(0, 12);
}

