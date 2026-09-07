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
    settleSec: 30, sitMin: 20, satMin: 20, elapsedMs: 1230000, outcome: "complete",
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
    assert.equal(minutesSat(sit({ sitMin: 20, satMin: 12 })), 12);
  });

  await t.test("a record from before sat existed falls back to what was set", () => {
    const legacy = sit({ sitMin: 20 });
    delete legacy.satMin;
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
    seam.internals.setHistory([sit({ sitMin: 20, satMin: 12 })]);
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

  await t.test("survive nonsense in storage", () => {
    const { seam } = loadPage({ seed: { "two-bells:totals": "{not json" } });
    assert.deepEqual(seam.internals.readTotals(), { sits: 0, minutes: 0 });
  });
});

// The tuning panel, as a list of row labels and a list of body buttons.
function panel(opts) {
  const tune = loadPage(opts).nodes["tune"];
  const bodyRow = tune.children.find((row) =>
    row.children.some((child) => child.className === "timbres"));
  const picker = bodyRow.children.find((child) => child.className === "timbres");
  return {
    rows: tune.children.map((row) => (row.children[0] || {}).textContent),
    bodies: picker.children.map((button) => button.textContent),
  };
}

test("who gets offered vibration", async (t) => {
  const rows = (opts) => panel(opts).rows;

  await t.test("a phone does", () => {
    assert.ok(rows({ touch: true }).includes("And vibrate"));
  });

  await t.test("a laptop does not, though it has the function", () => {
    // Desktop Chrome defines navigator.vibrate and it moves nothing. A switch
    // that does nothing is worse than no switch, so the row is absent.
    const desktop = { touch: false, storage: undefined };
    assert.ok(!rows(desktop).includes("And vibrate"), rows(desktop).join(", "));
  });

  await t.test("and on a phone, Silent comes first", () => {
    const onPhone = rows({ touch: true });
    assert.ok(onPhone.indexOf("Silent") < onPhone.indexOf("And vibrate"),
              onPhone.join(" | "));
  });

  await t.test("and vibration is the only switch there is", () => {
    // Silence is not an addition to a bell, it is an answer to which bell -- so it
    // lives among the bodies. There is no silent church bell as distinct from a
    // silent cowbell, which is exactly why it is one entry and not a multiplier.
    assert.ok(!rows({ touch: true }).includes("Silent"));
    assert.deepEqual(rows({ touch: true }).filter((r) => r === "And vibrate"),
                     ["And vibrate"]);
  });

  await t.test("Silent is a body, and the last one", () => {
    const { bodies } = panel({});
    assert.equal(bodies[bodies.length - 1], "Silent", bodies.join(", "));
    assert.ok(!bodies.includes("Cowbell"), bodies.join(", "));
  });

  await t.test("and stays last once the cowbell turns up", () => {
    const { bodies } = panel({ seed: { "two-bells:cowbell": "1" } });
    assert.deepEqual(bodies.slice(-2), ["Cowbell", "Silent"], bodies.join(", "));
  });

  await t.test("and a laptop will not buzz on a setting carried from a phone", () => {
    // Asserted by ringing it, not by looking at navigator: desktop Chrome HAS
    // navigator.vibrate, so the old check -- that the function was absent -- was
    // a fact about the stub rather than about the page, and passed either way.
    const carried = { "two-bells:custom": JSON.stringify({ vibrate: true }),
                      "two-bells:voice": "custom" };
    const laptop = loadPage({ touch: false, seed: carried });
    laptop.fire("start", "click");
    laptop.seam.hurry({ bellIn: -1, endIn: 60000 });
    laptop.document.visibilityState = "visible";
    laptop.fire(laptop.document, "visibilitychange");
    assert.deepEqual(laptop.vibrations, []);
  });

  await t.test("and a phone does buzz, so the check is not just always false", () => {
    const phone = loadPage({ touch: true, seed: {
      "two-bells:custom": JSON.stringify({ vibrate: true }),
      "two-bells:voice": "custom" } });
    phone.fire("start", "click");
    phone.seam.hurry({ bellIn: -1, endIn: 60000 });
    phone.document.visibilityState = "visible";
    phone.fire(phone.document, "visibilitychange");
    assert.deepEqual(phone.vibrations, [[30, 40, 160]]);
  });

  await t.test("a phone that has not asked for it stays quiet", () => {
    const phone = loadPage({ touch: true });
    phone.fire("start", "click");
    phone.seam.hurry({ bellIn: -1, endIn: 60000 });
    phone.document.visibilityState = "visible";
    phone.fire(phone.document, "visibilitychange");
    assert.deepEqual(phone.vibrations, []);
  });
});

