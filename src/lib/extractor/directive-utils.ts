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
  "issue",
  "browse"
]);

const genericHostTokens = new Set(["www", "com", "org", "net", "io", "dev", "app"]);

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
      .map((segment) => segment.trim())
      .filter(Boolean)
      .map((segment) => slugify(segment))
      .filter(Boolean);
    const tailToken = [...pathTokens].reverse().find(Boolean);
    if (category === "issue-tracker") {
      const ticketToken =
        [...pathTokens].reverse().find((token) => /^[a-z]+-\d+$/iu.test(token) || /^\d+$/u.test(token)) ??
        null;
      const nonGenericPathTokens = pathTokens.filter((token) => {
        if (genericReferenceTokens.has(token)) {
          return false;
        }

        return !/^[a-z]+-\d+$/iu.test(token) && !/^\d+$/u.test(token);
      });
      const hostTokens = parsed.hostname
        .split(".")
        .map((segment) => slugify(segment))
        .filter(Boolean);
      const hostContextToken =
        hostTokens.find((token) => !genericHostTokens.has(token)) ?? slugify(parsed.hostname);
      const contextToken = nonGenericPathTokens.slice(-2).join("-") || ticketToken;

      return [hostContextToken, contextToken].filter(Boolean).join("-") || category;
    }

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

export function inferReferenceCategory(text: string): string {
  const normalized = text.toLowerCase();

  return /\bdashboard\b|仪表盘/u.test(normalized)
    ? "dashboard"
    : /\brunbook\b|操作手册|run book/u.test(normalized)
      ? "runbook"
      : /\bdoc(?:s|umentation)?\b|文档/u.test(normalized)
        ? "docs"
        : /\b(?:linear|jira|issue tracker|issues?)\b|缺陷追踪|问题追踪/u.test(normalized)
          ? "issue-tracker"
          : "pointer";
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
  if (category === "issue-tracker" && url) {
    return resourceTokenFromUrl(url, category);
  }

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
    if (
      normalized &&
      normalized !== "memory-entry" &&
      !genericReferenceTokens.has(normalized)
    ) {
      return normalized;
    }
  }

  if (url) {
    return resourceTokenFromUrl(url, category);
  }

  if (category === "issue-tracker") {
    const trackerMatch = normalizedText.match(/\b(linear|jira|github issues?)\b/iu)?.[1];
    if (trackerMatch) {
      const normalized = slugify(trackerMatch);
      if (normalized && !genericReferenceTokens.has(normalized)) {
        return normalized;
      }
    }
  }

  return category;
}
