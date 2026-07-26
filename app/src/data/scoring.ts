export const getPath = (score: number, answers: Record<number, any>) => {
  // Rehab path trigger: Q7 (id: 7) value is 1 (Active judgments/liens)
  if (answers[7] === 1) return "rehab";
  
  if (score <= 16) return "urgent";
  if (score <= 23) return "growth";
  return "strong";
};

export const getCategoryScores = (answers: Record<number, number>, questions: any[]) => {
  const scores: Record<string, number> = {};
  questions.forEach((q) => {
    if (!scores[q.category]) scores[q.category] = 0;
    scores[q.category] += answers[q.id] || 0;
  });
  return scores;
};

