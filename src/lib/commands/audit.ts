import type { AuditFinding, AuditReport } from "../types.js";
import { runAuditScan } from "../security/audit.js";
import { sanitizePublicPath } from "../util/public-paths.js";

interface AuditCommandOptions {
  cwd?: string;
  json?: boolean;
  history?: boolean;
  noHistory?: boolean;
  showSensitiveSnippets?: boolean;
}

function resolveIncludeHistory(options: AuditCommandOptions): boolean {
  if (typeof options.history === "boolean") {
    return options.history;
  }

  if (options.noHistory === true) {
    return false;
  }

  return true;
}

function formatFinding(finding: AuditFinding): string[] {
  return [
    `- [${finding.severity}] ${finding.classification} ${finding.location}`,
    `  Rule: ${finding.ruleId}`,
    `  Summary: ${finding.summary}`,
    `  Snippet: ${finding.snippet}`,
    `  Recommendation: ${finding.recommendation}`
  ];
}

function formatSummary(report: AuditReport): string[] {
  return [
    "Summary:",
    `- total findings: ${report.summary.total}`,
    `- severity: high=${report.summary.bySeverity.high}, medium=${report.summary.bySeverity.medium}, low=${report.summary.bySeverity.low}, info=${report.summary.bySeverity.info}`,
    `- classification: confirmed-risk=${report.summary.byClassification["confirmed-risk"]}, manual-review-needed=${report.summary.byClassification["manual-review-needed"]}, synthetic-test-fixture=${report.summary.byClassification["synthetic-test-fixture"]}, generic-local-path=${report.summary.byClassification["generic-local-path"]}`
  ];
}

export async function runAudit(options: AuditCommandOptions = {}): Promise<string> {
  const targetCwd = options.cwd ?? process.cwd();
  const includeHistory = resolveIncludeHistory(options);
  const report = await runAuditScan({
    cwd: targetCwd,
    includeHistory,
    showSensitiveSnippets: options.showSensitiveSnippets
  });
  const publicCwd = sanitizePublicPath(report.cwd, {
    extraRoots: [{ label: "<cwd>", path: targetCwd }]
  }) ?? report.cwd;
  const publicReport: AuditReport = {
    ...report,
    cwd: publicCwd
  };

  if (options.json) {
    return JSON.stringify(publicReport, null, 2);
  }

  const lines = [
    "Codex Auto Memory Audit",
    `Generated at: ${publicReport.generatedAt}`,
    `Repository: ${publicReport.cwd}`,
    `History scan: ${includeHistory ? "enabled" : "disabled"}`,
    `Snippet policy: ${publicReport.snippetPolicy ?? "redacted"}`,
    "",
    ...formatSummary(publicReport)
  ];

  if (publicReport.findings.length === 0) {
    lines.push("", "No findings detected.");
    return lines.join("\n");
  }

  lines.push("", "Findings:");
  for (const finding of publicReport.findings) {
    lines.push(...formatFinding(finding));
  }

  return lines.join("\n");
}
