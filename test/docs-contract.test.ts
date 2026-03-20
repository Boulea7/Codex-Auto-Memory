import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function readDoc(relativePath: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), relativePath), "utf8");
}

describe("docs contract", () => {
  it("keeps the public reviewer command surface documented", async () => {
    const readme = await readDoc("README.md");
    const readmeEn = await readDoc("README.en.md");
    const releaseChecklist = await readDoc("docs/release-checklist.md");

    expect(readme).toContain("cam memory");
    expect(readme).toContain("cam session status");
    expect(readme).toContain("cam session refresh");
    expect(readmeEn).toContain("cam memory");
    expect(readmeEn).toContain("cam session status");
    expect(readmeEn).toContain("confidence");
    expect(releaseChecklist).toContain("cam audit");
    expect(releaseChecklist).toContain("cam session refresh --json");
    expect(releaseChecklist).toContain("cam session load --json");
    expect(releaseChecklist).toContain("cam session status --json");
  });

  it("keeps the continuity and migration contract wording aligned with the current product posture", async () => {
    const continuityDoc = await readDoc("docs/session-continuity.md");
    const nativeMigrationDoc = await readDoc("docs/native-migration.md");

    expect(continuityDoc).toContain("save` keeps merge semantics");
    expect(continuityDoc).toContain("refresh` ignores existing continuity");
    expect(continuityDoc).toContain("pending continuity recovery marker");
    expect(nativeMigrationDoc).toContain("companion-first");
    expect(nativeMigrationDoc).toContain("trusted primary path");
  });
});
