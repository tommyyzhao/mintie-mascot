import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTrials } from '../web/playtest.js';
import { CATALOG, EXCLUDED } from '../web/perform/emoji.js';

test('playtest trials are reproducible, unique and use distinct eligible families', () => {
  const trials = makeTrials('test-seed');
  assert.deepEqual(trials, makeTrials('test-seed'));
  assert.notDeepEqual(trials, makeTrials('another-seed'));
  assert.equal(trials.length, 20);
  assert.equal(new Set(trials.map(t => t.emoji)).size, 20);
  for (const trial of trials) {
    assert.equal(trial.choices.length, 4);
    assert.ok(trial.choices.includes(trial.emoji));
    assert.equal(new Set(trial.choices.map(e => CATALOG[e].family)).size, 4);
    assert.ok(trial.choices.every(e => !EXCLUDED.includes(e)));
    assert.equal(trial.family, CATALOG[trial.emoji].family);
  }
  assert.ok(trials.every(t => !EXCLUDED.includes(t.emoji)));
});
