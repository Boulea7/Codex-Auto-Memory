import path from "node:path";
import type {
  InstructionMemoryFile,
  InstructionMemoryLayer,
  InstructionProposalTarget,
  InstructionTargetHost
} from "../types.js";
import { fileExists, readTextFile } from "../util/fs.js";

const instructionCandidates: Array<Pick<InstructionMemoryFile, "kind"> & { relativePath: string }> = [
  { kind: "agents-root", relativePath: "AGENTS.md" },
  { kind: "claude-project", relativePath: "CLAUDE.md" },
  { kind: "claude-hidden", relativePath: path.join(".claude", "CLAUDE.md") },
  { kind: "gemini-project", relativePath: "GEMINI.md" },
  { kind: "gemini-hidden", relativePath: path.join(".gemini", "GEMINI.md") }
];

const instructionCandidateOrderByHost: Record<
  InstructionTargetHost,
  Array<(typeof instructionCandidates)[number]["kind"]>
> = {
  codex: ["agents-root", "claude-project", "claude-hidden", "gemini-project", "gemini-hidden"],
  claude: ["claude-project", "claude-hidden", "agents-root", "gemini-project", "gemini-hidden"],
  gemini: ["gemini-project", "gemini-hidden", "agents-root", "claude-project", "claude-hidden"],
  shared: ["agents-root", "claude-project", "claude-hidden", "gemini-project", "gemini-hidden"]
};

function sortedInstructionCandidates(host: InstructionTargetHost): typeof instructionCandidates {
  const order = instructionCandidateOrderByHost[host];
  return [...instructionCandidates].sort(
    (left, right) => order.indexOf(left.kind) - order.indexOf(right.kind)
  );
}

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
  projectRoot: string,
  host: InstructionTargetHost = "shared"
): Promise<Array<InstructionProposalTarget & { currentContents?: string }>> {
  const rankedTargets: Array<InstructionProposalTarget & { currentContents?: string }> = [];

  for (const candidate of sortedInstructionCandidates(host)) {
    const candidatePath = path.join(projectRoot, candidate.relativePath);
    const exists = await fileExists(candidatePath);
    rankedTargets.push({
      path: candidatePath,
      kind: candidate.kind,
      exists,
      ...(exists ? { currentContents: await readTextFile(candidatePath) } : {})
    });
  }

  return rankedTargets;
}
