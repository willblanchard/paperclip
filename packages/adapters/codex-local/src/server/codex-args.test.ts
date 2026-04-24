import { describe, expect, it } from "vitest";
import { buildCodexExecArgs } from "./codex-args.js";

describe("buildCodexExecArgs", () => {
  it("never applies fast mode even when requested", () => {
    for (const model of ["gpt-5.5", "gpt-5.4", "gpt-5.3-codex"]) {
      const result = buildCodexExecArgs({ model, fastMode: true });
      expect(result.fastModeRequested).toBe(true);
      expect(result.fastModeApplied).toBe(false);
      expect(result.fastModeIgnoredReason).toBeTruthy();
      expect(result.args).not.toContain("features.fast_mode=true");
    }
  });
});
