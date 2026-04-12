import path from "node:path";
import {
  buildCodexAgentsGuidance,
  buildCodexAgentsManagedBlock,
  CODEX_AGENTS_GUIDANCE_VERSION,
  parseCodexAgentsGuidanceContents
} from "./codex-stack.js";
import { fileExists, readTextFile, writeTextFileAtomic } from "../util/fs.js";

export type CodexAgentsGuidanceApplyAction = "created" | "updated" | "unchanged" | "blocked";
export type CodexAgentsGuidanceApplySafetyStatus = "safe" | "blocked";

export interface CodexAgentsGuidanceApplySafetyResult {
  host: "codex";
  projectRoot: string;
  targetPath: string;
  status: CodexAgentsGuidanceApplySafetyStatus;
  blockedReason?: string;
  recommendedAction: "create" | "append" | "replace" | "unchanged" | "blocked";
  notes: string[];
}

export interface CodexAgentsGuidanceApplyResult {
  host: "codex";
  projectRoot: string;
  targetPath: string;
  action: CodexAgentsGuidanceApplyAction;
  managedBlockVersion: string;
  createdFile: boolean;
  blockedReason?: string;
  notes: string[];
}

function appendManagedBlock(
  contents: string,
  managedBlock: string,
  lineEnding: "\n" | "\r\n" | "\r"
): string {
  if (contents.length === 0) {
    return `${managedBlock}${lineEnding}`;
  }

  if (contents.endsWith(`${lineEnding}${lineEnding}`)) {
    return `${contents}${managedBlock}${lineEnding}`;
  }

  if (contents.endsWith(lineEnding)) {
    return `${contents}${lineEnding}${managedBlock}${lineEnding}`;
  }

  return `${contents}${lineEnding}${lineEnding}${managedBlock}${lineEnding}`;
}

function replaceManagedBlock(
  contents: string,
  range: { startIndex: number; endIndex: number },
  managedBlock: string
): string {
  const trailingLineEnding = range.endIndex > range.startIndex
    ? contents.slice(range.startIndex, range.endIndex).match(/(\r\n|\n|\r)$/u)?.[1] ?? ""
    : "";
  return `${contents.slice(0, range.startIndex)}${managedBlock}${trailingLineEnding}${contents.slice(range.endIndex)}`;
}

function normalizeManagedBlockForComparison(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n$/u, "");
}

function buildNotes(): string[] {
  return [
    "This command only creates or updates the Codex Auto Memory managed block inside AGENTS.md.",
    "When updating an existing managed block, AGENTS.md content outside that block is preserved byte-for-byte.",
    "When appending a new managed block, the command adds only the minimum separator and trailing newline required.",
    "If the managed block markers are missing, duplicated, or malformed, the command fails closed instead of rewriting the file."
  ];
}

interface CodexAgentsGuidanceApplyInspection {
  targetPath: string;
  notes: string[];
  exists: boolean;
  currentContents: string | null;
  managedBlock: string;
  lineEnding: "\n" | "\r\n" | "\r";
  unsafeManagedBlock: boolean;
  unsafeReason?: string;
  hasManagedBlock: boolean;
  hasCurrentUnmanagedSnippet: boolean;
  alreadyCurrent: boolean;
  managedBlockRange: { startIndex: number; endIndex: number } | null;
}

