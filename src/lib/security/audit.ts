import fs from "node:fs/promises";
import path from "node:path";
import type {
  AuditClassification,
  AuditFinding,
  AuditReport,
  AuditSeverity,
  AuditSourceType
} from "../types.js";
import { runCommandCapture } from "../util/process.js";
import { trimText } from "../util/text.js";
import { buildAuditRules, classifyAuditMatch, type AuditRule } from "./patterns.js";

const auditRules = buildAuditRules();

interface AuditOptions {
  cwd: string;
  includeHistory: boolean;
}

const severityOrder: AuditSeverity[] = ["high", "medium", "low", "info"];
const classificationOrder: AuditClassification[] = [
  "confirmed-risk",
  "manual-review-needed",
  "synthetic-test-fixture",
  "generic-local-path"
];
const historyRevisionBatchSize = 200;

function createEmptySeveritySummary(): Record<AuditSeverity, number> {
  return {
    high: 0,
    medium: 0,
    low: 0,
    info: 0
  };
}

function createEmptyClassificationSummary(): Record<AuditClassification, number> {
  return {
    "confirmed-risk": 0,
    "manual-review-needed": 0,
    "synthetic-test-fixture": 0,
    "generic-local-path": 0
  };
}

function isProbablyText(contents: string): boolean {
  return !contents.includes("\u0000");
}

function normalizeSnippet(line: string): string {
  return trimText(line.trim(), 180);
}

function makeFinding(
  filePath: string,
  lineNumber: number,
  line: string,
  ruleId: string,
  summary: string,
  sourceType: AuditSourceType,
  classification: AuditClassification,
  severity: AuditSeverity,
  recommendation: string
): AuditFinding {
  return {
    ruleId,
    severity,
    classification,
    sourceType,
    location: `${filePath}:${lineNumber}`,
    summary,
    snippet: normalizeSnippet(line),
    recommendation
  };
}

function scanText(
  filePath: string,
  contents: string,
  sourceType: AuditSourceType
): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const lines = contents.split("\n");
  for (const [index, line] of lines.entries()) {
    for (const rule of auditRules) {
      if (!rule.regex.test(line)) {
        continue;
      }
      const classified = classifyAuditMatch(filePath, line, rule);
      findings.push(
        makeFinding(
          filePath,
          index + 1,
          line,
          rule.id,
          rule.summary,
          sourceType,
          classified.classification,
          classified.severity,
          classified.recommendation
        )
      );
    }
  }
  return findings;
}

