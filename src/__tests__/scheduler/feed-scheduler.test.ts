import { describe, it, expect } from "vitest";

// extractMilestoneSummary has been removed — milestone summary is now
// generated via a dedicated LLM call (buildMilestoneSummaryPrompt).
// Feed-scheduler unit tests for the remaining pure functions can be added here.

describe("feed-scheduler", () => {
  it("placeholder — scheduler logic is integration-tested via runFeedCycle", () => {
    expect(true).toBe(true);
  });
});
