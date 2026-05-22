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

const mgrShadow = new DualRunManager({
  localStatusOverride: "SHADOW",
  extraShadowUids: ["testUid123"],
});
assert(
  mgrShadow.shouldExecuteSupabaseWrite("testUid123"),
  "SHADOW whitelist hit"
);
assert(
  !mgrShadow.shouldExecuteSupabaseWrite("otherUid"),
  "SHADOW whitelist miss"
);

const canaryUid = "Ys8GQZYyf3ZoEunSVGKnWNbtSkv2";
const bucket = isUidInCanaryPercent(canaryUid, 10);
const mgrCanary = new DualRunManager({ localStatusOverride: "CANARY" });
const decision = mgrCanary.evaluate(canaryUid);
assert(
  decision.executeSupabaseWrite === bucket,
  "CANARY matches hash"
);

console.log("[dualRunManager.test] all passed");
