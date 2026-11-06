import { describe, expect, it } from "vitest";
import { computeConsensus } from "./trainingLabels";

const yes = { isCorrectFoot: true };
const no = { isCorrectFoot: false };

describe("computeConsensus", () => {
  it("sin votos queda pendiente", () => {
    expect(computeConsensus([])).toEqual({ consensus: "pending", totalVoters: 0, correctVotes: 0, incorrectVotes: 0 });
  });

  it("solo votos a favor → correct", () => {
    expect(computeConsensus([yes, yes]).consensus).toBe("correct");
  });

  it("solo votos en contra → incorrect", () => {
    expect(computeConsensus([no]).consensus).toBe("incorrect");
  });

  it("votos mezclados → conflict, aunque haya mayoría", () => {
    expect(computeConsensus([yes, yes, no])).toEqual({
      consensus: "conflict",
      totalVoters: 3,
      correctVotes: 2,
      incorrectVotes: 1,
    });
    expect(computeConsensus([yes, no]).consensus).toBe("conflict");
  });
});