test("when Contact appears", async (t) => {
  const { seam } = loadPage();
  const { contactFrom, setClock } = seam.internals;
  // Through the page's own clock seam. Reassigning global Date.now worked only
  // while every call site read it afresh; the page holds one reference now, which
  // is what lets a test drive time rather than hope nothing else reads it.
  const at = (iso, fn) => {
    setClock(() => Date.parse(iso));
    try { return fn(); } finally { setClock(null); }
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

  await t.test("a browser that refuses every write keeps its log on the screen", () => {
    // Safari in private browsing refuses one at any length. Trimming for that
    // gains nothing -- nothing is saved either way -- and used to cost the page
    // 180 of the 200 sits it was showing.
    const { seam } = loadPage({ limitBytes: 0 });
    seam.seed(log(200));
    assert.equal(seam.internals.getHistory().length, 200);
  });

  await t.test("and does not shorten it forever chasing an impossible write", () => {
    // The floor stops the retry loop; what is above stops it costing anything.
    const { seam } = loadPage({ limitBytes: 0 });
    seam.seed(log(200));
    seam.internals.persistLocal();
    assert.equal(seam.internals.getHistory().length, 200);
  });

  await t.test("but a browser that can take a shorter log gets one", () => {
    // Where trimming does buy a write, the page shows what was stored, so what is
    // on the screen and what a reload would find stay one list.
    const { seam, storage } = loadPage({ limitBytes: 3000 });
    seam.seed(log(200));
    const stored = JSON.parse(storage.getItem("two-bells:log"));
    assert.equal(seam.internals.getHistory().length, stored.length);
    assert.ok(stored.length < 200);
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


test("what the totals remember", async (t) => {
  const totals = (opts) => loadPage(opts).seam.internals;

  await t.test("a higher figure raises them", () => {
    const page = loadPage({ seed: { "two-bells:totals": '{"sits":3,"minutes":60}' } });
    page.seam.internals.raiseTotals(5, 100);
    assert.deepEqual(page.seam.internals.readTotals(), { sits: 5, minutes: 100 });
  });

  await t.test("the same figures change nothing", () => {
    // They are a high-water mark: equal is not higher, so there is nothing to do.
    const page = loadPage({ seed: { "two-bells:totals": '{"sits":3,"minutes":60}' } });
    const before = page.storage.getItem("two-bells:totals");
    page.seam.internals.raiseTotals(3, 60);
    assert.equal(page.storage.getItem("two-bells:totals"), before);
  });

  await t.test("a lower figure cannot pull them down", () => {
    const page = loadPage({ seed: { "two-bells:totals": '{"sits":9,"minutes":200}' } });
    page.seam.internals.raiseTotals(2, 10);
    assert.deepEqual(page.seam.internals.readTotals(), { sits: 9, minutes: 200 });
  });

  await t.test("one figure higher raises only that one", () => {
    const page = loadPage({ seed: { "two-bells:totals": '{"sits":9,"minutes":200}' } });
    page.seam.internals.raiseTotals(20, 10);
    assert.deepEqual(page.seam.internals.readTotals(), { sits: 20, minutes: 200 });
  });
});


test("joining two copies of a practice log", async (t) => {
  const merge = (page, records) => {
    page.seam.internals.mergeHistory(records);
    return page.seam.internals.getHistory();
  };

  await t.test("a record with no timestamp is not a record", () => {
    const page = loadPage();
    assert.deepEqual(merge(page, [{ sitMin: 20 }]), []);
  });

  await t.test("nor is nothing at all", () => {
    // The store is someone else's write, so it is not assumed to be well formed.
    const page = loadPage();
    assert.deepEqual(merge(page, [null, undefined, 0, "", { at: null }]), []);
  });

  await t.test("and the good ones in the same batch still land", () => {
    const page = loadPage();
    const good = { at: "2026-01-01T09:00:00.000Z", sitMin: 20, satMin: 20,
                   settleSec: 40, elapsedMs: 1200000, outcome: "complete" };
    assert.deepEqual(merge(page, [null, good, { sitMin: 5 }]).length, 1);
  });

  await t.test("the same timestamp twice is one sit", () => {
    const page = loadPage();
    const one = { at: "2026-01-01T09:00:00.000Z", sitMin: 20, satMin: 20,
                  settleSec: 40, elapsedMs: 1200000, outcome: "complete" };
    merge(page, [one]);
    assert.equal(merge(page, [{ ...one, sitMin: 30 }]).length, 1);
  });
});


test("how a sit reads in the log", async (t) => {
  const { describe } = loadPage().seam.internals;
  const row = (over) => ({ at: "2026-01-06T09:05:00.000Z", settleSec: 40,
                           sitMin: 20, satMin: 20, elapsedMs: 20 * 60000,
                           outcome: "complete", ...over });

  await t.test("a sit that ran its length shows one number", () => {
    assert.match(describe(row()), /<b>20 min<\/b>/);
  });

  await t.test("a sit cut short shows both", () => {
    // "12/20 min", because a log is read in a column and the shape of the number
    // matters more than the grammar.
    const text = describe(row({ satMin: 12, elapsedMs: 12 * 60000 }));
    assert.match(text, /<b>12<\/b>\/20 min/);
  });

  await t.test("a cancelled sit does not read as a completed one", () => {
    const done = describe(row());
    const gave = describe(row({ outcome: "cancelled" }));
    assert.notEqual(done, gave);
  });

  await t.test("and says so rather than showing a length", () => {
    const gave = describe(row({ outcome: "cancelled", satMin: 12,
                                elapsedMs: 12 * 60000 }));
    assert.doesNotMatch(gave, /<b>12 min<\/b>/);
  });

  await t.test("the time is the local time, not UTC", () => {
    if (!IN_PACIFIC) return;
    assert.match(describe(row()), /01:05/);
  });
});
