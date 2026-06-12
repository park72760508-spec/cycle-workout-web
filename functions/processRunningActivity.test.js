/**
 * RUN Strava activity_type 필터 — Walk 제외
 * 실행: node functions/processRunningActivity.test.js
 */
"use strict";

const { isRunningStravaActivityType } = require("./processRunningActivity");

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

assert(isRunningStravaActivityType("Run", null), "Run accepted");
assert(isRunningStravaActivityType("VirtualRun", null), "VirtualRun accepted");
assert(isRunningStravaActivityType("TrailRun", null), "TrailRun accepted");
assert(!isRunningStravaActivityType("Walk", null), "Walk rejected");
assert(!isRunningStravaActivityType("Hike", null), "Hike rejected");
assert(isRunningStravaActivityType(null, "Run"), "sport_type Run accepted");

console.log("processRunningActivity.test.js — all passed");