async function inspectCodexAgentsGuidanceApply(
  projectRoot: string
): Promise<CodexAgentsGuidanceApplyInspection> {
  const targetPath = path.join(projectRoot, "AGENTS.md");
  const notes = buildNotes();
  const exists = await fileExists(targetPath);

  if (!exists) {
    return {
      targetPath,
      notes,
      exists,
      currentContents: null,
      managedBlock: buildCodexAgentsManagedBlock("\n", { cwd: projectRoot }),
      lineEnding: "\n",
      unsafeManagedBlock: false,
      hasManagedBlock: false,
      hasCurrentUnmanagedSnippet: false,
      alreadyCurrent: false,
      managedBlockRange: null
    };
  }

  const currentContents = await readTextFile(targetPath);
  const parsed = parseCodexAgentsGuidanceContents(currentContents);
  const managedBlock = buildCodexAgentsManagedBlock(parsed.lineEnding, {
    cwd: projectRoot
  });
  const guidanceSnippet = buildCodexAgentsGuidance({
    cwd: projectRoot
  }).snippet;
  const normalizedVisibleText = normalizeManagedBlockForComparison(parsed.visibleText);
  const normalizedManagedBlock = normalizeManagedBlockForComparison(managedBlock);
  const hasCurrentUnmanagedSnippet =
    parsed.managedBlock === null &&
    normalizedVisibleText.includes(normalizeManagedBlockForComparison(guidanceSnippet));
  const alreadyCurrent =
    parsed.managedBlock !== null &&
    normalizeManagedBlockForComparison(parsed.managedBlock.contents) ===
      normalizedManagedBlock ||
    hasCurrentUnmanagedSnippet;

  return {
    targetPath,
    notes,
    exists,
    currentContents,
    managedBlock,
    lineEnding: parsed.lineEnding,
    unsafeManagedBlock: parsed.unsafeManagedBlock,
    unsafeReason: parsed.unsafeReason,
    hasManagedBlock: parsed.managedBlock !== null,
    hasCurrentUnmanagedSnippet,
    alreadyCurrent,
    managedBlockRange: parsed.managedBlock
      ? {
          startIndex: parsed.managedBlock.startIndex,
          endIndex: parsed.managedBlock.endIndex
        }
      : null
  };
}

export async function inspectCodexAgentsGuidanceApplySafety(
  projectRoot: string
): Promise<CodexAgentsGuidanceApplySafetyResult> {
  const inspection = await inspectCodexAgentsGuidanceApply(projectRoot);

  if (inspection.unsafeManagedBlock) {
    return {
      host: "codex",
      projectRoot,
      targetPath: inspection.targetPath,
      status: "blocked",
      blockedReason: inspection.unsafeReason,
      recommendedAction: "blocked",
      notes: inspection.notes
    };
  }

  return {
    host: "codex",
    projectRoot,
    targetPath: inspection.targetPath,
    status: "safe",
    recommendedAction: !inspection.exists
      ? "create"
      : inspection.alreadyCurrent
        ? "unchanged"
        : !inspection.hasManagedBlock
        ? "append"
        : "replace",
    notes: inspection.notes
  };
}

export async function applyCodexAgentsGuidance(
  projectRoot: string
): Promise<CodexAgentsGuidanceApplyResult> {
  const inspection = await inspectCodexAgentsGuidanceApply(projectRoot);
  const { targetPath, notes } = inspection;

  if (!inspection.exists) {
    await writeTextFileAtomic(targetPath, `${inspection.managedBlock}\n`);
    return {
      host: "codex",
      projectRoot,
      targetPath,
      action: "created",
      managedBlockVersion: CODEX_AGENTS_GUIDANCE_VERSION,
      createdFile: true,
      notes
    };
  }

  if (inspection.unsafeManagedBlock) {
    return {
      host: "codex",
      projectRoot,
      targetPath,
      action: "blocked",
      managedBlockVersion: CODEX_AGENTS_GUIDANCE_VERSION,
      createdFile: false,
      blockedReason: inspection.unsafeReason,
      notes
    };
  }

  if (inspection.alreadyCurrent) {
    return {
      host: "codex",
      projectRoot,
      targetPath,
      action: "unchanged",
      managedBlockVersion: CODEX_AGENTS_GUIDANCE_VERSION,
      createdFile: false,
      notes
    };
  }

  if (!inspection.hasManagedBlock) {
    await writeTextFileAtomic(
      targetPath,
      appendManagedBlock(inspection.currentContents ?? "", inspection.managedBlock, inspection.lineEnding)
    );
    return {
      host: "codex",
      projectRoot,
      targetPath,
      action: "updated",
      managedBlockVersion: CODEX_AGENTS_GUIDANCE_VERSION,
      createdFile: false,
      notes
    };
  }

  await writeTextFileAtomic(
    targetPath,
    replaceManagedBlock(
      inspection.currentContents ?? "",
      inspection.managedBlockRange!,
      inspection.managedBlock
    )
  );
  return {
    host: "codex",
    projectRoot,
    targetPath,
    action: "updated",
    managedBlockVersion: CODEX_AGENTS_GUIDANCE_VERSION,
    createdFile: false,
    notes
  };
}
