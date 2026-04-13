import path from "node:path";
import type { InstructionMemoryFile, InstructionMemoryLayer, InstructionProposalTarget } from "../types.js";
import { fileExists } from "../util/fs.js";

const instructionCandidates: Array<Pick<InstructionMemoryFile, "kind"> & { relativePath: string }> = [
  { kind: "agents-root", relativePath: "AGENTS.md" },
  { kind: "claude-project", relativePath: "CLAUDE.md" },
  { kind: "claude-hidden", relativePath: path.join(".claude", "CLAUDE.md") },
  { kind: "gemini-project", relativePath: "GEMINI.md" },
  { kind: "gemini-hidden", relativePath: path.join(".gemini", "GEMINI.md") }
];

export async function discoverInstructionLayer(
  projectRoot: string
): Promise<InstructionMemoryLayer> {
  const detectedFiles: InstructionMemoryFile[] = [];

  for (const candidate of instructionCandidates) {
    const candidatePath = path.join(projectRoot, candidate.relativePath);
    if (!(await fileExists(candidatePath))) {
      continue;
    }

    detectedFiles.push({
      kind: candidate.kind,
      path: candidatePath
    });
  }

  return { detectedFiles };
}

export async function discoverInstructionFiles(projectRoot: string): Promise<string[]> {
  return (await discoverInstructionLayer(projectRoot)).detectedFiles.map((file) => file.path);
}

export async function rankInstructionProposalTargets(
  projectRoot: string
): Promise<InstructionProposalTarget[]> {
  const rankedTargets: InstructionProposalTarget[] = [];

  for (const candidate of instructionCandidates) {
    const candidatePath = path.join(projectRoot, candidate.relativePath);
    rankedTargets.push({
      path: candidatePath,
      kind: candidate.kind,
      exists: await fileExists(candidatePath)
    });
  }

  return rankedTargets;
}
