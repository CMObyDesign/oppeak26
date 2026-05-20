const PATH_THRESHOLDS = {
  free_tier: {
    CRITICAL_EXPOSURE: { min: 5, max: 12 },
    HIDDEN_LIABILITY: { min: 13, max: 18 },
    UNTAPPED_CAPACITY: { min: 19, max: 25 }
  },
  full_assessment: {
    CRITICAL_EXPOSURE: { min: 14, max: 28 },
    HIDDEN_LIABILITY: { min: 29, max: 41 },
    UNTAPPED_CAPACITY: { min: 42, max: 54 }
  }
};

function getOptionLabel(question, answerValue) {
  if (!question || !Array.isArray(question.options)) return '';
  const option = question.options.find((opt) => opt.id === answerValue || opt.value === answerValue);
  return option?.label ?? '';
}

export function getPathThresholds(tier) {
  return PATH_THRESHOLDS[tier] ?? null;
}

export function calculateScore(answers, questions) {
  const questionMap = new Map((questions || []).map((q) => [q.id, q]));
  const hasPaidAnswers = Object.keys(answers || {}).some((id) => {
    const numeric = Number(id.replace('Q', ''));
    return Number.isFinite(numeric) && numeric >= 6;
  });

  const tier = hasPaidAnswers ? 'full' : 'free';
  const thresholdTier = hasPaidAnswers ? 'full_assessment' : 'free_tier';

  let total = 0;
  let rehabTriggered = false;
  const categoryScores = {};

  for (const [questionId, answerValue] of Object.entries(answers || {})) {
    if (questionId === 'Q11' && answerValue === 'Q11_D') {
      rehabTriggered = true;
    }

    const question = questionMap.get(questionId);
    if (!question || question.scoring_impact === false) continue;

    const option = Array.isArray(question.options)
      ? question.options.find((opt) => opt.id === answerValue || opt.value === answerValue)
      : null;

    if (!option) continue;
    const points = Number(option.points ?? 0);
    total += points;

    const category = question.category || 'UNCATEGORIZED';
    categoryScores[category] = (categoryScores[category] || 0) + points;
  }

  const contextData = {
    Q9: getOptionLabel(questionMap.get('Q9'), answers?.Q9),
    Q13: getOptionLabel(questionMap.get('Q13'), answers?.Q13),
    Q14: typeof answers?.Q14 === 'string' ? answers.Q14 : ''
  };

  let path = 'CRITICAL_EXPOSURE';
  if (rehabTriggered) {
    path = 'REHAB_REQUIRED';
  } else {
    const thresholds = getPathThresholds(thresholdTier);
    if (thresholds) {
      for (const [pathName, range] of Object.entries(thresholds)) {
        if (total >= range.min && total <= range.max) {
          path = pathName;
          break;
        }
      }
    }
  }

  return {
    total,
    categoryScores,
    path,
    rehabTriggered,
    tier,
    contextData
  };
}
