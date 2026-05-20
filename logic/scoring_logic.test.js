import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateScore } from './scoring_logic.js';

const questions = [
  ...Array.from({ length: 14 }, (_, i) => ({
    id: `Q${i + 1}`,
    category: i < 5 ? 'FOUNDATION' : 'READINESS',
    scoring_impact: ![9, 13, 14].includes(i + 1),
    options: [
      { id: `Q${i + 1}_A`, label: 'Low', points: 1 },
      { id: `Q${i + 1}_B`, label: 'Mid', points: 2 },
      { id: `Q${i + 1}_C`, label: 'High', points: 5 },
      { id: `Q${i + 1}_D`, label: 'Critical', points: 0 }
    ]
  }))
];

test('Free tier only — all low answers -> CRITICAL_EXPOSURE', () => {
  const answers = { Q1: 'Q1_A', Q2: 'Q2_A', Q3: 'Q3_A', Q4: 'Q4_A', Q5: 'Q5_A' };
  const result = calculateScore(answers, questions);
  assert.equal(result.tier, 'free');
  assert.equal(result.total, 5);
  assert.equal(result.path, 'CRITICAL_EXPOSURE');
});

test('Free tier only — all high answers -> UNTAPPED_CAPACITY', () => {
  const answers = { Q1: 'Q1_C', Q2: 'Q2_C', Q3: 'Q3_C', Q4: 'Q4_C', Q5: 'Q5_C' };
  const result = calculateScore(answers, questions);
  assert.equal(result.tier, 'free');
  assert.equal(result.total, 25);
  assert.equal(result.path, 'UNTAPPED_CAPACITY');
});

test('Full assessment — Q11_D selected -> REHAB_REQUIRED regardless of score', () => {
  const answers = {
    Q1: 'Q1_C', Q2: 'Q2_C', Q3: 'Q3_C', Q4: 'Q4_C', Q5: 'Q5_C',
    Q6: 'Q6_C', Q7: 'Q7_C', Q8: 'Q8_C', Q10: 'Q10_C', Q11: 'Q11_D', Q12: 'Q12_C'
  };
  const result = calculateScore(answers, questions);
  assert.equal(result.tier, 'full');
  assert.equal(result.rehabTriggered, true);
  assert.equal(result.path, 'REHAB_REQUIRED');
});

test('Full assessment — mixed answers landing in HIDDEN_LIABILITY range', () => {
  const answers = {
    Q1: 'Q1_B', Q2: 'Q2_B', Q3: 'Q3_C', Q4: 'Q4_C', Q5: 'Q5_A',
    Q6: 'Q6_B', Q7: 'Q7_C', Q8: 'Q8_B', Q10: 'Q10_B', Q11: 'Q11_A', Q12: 'Q12_C'
  };
  const result = calculateScore(answers, questions);
  assert.equal(result.tier, 'full');
  assert.equal(result.total, 32);
  assert.equal(result.path, 'HIDDEN_LIABILITY');
});

test('contextData is correctly extracted for Q9, Q13, Q14', () => {
  const answers = { Q1: 'Q1_A', Q2: 'Q2_A', Q3: 'Q3_A', Q4: 'Q4_A', Q5: 'Q5_A', Q9: 'Q9_B', Q13: 'Q13_C', Q14: 'Need better cash visibility in 90 days.' };
  const result = calculateScore(answers, questions);
  assert.deepEqual(result.contextData, {
    Q9: 'Mid',
    Q13: 'High',
    Q14: 'Need better cash visibility in 90 days.'
  });
});
