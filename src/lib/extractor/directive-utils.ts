import { slugify } from "../util/text.js";

const genericReferenceTokens = new Set([
  "runbook",
  "dashboard",
  "docs",
  "doc",
  "documentation",
  "pointer",
  "issue-tracker",
  "issues",
  "issue"
]);

function trimReferencePrefix(value: string): string {
  return value
    .trim()
    .replace(
      /^(?:(?:actually|maybe|perhaps|probably)\s+)*(?:use|open|check|see|read|follow|visit)?\s*(?:the|our|this|that|current|latest)?\s*/iu,
      ""
    )
    .trim();
}

function resourceTokenFromUrl(url: string, category: string): string | null {
  try {
    const parsed = new URL(url);
    const pathTokens = parsed.pathname
      .split("/")
      .map((segment) => slugify(segment))
      .filter(Boolean);
    const tailToken = [...pathTokens].reverse().find(Boolean);
    if (tailToken && !genericReferenceTokens.has(tailToken)) {
      return tailToken;
    }

    if (tailToken) {
      return tailToken;
    }
  } catch {
    // Ignore invalid URL parsing and fall through to text-derived heuristics.
  }

  return category;
}

export function splitDirectiveClauses(text: string): string[] {
  return text
    .split(/\s*(?:,|;|，|；|\bbut\b|\bhowever\b|但是|但|不过)\s*/iu)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

export function extractReferenceResourceKey(
  text: string,
  category: string,
  url?: string | null
): string | null {
  const normalizedText = text.toLowerCase();
  const nounPattern =
    category === "runbook"
      ? /([a-z0-9][a-z0-9 -]{0,80})\s+runbook\b/iu
      : category === "dashboard"
        ? /([a-z0-9][a-z0-9 -]{0,80})\s+dashboard\b/iu
        : category === "docs"
          ? /([a-z0-9][a-z0-9 -]{0,80})\s+docs?\b/iu
          : category === "issue-tracker"
            ? /([a-z0-9][a-z0-9 -]{0,80})\s+(?:issue tracker|issues?)\b/iu
            : null;
  const nounMatch = nounPattern?.exec(normalizedText)?.[1];
  if (nounMatch) {
    const normalized = slugify(trimReferencePrefix(nounMatch));
    if (normalized && !genericReferenceTokens.has(normalized)) {
      return normalized;
    }
  }

  if (url) {
    return resourceTokenFromUrl(url, category);
  }

  return category;
}
