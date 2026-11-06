// Lógica compartida del etiquetado de fotos por el personal de campo.

export type Consensus = "correct" | "incorrect" | "conflict" | "pending";

export type TrainingVote = { isCorrectFoot: boolean };

export function computeConsensus(votes: TrainingVote[]) {
  const correctVotes = votes.filter((v) => v.isCorrectFoot === true).length;
  const incorrectVotes = votes.filter((v) => v.isCorrectFoot === false).length;
  const totalVoters = votes.length;

  let consensus: Consensus = "pending";
  if (correctVotes > 0 && incorrectVotes > 0) consensus = "conflict";
  else if (correctVotes > 0) consensus = "correct";
  else if (incorrectVotes > 0) consensus = "incorrect";

  return { consensus, totalVoters, correctVotes, incorrectVotes };
}
