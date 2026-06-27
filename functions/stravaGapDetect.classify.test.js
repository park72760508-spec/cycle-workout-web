'use strict';

const { classifyStravaListActivity } = require('./stravaGapDetect');

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assert failed');
}

const runAct = { id: 1, type: 'Run', sport_type: 'Run' };
const virtualRun = { id: 2, type: 'VirtualRun' };
const ride = { id: 3, type: 'Ride' };
const trailRun = { id: 4, sport_type: 'TrailRun' };
const walk = { id: 5, type: 'Walk' };

assert(classifyStravaListActivity(runAct).kind === 'running', 'Run → running');
assert(classifyStravaListActivity(virtualRun).kind === 'running', 'VirtualRun → running');
assert(classifyStravaListActivity(trailRun).kind === 'running', 'TrailRun → running');
assert(classifyStravaListActivity(ride).kind === 'cycling', 'Ride → cycling');
assert(classifyStravaListActivity(walk) === null, 'Walk excluded');

console.log('stravaGapDetect.classify.test.js — all passed');
