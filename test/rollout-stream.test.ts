import { constants as bufferConstants } from "node:buffer";
import { createReadStream } from "node:fs";
import type { ReadStream } from "node:fs";
import { Readable } from "node:stream";
import { expect, it, vi } from "vitest";
import { readRolloutMeta } from "../src/lib/domain/rollout.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, createReadStream: vi.fn(actual.createReadStream) };
});

it.skipIf(bufferConstants.MAX_STRING_LENGTH > 512 * 1024 * 1024)(
  "reads metadata after a representable line without combining it with subsequent lines",
  async () => {
    const ignored = JSON.stringify({ type: "ignored", payload: {} });
    const lineLength = bufferConstants.MAX_STRING_LENGTH - 32;
    const line = ignored + " ".repeat(lineLength - ignored.length);
    const metadata = JSON.stringify({
      type: "session_meta", payload: {
        id: "near-limit-session", timestamp: "2026-03-14T00:00:00.000Z", cwd: process.cwd()
      }
    });
    // Control the pending-line boundary without repeatedly copying a huge file.
    const input = Readable.from([line, "\n" + metadata + "\n"]);
    vi.mocked(createReadStream).mockReturnValueOnce(input as ReadStream);

    const meta = await readRolloutMeta("synthetic-rollout.jsonl");
    expect(meta?.sessionId).toBe("near-limit-session");
    expect(input.destroyed).toBe(true);
  }
);
