import type { AuditFinding, AuditReport } from "../types.js";
import { runAuditScan } from "../security/audit.js";

interface AuditCommandOptions {
  cwd?: string;
  json?: boolean;
  history?: boolean;
  noHistory?: boolean;
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
  const includeHistory = options.noHistory ? false : true;
  const report = await runAuditScan({
    cwd: options.cwd ?? process.cwd(),
    includeHistory: options.history ? true : includeHistory
  });

  if (options.json) {
    return JSON.stringify(report, null, 2);
  }

  const lines = [
    "Codex Auto Memory Audit",
    `Generated at: ${report.generatedAt}`,
    `Repository: ${report.cwd}`,
    `History scan: ${options.noHistory ? "disabled" : "enabled"}`,
    "",
    ...formatSummary(report)
  ];

  if (report.findings.length === 0) {
    lines.push("", "No findings detected.");
    return lines.join("\n");
  }

  lines.push("", "Findings:");
  for (const finding of report.findings) {
    lines.push(...formatFinding(finding));
  }

  return lines.join("\n");
}
