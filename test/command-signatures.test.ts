import { describe, expect, it } from "vitest";
import { canonicalCommandSignature } from "../src/lib/extractor/command-signatures.js";

describe("canonicalCommandSignature", () => {
  it("normalizes wrapped verification commands to a stable signature", () => {
    expect(canonicalCommandSignature("pnpm exec vitest run test/session-command.test.ts")).toBe(
      "vitest:test"
    );
    expect(canonicalCommandSignature("uv run pytest tests/test_memory.py")).toBe("pytest:test");
    expect(canonicalCommandSignature("cargo nextest run")).toBe("cargo-nextest:test");
  });

  it("keeps package-manager-specific commands distinct", () => {
    expect(canonicalCommandSignature("pnpm test")).toBe("pnpm:test");
    expect(canonicalCommandSignature("npm test")).toBe("npm:test");
  });

  it("treats npm-family run aliases for built-in lifecycle scripts as the same signature", () => {
    expect(canonicalCommandSignature("pnpm run test")).toBe("pnpm:test");
    expect(canonicalCommandSignature("npm run lint")).toBe("npm:lint");
    expect(canonicalCommandSignature("bun run build")).toBe("bun:build");
    expect(canonicalCommandSignature("yarn run check")).toBe("yarn:check");
  });
});
