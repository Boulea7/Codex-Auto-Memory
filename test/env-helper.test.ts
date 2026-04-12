import { describe, expect, it } from "vitest";
import { restoreOptionalEnv } from "./helpers/env.js";

describe("restoreOptionalEnv", () => {
  it("deletes env vars that were originally unset", () => {
    process.env.CAM_TEST_OPTIONAL_ENV = "temp";

    restoreOptionalEnv("CAM_TEST_OPTIONAL_ENV", undefined);

    expect(process.env.CAM_TEST_OPTIONAL_ENV).toBeUndefined();
  });

  it("restores env vars that originally had a value", () => {
    process.env.CAM_TEST_OPTIONAL_ENV = "temp";

    restoreOptionalEnv("CAM_TEST_OPTIONAL_ENV", "original");

    expect(process.env.CAM_TEST_OPTIONAL_ENV).toBe("original");
    delete process.env.CAM_TEST_OPTIONAL_ENV;
  });
});