async function listTrackedFiles(cwd: string): Promise<string[]> {
  const result = runCommandCapture("git", ["ls-files"], cwd);
  if (result.exitCode !== 0) {
    return [];
  }
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

async function listCommits(cwd: string): Promise<string[]> {
  const result = runCommandCapture("git", ["rev-list", "--all"], cwd);
  if (result.exitCode !== 0) {
    return [];
  }
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

async function listFilesAtRevision(cwd: string, revision: string): Promise<string[]> {
  const result = runCommandCapture("git", ["ls-tree", "-r", "--name-only", revision], cwd);
  if (result.exitCode !== 0) {
    return [];
  }
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

async function scanWorkingTree(cwd: string): Promise<AuditFinding[]> {
  const trackedFiles = await listTrackedFiles(cwd);
  const findings: AuditFinding[] = [];
  for (const relativePath of trackedFiles) {
    try {
      const contents = await fs.readFile(path.join(cwd, relativePath), "utf8");
      if (!isProbablyText(contents)) {
        continue;
      }
      findings.push(...scanText(relativePath, contents, "working-tree"));
    } catch {
      continue;
    }
  }
  return findings;
}

async function scanHistory(cwd: string): Promise<AuditFinding[]> {
  const commits = await listCommits(cwd);
  if (commits.length === 0) {
    return [];
  }

  const grepFindings = scanHistoryWithGitGrep(cwd, commits);
  if (grepFindings) {
    return grepFindings;
  }

  return scanHistoryLegacy(cwd);
}

function scanHistoryWithGitGrep(cwd: string, commits: string[]): AuditFinding[] | null {
  const findings: AuditFinding[] = [];

  for (const revisions of chunkArray(commits, historyRevisionBatchSize)) {
    for (const rule of auditRules) {
      const result = runCommandCapture("git", buildHistoryGrepArgs(rule, revisions), cwd);
      if (result.exitCode === 1) {
        continue;
      }
      if (result.exitCode !== 0) {
        return null;
      }

      for (const rawLine of result.stdout.split("\n")) {
        const line = rawLine.trimEnd();
        if (!line) {
          continue;
        }

        const parsed = parseHistoryGrepLine(line, rule);
        if (parsed) {
          findings.push(parsed);
        }
      }
    }
  }

  return findings;
}

async function scanHistoryLegacy(cwd: string): Promise<AuditFinding[]> {
  const commits = await listCommits(cwd);
  const findings: AuditFinding[] = [];
  for (const revision of commits) {
    const files = await listFilesAtRevision(cwd, revision);
    for (const relativePath of files) {
      const result = runCommandCapture("git", ["show", `${revision}:${relativePath}`], cwd);
      if (result.exitCode !== 0 || !isProbablyText(result.stdout)) {
        continue;
      }
      const revisionFindings = scanText(
        `${revision}:${relativePath}`,
        result.stdout,
        "git-history"
      );
      findings.push(...revisionFindings);
    }
  }
  return findings;
}

function buildHistoryGrepArgs(rule: AuditRule, revisions: string[]): string[] {
  return [
    "grep",
    "-nI",
    "-z",
    "-P",
    ...(rule.regex.flags.includes("i") ? ["-i"] : []),
    rule.regex.source,
    ...revisions,
    "--"
  ];
}

function parseHistoryGrepLine(line: string, rule: AuditRule): AuditFinding | null {
  const [filePath, lineNumberRaw, ...textParts] = line.split("\u0000");
  if (!filePath || !lineNumberRaw || textParts.length === 0) {
    return null;
  }

  const lineNumber = Number.parseInt(lineNumberRaw, 10);
  if (!Number.isFinite(lineNumber)) {
    return null;
  }

  const lineText = textParts.join("\u0000");
  if (!filePath.includes(":")) {
    return null;
  }

  const classified = classifyAuditMatch(filePath, lineText, rule);
  return makeFinding(
    filePath,
    lineNumber,
    lineText,
    rule.id,
    rule.summary,
    "git-history",
    classified.classification,
    classified.severity,
    classified.recommendation
  );
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function dedupeFindings(findings: AuditFinding[]): AuditFinding[] {
  const byKey = new Map<string, AuditFinding>();
  for (const finding of findings) {
    if (finding.sourceType === "git-history" && finding.classification === "generic-local-path") {
      continue;
    }

    const normalizedLocation =
      finding.sourceType === "git-history" &&
      (finding.classification === "synthetic-test-fixture" || finding.classification === "manual-review-needed")
        ? finding.location.replace(/^[0-9a-f]+:/u, "")
        : finding.location;
    const key = [
      finding.ruleId,
      finding.classification,
      finding.sourceType,
      normalizedLocation,
      finding.snippet
    ].join("::");
    if (!byKey.has(key)) {
      byKey.set(key, {
        ...finding,
        location: normalizedLocation
      });
    }
  }
  return [...byKey.values()].sort((left, right) => {
    const severityDelta =
      severityOrder.indexOf(left.severity) - severityOrder.indexOf(right.severity);
    if (severityDelta !== 0) {
      return severityDelta;
    }
    const classificationDelta =
      classificationOrder.indexOf(left.classification) -
      classificationOrder.indexOf(right.classification);
    if (classificationDelta !== 0) {
      return classificationDelta;
    }
    return left.location.localeCompare(right.location);
  });
}

export async function runAuditScan(options: AuditOptions): Promise<AuditReport> {
  const findings = [
    ...(await scanWorkingTree(options.cwd)),
    ...(options.includeHistory ? await scanHistory(options.cwd) : [])
  ];
  const deduped = dedupeFindings(findings);

  const bySeverity = createEmptySeveritySummary();
  const byClassification = createEmptyClassificationSummary();
  for (const finding of deduped) {
    bySeverity[finding.severity] += 1;
    byClassification[finding.classification] += 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    cwd: options.cwd,
    findings: deduped,
    summary: {
      total: deduped.length,
      bySeverity,
      byClassification
    }
  };
}
