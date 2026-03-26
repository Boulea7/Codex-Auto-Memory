import path from "node:path";
import {
  buildCodexAgentsManagedBlock,
  CODEX_AGENTS_GUIDANCE_VERSION,
  parseCodexAgentsGuidanceContents
} from "./codex-stack.js";
import { fileExists, readTextFile, writeTextFileAtomic } from "../util/fs.js";

export type CodexAgentsGuidanceApplyAction = "created" | "updated" | "unchanged" | "blocked";

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

export async function applyCodexAgentsGuidance(
  projectRoot: string
): Promise<CodexAgentsGuidanceApplyResult> {
  const targetPath = path.join(projectRoot, "AGENTS.md");
  const notes = buildNotes();
  const exists = await fileExists(targetPath);

  if (!exists) {
    await writeTextFileAtomic(targetPath, `${buildCodexAgentsManagedBlock()}\n`);
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

  const currentContents = await readTextFile(targetPath);
  const parsed = parseCodexAgentsGuidanceContents(currentContents);
  const managedBlock = buildCodexAgentsManagedBlock(parsed.lineEnding);

  if (parsed.unsafeManagedBlock) {
    return {
      host: "codex",
      projectRoot,
      targetPath,
      action: "blocked",
      managedBlockVersion: CODEX_AGENTS_GUIDANCE_VERSION,
      createdFile: false,
      blockedReason: parsed.unsafeReason,
      notes
    };
  }

  if (!parsed.managedBlock) {
    await writeTextFileAtomic(
      targetPath,
      appendManagedBlock(currentContents, managedBlock, parsed.lineEnding)
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

  const currentBlock = parsed.managedBlock.contents;
  if (
    normalizeManagedBlockForComparison(currentBlock) ===
    normalizeManagedBlockForComparison(managedBlock)
  ) {
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

  await writeTextFileAtomic(
    targetPath,
    replaceManagedBlock(currentContents, parsed.managedBlock, managedBlock)
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
