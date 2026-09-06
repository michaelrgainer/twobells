// The browser-free tier: everything that is a function of its inputs. No Chrome,
// no chromectl, no network -- `node --test` and nothing else.
//
// What is worth having here is the arithmetic and the storage rules, because those
// are what a rewrite is most likely to get subtly wrong and least likely to look
// wrong. Anything that needs a real layout, a real pointer or a real transition
// belongs in test_browser.js instead.

// Set before any Date is constructed: two of these assert that a date and the
// clock time beside it agree about which day it is, which is only a test at all
// somewhere that is not UTC.
process.env.TZ = "America/Los_Angeles";

const test = require("node:test");
const assert = require("node:assert");
const { loadPage } = require("./stub_dom");

const IN_PACIFIC = new Date(2026, 8, 6, 21, 5).getTimezoneOffset() === 420;

function sit(overrides = {}) {
  return {
    at: new Date(2026, 8, 6, 9, 0).toISOString(),
    first: 30, sit: 20, sat: 20, elapsedMs: 1230000, outcome: "complete",
    ...overrides,
  };
}

// One log of n sits, an hour apart, newest first -- the order the page keeps them.
function log(n, at = new Date(2026, 8, 6, 9, 0)) {
  return Array.from({ length: n }, (_, i) =>
    sit({ at: new Date(at.getTime() - i * 3600000).toISOString() }));
}

test("minutesSat", async (t) => {
  const { seam } = loadPage();
  const { minutesSat } = seam.internals;

  await t.test("a completed sit is as long as it was sat", () => {
    assert.equal(minutesSat(sit({ sit: 20, sat: 12 })), 12);
  });

  await t.test("a record from before sat existed falls back to what was set", () => {
    const legacy = sit({ sit: 20 });
    delete legacy.sat;
    assert.equal(minutesSat(legacy), 20);
  });

  await t.test("an abandoned sit is as long as it actually ran", () => {
    assert.equal(minutesSat(sit({ outcome: "cancelled", elapsedMs: 7 * 60000 })), 7);
  });

  await t.test("and never negative", () => {
    assert.equal(minutesSat(sit({ outcome: "cancelled", elapsedMs: -5000 })), 0);
  });
});

test("the export", async (t) => {
  await t.test("leads with the header row", () => {
    const { seam } = loadPage();
    seam.internals.setHistory(log(3));
    assert.equal(seam.internals.toTSV().split("\n")[0],
                 "date\ttime\tsettle_sec\tset_min\tsat_min\toutcome");
  });

  await t.test("ends with the totals, after a blank line", () => {
    const { seam } = loadPage({ seed: {
      "two-bells:totals": JSON.stringify({ sits: 137, minutes: 2740 }) } });
    seam.internals.setHistory(log(3));
    const lines = seam.internals.toTSV().split("\n");
    assert.deepEqual(lines.slice(-3), ["", "total_sits\t137", "total_min\t2740"]);
  });

  await t.test("carries every row the browser holds, not the ones on screen", () => {
    const { seam } = loadPage();
    seam.seed(log(40));
    const before = seam.internals.toTSV();
    // Whatever the page is set to show, Copy is the whole log.
    assert.equal(before.split("\n").filter((l) => /^\d{4}-/.test(l)).length, 40);
  });

  await t.test("counts a shortened sit as what was sat, not what was set", () => {
    const { seam } = loadPage();
    seam.internals.setHistory([sit({ sit: 20, sat: 12 })]);
    const row = seam.internals.toTSV().split("\n")[1].split("\t");
    assert.equal(row[3], "20");   // set_min
    assert.equal(row[4], "12");   // sat_min
  });

  await t.test("dates in local time, agreeing with the clock beside them", (t) => {
    if (!IN_PACIFIC) return t.skip("needs a non-UTC zone to mean anything");
    const { seam } = loadPage();
    // 9pm Pacific is already tomorrow in UTC. The date column used to come off
    // toISOString() and the time column off getHours(), so the two disagreed.
    seam.internals.setHistory([sit({ at: new Date(2026, 8, 6, 21, 5).toISOString() })]);
    const [date, clock] = seam.internals.toTSV().split("\n")[1].split("\t");
    assert.equal(date, "2026-09-06");
    assert.equal(clock, "21:05");
  });
});

test("merging a log with the store's copy", async (t) => {
  await t.test("keeps what only one side has", () => {
    const { seam } = loadPage();
    const mine = log(3);
    const theirs = log(3, new Date(2026, 8, 5, 9, 0));
    seam.internals.setHistory(mine);
    seam.internals.mergeHistory(theirs);
    assert.equal(seam.internals.getHistory().length, 6);
  });

  await t.test("counts a sit both sides know about once", () => {
    const { seam } = loadPage();
    const shared = log(3);
    seam.internals.setHistory(shared);
    seam.internals.mergeHistory(shared.slice());
    assert.equal(seam.internals.getHistory().length, 3);
  });

  await t.test("leaves the result newest first", () => {
    const { seam } = loadPage();
    seam.internals.setHistory(log(3, new Date(2026, 8, 5, 9, 0)));
    seam.internals.mergeHistory(log(3));
    const ats = seam.internals.getHistory().map((r) => r.at);
    assert.deepEqual(ats, [...ats].sort().reverse());
  });

  await t.test("never returns more than the cap", () => {
    const { seam } = loadPage();
    const { KEEP } = seam.internals;
    seam.internals.setHistory(log(KEEP));
    seam.internals.mergeHistory(log(50, new Date(2026, 8, 1, 9, 0)));
    assert.equal(seam.internals.getHistory().length, KEEP);
  });
});

