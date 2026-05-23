import {
  isUidInCanaryPercent,
  parseDualWriteStatus,
  parseShadowUidList,
  DualRunManager,
  resetDualRunManagerForTests,
} from "./DualRunManager";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

resetDualRunManagerForTests();

assert(parseDualWriteStatus("full") === "FULL", "parse FULL");
assert(parseDualWriteStatus("invalid") === "OFF", "parse invalid -> OFF");

assert(
  parseShadowUidList("a,b, c").join(",") === "a,b,c",
  "shadow comma"
);

const mgrOff = new DualRunManager({ localStatusOverride: "OFF" });
assert(
  !mgrOff.shouldExecuteSupabaseWrite("anyUid"),
  "OFF blocks"
);

const mgrFull = new DualRunManager({ localStatusOverride: "FULL" });
assert(mgrFull.shouldExecuteSupabaseWrite("anyUid"), "FULL allows");

const mgrShadow = new DualRunManager({ localStatusOverride: "SHADOW" });
assert(
  mgrShadow.shouldExecuteSupabaseWrite("testUid123"),
  "SHADOW ingest all users"
);
assert(
  mgrShadow.shouldExecuteSupabaseWrite("otherUid"),
  "SHADOW ingest all users (not read whitelist)"
);

const mgrCanary = new DualRunManager({ localStatusOverride: "CANARY" });
assert(
  mgrCanary.shouldExecuteSupabaseWrite("anyUid"),
  "CANARY ingest all users"
);

console.log("[dualRunManager.test] all passed");
