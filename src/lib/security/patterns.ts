import type { AuditClassification, AuditSeverity } from "../types.js";

export interface AuditRule {
  id: string;
  summary: string;
  regex: RegExp;
  severity: AuditSeverity;
}

export interface ClassifiedAuditMatch {
  classification: AuditClassification;
  severity: AuditSeverity;
  recommendation: string;
}

export const auditRules: AuditRule[] = [
  {
    id: "private-key-marker",
    summary: "Private key marker found",
    regex: /BEGIN (RSA|EC|OPENSSH|PGP) PRIVATE KEY/i,
    severity: "high"
  },
  {
    id: "secret-like-token",
    summary: "Secret-like token literal found",
    regex: /\b(?:Bearer\s+[A-Za-z0-9._-]{12,}|sk-[A-Za-z0-9-]{12,}|ghp_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{20,})\b/i,
    severity: "high"
  },
  {
    id: "absolute-user-path",
    summary: "User-specific absolute path found",
    regex: /\/(?:Users|private\/var)\//,
    severity: "medium"
  },
  {
    id: "local-state-path",
    summary: "Local state path reference found",
    regex: /(?:^|[/"'`\s])(?:\.claude\/|\.codex-auto-memory\/|\.codex-auto-memory\.local\.json)(?:$|[/"'`\s])/,
    severity: "info"
  },
  {
    id: "hardcoded-username",
    summary: "Hardcoded personal username found",
    regex: /\bjialinli\b/i,
    severity: "medium"
  }
];

const syntheticIndicators = [
  /\bexample\b/i,
  /\bbad:\b/i,
  /\bfixture\b/i,
  /\bsynthetic\b/i,
  /\bredacted\b/i,
  /\bnever do this\b/i
] as const;

export function classifyAuditMatch(
  filePath: string,
  line: string,
  rule: AuditRule
): ClassifiedAuditMatch {
  const lowerPath = filePath.toLowerCase();
  const isFixturePath =
    lowerPath.includes("test/") ||
    lowerPath.includes("prompt.ts") ||
    lowerPath.includes("review-guide") ||
    lowerPath.includes("claude-reference") ||
    lowerPath.includes("changelog");
  const looksSynthetic = syntheticIndicators.some((pattern) => pattern.test(line));

  if (rule.id === "local-state-path") {
    return {
      classification: "generic-local-path",
      severity: "info",
      recommendation: "Keep local state paths documented only when they are part of the intentional product contract."
    };
  }

  if ((rule.id === "secret-like-token" || rule.id === "private-key-marker") && (isFixturePath || looksSynthetic)) {
    return {
      classification: "synthetic-test-fixture",
      severity: "low",
      recommendation: "Prefer split or redacted fixture strings so external secret scanners do not flag the repository."
    };
  }

  if (rule.id === "absolute-user-path" || rule.id === "hardcoded-username") {
    return {
      classification: "manual-review-needed",
      severity: rule.severity,
      recommendation: "Replace user-specific paths or usernames with generic examples unless they are required for a documented local fixture."
    };
  }

  return {
    classification: "confirmed-risk",
    severity: rule.severity,
    recommendation: "Remove the sensitive literal or replace it with a redacted test-safe representation."
  };
}