test("the running totals", async (t) => {
  await t.test("rise to meet a log they have not seen", () => {
    const { seam } = loadPage();
    seam.seed(log(8));
    assert.equal(seam.internals.readTotals().sits, 8);
    assert.equal(seam.internals.readTotals().minutes, 8 * 20);
  });

  await t.test("do not fall when the log gets shorter", () => {
    const { seam } = loadPage();
    seam.seed(log(8));
    seam.seed(log(1));
    assert.equal(seam.internals.readTotals().sits, 8);
    assert.equal(seam.internals.readTotals().minutes, 160);
  });

  await t.test("rise per number, not as a pair", () => {
    // Fewer sits but more minutes: a device syncing a short log of long sits.
    // Writing the incoming pair wholesale would pass any test where one side is
    // larger in both, and quietly lose the count here.
    const { seam } = loadPage({ seed: {
      "two-bells:totals": JSON.stringify({ sits: 500, minutes: 9000 }) } });
    seam.internals.raiseTotals(3, 12000);
    assert.deepEqual(seam.internals.readTotals(), { sits: 500, minutes: 12000 });
  });

  await t.test("inherit the count from the key that only knew how many", () => {
    const { seam } = loadPage({ seed: { "two-bells:seen": "42" } });
    assert.deepEqual(seam.internals.readTotals(), { sits: 42, minutes: 0 });
  });

  await t.test("survive nonsense in storage", () => {
    const { seam } = loadPage({ seed: { "two-bells:totals": "{not json" } });
    assert.deepEqual(seam.internals.readTotals(), { sits: 0, minutes: 0 });
  });
});

test("a device with no vibration is not offered it", async (t) => {
  await t.test("no such row in the tuning panel", () => {
    // The stub's navigator has no vibrate, which is every iPhone. A switch that
    // does nothing is worse than no switch.
    const { nodes } = loadPage();
    const labels = nodes["tune"].children
      .map((row) => (row.children[0] || {}).textContent);
    assert.ok(!labels.includes("And vibrate"), labels.join(", "));
  });

  await t.test("and the custom bell does not claim it can", () => {
    const { seam } = loadPage({ seed: {
      "two-bells:custom": JSON.stringify({ vibrate: true }),
      "two-bells:voice": "custom" } });
    // Stored from a phone that could, opened on a laptop that cannot.
    assert.equal(seam.getState().voice, "custom");
    assert.equal(global.navigator.vibrate, undefined);
  });
});

test("when Contact appears", async (t) => {
  const { seam } = loadPage();
  const { contactFrom } = seam.internals;
  const at = (iso, fn) => {
    const real = Date.now;
    Date.now = () => Date.parse(iso);
    try { return fn(); } finally { Date.now = real; }
  };

  await t.test("five sits during the beta", () => {
    assert.equal(at("2026-09-10T12:00:00", contactFrom), 5);
  });

  await t.test("ten once it is over", () => {
    assert.equal(at("2026-09-21T12:00:00", contactFrom), 10);
  });
});

test("what gets written to storage", async (t) => {
  await t.test("the whole log, when it fits", () => {
    const { seam, storage } = loadPage();
    seam.seed(log(40));
    assert.equal(JSON.parse(storage.getItem("two-bells:log")).length, 40);
  });

  await t.test("a year of daily sitting, plus a month to export it", () => {
    // Spelt out rather than read back from the page: a test that takes the cap
    // from the code it is testing agrees with any cap at all.
    assert.equal(loadPage().seam.internals.KEEP, 400);
  });

  await t.test("no more than the cap, and the oldest are the ones to go", () => {
    const { seam, storage } = loadPage();
    const { KEEP } = seam.internals;
    const full = log(KEEP + 1);
    seam.seed(full);
    const kept = JSON.parse(storage.getItem("two-bells:log"));
    assert.equal(kept.length, KEEP);
    assert.equal(kept[0].at, full[0].at);                    // newest survives
    assert.ok(!kept.some((r) => r.at === full[KEEP].at));    // oldest does not
  });

  await t.test("the page and a reload agree about the list", () => {
    const { seam } = loadPage();
    const { KEEP } = seam.internals;
    seam.seed(log(KEEP + 25));
    // Trimmed in place, not only on the way out.
    assert.equal(seam.internals.getHistory().length, KEEP);
  });

  await t.test("less than that, when the browser says it is full", () => {
    const { seam, storage } = loadPage({ limitBytes: 3000 });
    seam.seed(log(200));
    const kept = JSON.parse(storage.getItem("two-bells:log"));
    assert.ok(kept.length > seam.internals.FLOOR, `kept ${kept.length}`);
    assert.ok(kept.length < 200, `kept ${kept.length}`);
    assert.ok(storage.getItem("two-bells:log").length <= 3000);
  });

  await t.test("and gives up rather than trimming away a log it cannot write", () => {
    // Safari in private browsing refuses every write. Without a floor the retry
    // loop would shorten the log forever chasing a request that cannot succeed.
    const { seam } = loadPage({ limitBytes: 0 });
    seam.seed(log(200));
    assert.equal(seam.internals.getHistory().length, seam.internals.FLOOR);
  });
});

test("recognising a full browser", async (t) => {
  const { isQuotaError } = loadPage().seam.internals;
  const named = (name) => Object.assign(new Error("x"), { name });

  await t.test("by the standard name", () => {
    assert.ok(isQuotaError(named("QuotaExceededError")));
  });

  await t.test("by Firefox's older one", () => {
    assert.ok(isQuotaError(named("NS_ERROR_DOM_QUOTA_REACHED")));
  });

  await t.test("by the legacy code", () => {
    assert.ok(isQuotaError(Object.assign(new Error("x"), { code: 22 })));
  });

  await t.test("and not by anything else", () => {
    assert.ok(!isQuotaError(new TypeError("undefined is not a function")));
    assert.ok(!isQuotaError(null));
  });
});
