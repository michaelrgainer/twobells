// A whole sit, driven from node.
//
// This tier did not exist. Every gesture, every panel and the entire session
// lifecycle -- begin, the bell, the end, what gets written down -- sits behind an
// event listener, and the stub DOM used to record the event TYPE and throw the
// handler away. So two thirds of the page's functions were reachable only from the
// browser tier, which needs chromectl and a real Chrome, and a refactor could break
// any of them with a green fast suite.
//
// The seam does the rest: `hurry` moves the absolute deadlines forward and re-arms
// the backstops, so a twenty-minute sit finishes in milliseconds and the code under
// test cannot tell the difference.
const test = require("node:test");
const assert = require("node:assert");
const { loadPage, listens, REAL_SET_TIMEOUT } = require("./stub_dom");

const RING_UNITS = 60;
const MEDITATE_RADIUS = 90;    // the outer dial: minutes
const SETTLE_RADIUS = 66;      // the inner dial: seconds

// The backstops fire 40ms after a deadline, so anything waiting on one waits more.
const AFTER_BACKSTOP_MS = 90;

// The real one: loadPage replaces global.setTimeout with an unref'd version so the
// page cannot hold the process open, and a wait that did not hold it open would let
// node exit in the middle of a test.
const wait = (ms) => new Promise((done) => REAL_SET_TIMEOUT(done, ms));

/** A page with a sit already running, hurried to the given deadlines. */
function sitting(page, { bellIn = 0, endIn = 60000 } = {}) {
  page.fire("start", "click");
  page.seam.hurry({ bellIn, endIn });
  return page;
}

/** A point on the rings, at `radius` from centre and `degrees` clockwise from twelve. */
function onRing(radius, degrees) {
  const radians = (degrees - 90) * Math.PI / 180;
  // ringPoint maps a 300px box onto the 200-unit viewBox, so a viewBox radius of
  // r is 1.5r client pixels from the centre at (150,150).
  return { clientX: 150 + radius * Math.cos(radians) * 1.5,
           clientY: 150 + radius * Math.sin(radians) * 1.5,
           pointerId: 1 };
}


test("beginning a sit", async (t) => {
  await t.test("the page goes to settling and offers a way out", () => {
    const page = loadPage();
    page.fire("start", "click");
    assert.equal(page.seam.getState().phase, "waiting");
    assert.equal(page.nodes["cancel"].textContent, "Oops, never mind");
    assert.equal(page.nodes["cancel"].hidden, false);
    assert.equal(page.nodes["start"].hidden, true);
  });

  await t.test("a zero settle starts sitting straight away", () => {
    const page = loadPage({ seed: { "two-bells:durations": '{"settleSec":0,"sitMin":20}' } });
    page.fire("start", "click");
    assert.equal(page.seam.getState().phase, "sitting");
    assert.equal(page.nodes["cancel"].textContent, "End Now");
  });

  await t.test("the deadlines come from the dials", () => {
    const page = loadPage();
    page.fire("start", "click");
    const { settleSec, sitMin, msToBell, msToEnd } = page.seam.getState();
    assert.ok(Math.abs(msToBell - settleSec * 1000) < 50, `${msToBell} vs ${settleSec}s`);
    assert.ok(Math.abs(msToEnd - (settleSec * 1000 + sitMin * 60000)) < 50);
  });

  await t.test("beginning twice does not stack two sits", () => {
    const page = loadPage();
    page.fire("start", "click");
    const first = page.seam.getState().msToEnd;
    page.fire("start", "click");
    // Whatever it does, there is one session and its end is not doubled.
    assert.ok(page.seam.getState().msToEnd < first + 1000);
  });
});


test("the opening bell", async (t) => {
  await t.test("it rings, and the page goes empty", async () => {
    const page = sitting(loadPage(), { bellIn: 0, endIn: 60000 });
    await wait(AFTER_BACKSTOP_MS);
    const state = page.seam.getState();
    assert.equal(state.phase, "sitting");
    assert.equal(state.rang, true);
    assert.equal(state.note, "");
  });

  await t.test("the way out becomes End Now", async () => {
    const page = sitting(loadPage(), { bellIn: 0, endIn: 60000 });
    await wait(AFTER_BACKSTOP_MS);
    assert.equal(page.nodes["cancel"].textContent, "End Now");
  });

  await t.test("the fade lasts as long as the chime does", async () => {
    const page = sitting(loadPage(), { bellIn: 0, endIn: 60000 });
    await wait(AFTER_BACKSTOP_MS);
    // Not a fixed 8s: whatever the configured voice decays in.
    assert.match(page.nodes["sit"].style["--bell-fade"] || "", /^[\d.]+s$/);
  });

  await t.test("it rings once, not on every tick", async () => {
    const page = sitting(loadPage(), { bellIn: 0, endIn: 60000 });
    await wait(AFTER_BACKSTOP_MS);
    const before = page.seam.getState().rang;
    await wait(60);
    assert.equal(before, true);
    assert.equal(page.seam.getState().rang, true);
  });
});


test("finishing a sit", async (t) => {
  const complete = async () => {
    const page = sitting(loadPage(), { bellIn: 0, endIn: 30 });
    await wait(AFTER_BACKSTOP_MS + 60);
    return page;
  };

  await t.test("it rests on Sit complete before resetting", async () => {
    const page = await complete();
    const state = page.seam.getState();
    assert.equal(state.phase, "complete");
    assert.equal(state.note, "Sit complete");
  });

  await t.test("the sit is written down", async () => {
    const page = await complete();
    assert.equal(page.seam.getState().rows, 1);
    assert.equal(page.seam.internals.getHistory()[0].outcome, "complete");
  });

  await t.test("and the totals go up", async () => {
    const page = await complete();
    assert.equal(page.seam.getState().totals.sits, 1);
  });

  await t.test("Begin comes back and the way out goes", async () => {
    const page = await complete();
    assert.equal(page.nodes["start"].hidden, false);
    assert.equal(page.nodes["cancel"].hidden, true);
  });

  await t.test("the note settles back after its linger", async () => {
    const page = loadPage();
    page.seam.internals.setNoteLinger(10);
    sitting(page, { bellIn: 0, endIn: 30 });
    await wait(AFTER_BACKSTOP_MS + 120);
    assert.notEqual(page.seam.getState().note, "Sit complete");
  });

  await t.test("the newest sit is in storage the moment it ends", async () => {
    // The bug a user found: save() serialises history, and history.unshift ran
    // after it, so the newest sit was on the page and not in localStorage until
    // some later save happened to pick it up. A refresh lost it.
    const page = await complete();
    const stored = JSON.parse(page.storage.getItem("two-bells:log") || "[]");
    assert.equal(stored.length, 1, page.storage.getItem("two-bells:log"));
  });
});


test("leaving early", async (t) => {
  await t.test("during the settle it records nothing", () => {
    const page = loadPage();
    page.fire("start", "click");
    page.fire("cancel", "click");
    assert.equal(page.seam.getState().rows, 0);
  });

  await t.test("during the settle it goes back to idle and says so", () => {
    const page = loadPage();
    page.fire("start", "click");
    page.fire("cancel", "click");
    const state = page.seam.getState();
    assert.equal(state.phase, "idle");
    assert.notEqual(state.note, "");
  });

  await t.test("a practice log is not filled with changes of mind", () => {
    const page = loadPage();
    for (let i = 0; i < 5; i++) {
      page.fire("start", "click");
      page.fire("cancel", "click");
    }
    assert.equal(page.seam.getState().rows, 0);
    assert.equal(page.seam.getState().totals.sits, 0);
  });

  await t.test("after the bell it IS recorded, as cancelled", async () => {
    const page = sitting(loadPage(), { bellIn: 0, endIn: 60000 });
    await wait(AFTER_BACKSTOP_MS);
    page.fire("cancel", "click");
    const rows = page.seam.internals.getHistory();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].outcome, "cancelled");
  });

  await t.test("and it keeps both numbers: what was set and what was sat", async () => {
    const page = sitting(loadPage(), { bellIn: 0, endIn: 60000 });
    await wait(AFTER_BACKSTOP_MS);
    page.fire("cancel", "click");
    const row = page.seam.internals.getHistory()[0];
    assert.equal(typeof row.sitMin, "number");
    assert.equal(typeof row.satMin, "number");
    assert.ok(row.satMin <= row.sitMin, `${row.satMin} > ${row.sitMin}`);
  });

  await t.test("an early exit does not rest -- it resets", async () => {
    const page = sitting(loadPage(), { bellIn: 0, endIn: 60000 });
    await wait(AFTER_BACKSTOP_MS);
    page.fire("cancel", "click");
    assert.equal(page.seam.getState().phase, "idle");
  });

  await t.test("cancelling when nothing is running does nothing", () => {
    const page = loadPage();
    page.fire("cancel", "click");
    assert.equal(page.seam.getState().rows, 0);
    assert.equal(page.seam.getState().phase, "idle");
  });
});


test("choosing durations by dragging a ring", async (t) => {
  const grab = (page, radius, degrees) =>
    page.fire("rings", "pointerdown", onRing(radius, degrees));

  await t.test("a tap on the outer ring sets the minutes", () => {
    const page = loadPage();
    grab(page, MEDITATE_RADIUS, 180);            // half a turn = 30 of 60
    assert.equal(page.seam.getState().sitMin, 30);
  });

  await t.test("a tap on the inner ring sets the settle seconds", () => {
    const page = loadPage();
    grab(page, SETTLE_RADIUS, 180);
    assert.equal(page.seam.getState().settleSec, 30);
  });

  await t.test("a tap in the hole is not aimed at either ring", () => {
    const page = loadPage();
    const before = page.seam.getState();
    grab(page, 10, 180);
    assert.deepEqual(page.seam.getState().sitMin, before.sitMin);
    assert.deepEqual(page.seam.getState().settleSec, before.settleSec);
  });

  await t.test("nor is a tap outside them", () => {
    const page = loadPage();
    const before = page.seam.getState().sitMin;
    grab(page, 140, 180);
    assert.equal(page.seam.getState().sitMin, before);
  });

  await t.test("dragging follows the pointer", () => {
    const page = loadPage();
    grab(page, MEDITATE_RADIUS, 90);
    assert.equal(page.seam.getState().sitMin, 15);
    page.fire(page.window, "pointermove", onRing(MEDITATE_RADIUS, 270));
    assert.equal(page.seam.getState().sitMin, 45);
  });

  await t.test("letting go stores what was chosen", () => {
    const page = loadPage();
    grab(page, MEDITATE_RADIUS, 180);
    page.fire(page.window, "pointerup", {});
    const stored = JSON.parse(page.storage.getItem("two-bells:durations") || "{}");
    assert.equal(stored.sitMin, 30);
  });

  await t.test("the drag stops following after it is let go", () => {
    const page = loadPage();
    grab(page, MEDITATE_RADIUS, 90);
    page.fire(page.window, "pointerup", {});
    assert.equal(listens(page.window, "pointermove"), false);
  });

  await t.test("a drag across twelve reaches the top of the range, not zero", () => {
    // Read literally the top of the ring is 0, so 60 could never be chosen and a
    // drag across it snapped from 59 to 1.
    const page = loadPage();
    grab(page, MEDITATE_RADIUS, 354);            // 59 minutes
    assert.equal(page.seam.getState().sitMin, 59);
    page.fire(page.window, "pointermove", onRing(MEDITATE_RADIUS, 2));
    assert.equal(page.seam.getState().sitMin, 60);
  });

  await t.test("and a drag the other way across twelve reaches the bottom", () => {
    const page = loadPage();
    grab(page, SETTLE_RADIUS, 6);                // 1 second
    page.fire(page.window, "pointermove", onRing(SETTLE_RADIUS, 354));
    assert.equal(page.seam.getState().settleSec, 0);
  });

  await t.test("a TAP is not a crossing, wherever the dial happens to sit", () => {
    // The crossing rule is about consecutive drag samples. Applied to a fresh
    // press, where `previous` is merely wherever the dial was left, it put the
    // dial at the wrong end of the ring: set to 45 minutes, tapping the 5-minute
    // mark started a sixty-minute sit.
    const from45 = loadPage(
      { seed: { "two-bells:durations": '{"settleSec":40,"sitMin":45}' } });
    from45.fire("rings", "pointerdown", onRing(MEDITATE_RADIUS, 30));
    assert.equal(from45.seam.getState().sitMin, 5);

    const from20 = loadPage(
      { seed: { "two-bells:durations": '{"settleSec":40,"sitMin":20}' } });
    from20.fire("rings", "pointerdown", onRing(MEDITATE_RADIUS, 330));
    assert.equal(from20.seam.getState().sitMin, 55);
  });

  await t.test("the first touch of a ring is remembered as learned", () => {
    const page = loadPage();
    grab(page, MEDITATE_RADIUS, 180);
    assert.equal(page.storage.getItem("two-bells:learned"), "1");
  });
});


test("adjusting a sit that is already running", async (t) => {
  const running = async () => {
    const page = sitting(loadPage(), { bellIn: 0, endIn: 30 * 60000 });
    await wait(AFTER_BACKSTOP_MS);
    return page;
  };

  await t.test("touching the ring alone changes nothing", async () => {
    // Absolute was dangerous: grabbing the tip of a nearly-finished sit rounded to
    // zero and rang the bell on contact.
    const page = await running();
    const before = page.seam.getState().msToEnd;
    page.fire("rings", "pointerdown", onRing(MEDITATE_RADIUS, 180));
    assert.ok(Math.abs(page.seam.getState().msToEnd - before) < 100);
  });

  await t.test("moving anticlockwise shortens it", async () => {
    const page = await running();
    const before = page.seam.getState().msToEnd;
    page.fire("rings", "pointerdown", onRing(MEDITATE_RADIUS, 180));
    page.fire(page.window, "pointermove", onRing(MEDITATE_RADIUS, 120));
    assert.ok(page.seam.getState().msToEnd < before - 60000,
              `${page.seam.getState().msToEnd} vs ${before}`);
  });

  await t.test("it shortens a sit and never lengthens one", async () => {
    const page = await running();
    const before = page.seam.getState().msToEnd;
    page.fire("rings", "pointerdown", onRing(MEDITATE_RADIUS, 180));
    page.fire(page.window, "pointermove", onRing(MEDITATE_RADIUS, 300));
    assert.ok(page.seam.getState().msToEnd <= before + 100);
  });

  await t.test("the inner ring is not offered mid-sit", async () => {
    // Refused at the press, so no drag is ever armed -- which is what makes the
    // settle dial untouchable rather than merely unresponsive.
    const page = await running();
    page.fire("rings", "pointerdown", onRing(SETTLE_RADIUS, 200));
    assert.equal(listens(page.window, "pointermove"), false);
  });

  await t.test("the rings do not answer during the settle", () => {
    const page = loadPage();
    page.fire("start", "click");
    page.fire("rings", "pointerdown", onRing(MEDITATE_RADIUS, 200));
    assert.equal(listens(page.window, "pointermove"), false);
  });

  await t.test("and the outer ring IS offered, once the bell has gone", async () => {
    const page = await running();
    page.fire("rings", "pointerdown", onRing(MEDITATE_RADIUS, 200));
    assert.equal(listens(page.window, "pointermove"), true);
  });

  await t.test("nor while the page is resting on Sit complete", async () => {
    const page = sitting(loadPage(), { bellIn: 0, endIn: 30 });
    await wait(AFTER_BACKSTOP_MS + 60);
    assert.equal(page.seam.getState().phase, "complete");
    const before = page.seam.getState().sitMin;
    page.fire("rings", "pointerdown", onRing(MEDITATE_RADIUS, 200));
    assert.equal(page.seam.getState().sitMin, before);
  });

  await t.test("adjusting does not overwrite the stored durations", async () => {
    // The dials are what they were; only this sit's end moved.
    const page = await running();
    page.storage.removeItem("two-bells:durations");
    page.fire("rings", "pointerdown", onRing(MEDITATE_RADIUS, 180));
    page.fire(page.window, "pointermove", onRing(MEDITATE_RADIUS, 120));
    page.fire(page.window, "pointerup", {});
    assert.equal(page.storage.getItem("two-bells:durations"), null);
  });
});


test("coming back to a page that was left open", async (t) => {
  await t.test("a hidden page that comes back catches up", async () => {
    // A phone throttles the frame loop to nothing, so the bell can be overdue by
    // the time someone looks again.
    const page = sitting(loadPage(), { bellIn: 5000, endIn: 60000 });
    page.seam.hurry({ bellIn: -1000, endIn: 60000 });
    page.document.visibilityState = "visible";
    page.fire(page.document, "visibilitychange");
    assert.equal(page.seam.getState().rang, true);
  });

  await t.test("going away does not ring anything", () => {
    const page = sitting(loadPage(), { bellIn: 5000, endIn: 60000 });
    page.document.visibilityState = "hidden";
    page.fire(page.document, "visibilitychange");
    assert.equal(page.seam.getState().rang, false);
  });

  await t.test("and with no sit running it does nothing at all", () => {
    const page = loadPage();
    page.document.visibilityState = "visible";
    page.fire(page.document, "visibilitychange");
    assert.equal(page.seam.getState().phase, "idle");
  });

  await t.test("an overdue end finishes the sit rather than waiting", async () => {
    const page = sitting(loadPage(), { bellIn: 0, endIn: 60000 });
    await wait(AFTER_BACKSTOP_MS);
    page.seam.hurry({ endIn: -1000 });
    page.document.visibilityState = "visible";
    page.fire(page.document, "visibilitychange");
    assert.equal(page.seam.getState().rows, 1);
  });
});


test("a browser that offers somewhere to keep sits", async (t) => {
  const withStore = (docs) => {
    const collection = {
      orderBy: () => collection,
      limit: () => collection,
      get: () => Promise.resolve({ empty: !docs.length,
                                   docs: docs.map((d) => ({ data: () => d })) }),
    };
    return loadPage({ claude: { use: () => Promise.resolve({
      collection: () => collection,
      doc: () => ({ set: () => Promise.resolve() }),
    }) } });
  };

  const aSit = (day) => ({ at: new Date(2026, 0, day, 9, 0).toISOString(),
                           settleSec: 40, sitMin: 20, satMin: 20,
                           elapsedMs: 20 * 60000, outcome: "complete" });

  await t.test("what the store holds arrives on the page", async () => {
    const page = withStore([aSit(1), aSit(2)]);
    await wait(20);
    assert.equal(page.seam.getState().rows, 2);
  });

  await t.test("and joins what this browser already had", async () => {
    // Neither is the fuller record on its own, so it is a union and not a replace.
    const page = withStore([aSit(1)]);
    page.seam.seed([aSit(9)]);
    await wait(20);
    assert.equal(page.seam.getState().rows, 2);
  });

  await t.test("an empty store leaves the page alone", async () => {
    const page = withStore([]);
    page.seam.seed([aSit(9)]);
    await wait(20);
    assert.equal(page.seam.getState().rows, 1);
  });

  await t.test("a browser with no store is the ordinary case and works", () => {
    const page = loadPage();
    assert.equal(page.seam.getState().rows, 0);
  });

  await t.test("a store that refuses does not take the page down with it", async () => {
    const page = loadPage({ claude: { use: () => Promise.reject(new Error("nope")) } });
    page.seam.seed([aSit(9)]);
    await wait(20);
    assert.equal(page.seam.getState().rows, 1);
  });

  await t.test("nor one that resolves to nothing", async () => {
    const page = loadPage({ claude: { use: () => Promise.resolve(null) } });
    page.seam.seed([aSit(9)]);
    await wait(20);
    assert.equal(page.seam.getState().rows, 1);
  });
});


test("the ring geometry, angle by angle", async (t) => {
  // Pinned as a table rather than by "it got shorter": every one of the constants
  // that turns a point into a number -- the 200/box scale, the -100 centring, the
  // +90 rotation, the /360 -- survived being changed by one, because a loose
  // assertion still held afterwards.
  const tapMinutes = (degrees) => {
    const page = loadPage();
    page.fire("rings", "pointerdown", onRing(MEDITATE_RADIUS, degrees));
    return page.seam.getState().sitMin;
  };
  const tapSeconds = (degrees) => {
    const page = loadPage();
    page.fire("rings", "pointerdown", onRing(SETTLE_RADIUS, degrees));
    return page.seam.getState().settleSec;
  };

  await t.test("twelve o'clock is the bottom of the range", () => {
    assert.equal(tapSeconds(0), 0);
  });

  await t.test("and clockwise from there counts up", () => {
    assert.deepEqual([90, 180, 270].map(tapSeconds), [15, 30, 45]);
  });

  await t.test("every sixth degree is another minute", () => {
    const table = [[6, 1], [60, 10], [90, 15], [150, 25], [180, 30],
                   [240, 40], [300, 50], [354, 59]];
    for (const [degrees, minutes] of table) {
      assert.equal(tapMinutes(degrees), minutes, `${degrees} degrees`);
    }
  });

  await t.test("the minutes dial will not go below one", () => {
    assert.equal(tapMinutes(0), 1);
  });

  await t.test("the seconds dial stops at fifty-nine", () => {
    assert.equal(tapSeconds(357), 59);
  });

  await t.test("a point off-centre in the box still reads the same angle", () => {
    // The scale factor turns client pixels into viewBox units; getting it wrong
    // moves every value at once.
    const page = loadPage();
    page.fire("rings", "pointerdown", onRing(MEDITATE_RADIUS, 180));
    assert.equal(page.seam.getState().sitMin, 30);
  });
});


test("shortening a running sit, by the minute", async (t) => {
  const running = async (endInMin) => {
    const page = sitting(loadPage(), { bellIn: 0, endIn: endInMin * 60000 });
    await wait(AFTER_BACKSTOP_MS);
    return page;
  };

  await t.test("a quarter turn back takes off fifteen minutes", async () => {
    // Relative: the grab records where the pointer was, and the movement from
    // there is the change. A quarter of the ring is fifteen of its sixty minutes.
    const page = await running(40);
    const before = page.seam.getState().msToEnd;
    page.fire("rings", "pointerdown", onRing(MEDITATE_RADIUS, 240));
    page.fire(page.window, "pointermove", onRing(MEDITATE_RADIUS, 150));
    const took = (before - page.seam.getState().msToEnd) / 60000;
    assert.ok(Math.abs(took - 15) < 0.2, `took off ${took} min`);
  });

  await t.test("a sixth of a turn takes off ten", async () => {
    const page = await running(40);
    const before = page.seam.getState().msToEnd;
    page.fire("rings", "pointerdown", onRing(MEDITATE_RADIUS, 240));
    page.fire(page.window, "pointermove", onRing(MEDITATE_RADIUS, 180));
    const took = (before - page.seam.getState().msToEnd) / 60000;
    assert.ok(Math.abs(took - 10) < 0.2, `took off ${took} min`);
  });

  await t.test("dragging past the end stops at now, and finishes", async () => {
    const page = await running(5);
    page.fire("rings", "pointerdown", onRing(MEDITATE_RADIUS, 30));
    page.fire(page.window, "pointermove", onRing(MEDITATE_RADIUS, 300));
    // Never earlier than now: whatever happens, the sit does not end in the past.
    const left = page.seam.getState().msToEnd;
    assert.ok(left === null || left >= -50, `${left} ms left`);
  });
});


test("the ring arithmetic, every degree of it", async (t) => {
  // Swept rather than sampled. Away from a rounding boundary the constants are
  // almost interchangeable -- 180 degrees is 29.9 units on a 361-unit turn and
  // rounds to 30 either way -- so changing /360, or the +90 rotation, or the
  // viewBox scale, by one passed every sampled assertion above. Over all 360
  // degrees at least one reading has to move.
  const sweep = (radius, min, max) => {
    const page = loadPage();
    const got = [], want = [];
    for (let degrees = 0; degrees < 360; degrees++) {
      // Every sixth degree from three is exactly half a unit, and this helper
      // reaches the page through cos/sin and back through atan2, so it arrives as
      // 2.9999 and rounds the other way. The ambiguity is in the round trip, not
      // in the page, and 300 unambiguous readings pin the arithmetic just as well.
      if (degrees % 6 === 3) { got.push(null); want.push(null); continue; }
      page.fire("rings", "pointerdown", onRing(radius, degrees));
      got.push(page.seam.getState()[radius === SETTLE_RADIUS ? "settleSec" : "sitMin"]);
      want.push(Math.max(min, Math.min(max, Math.round(degrees / 360 * RING_UNITS))));
    }
    return { got, want };
  };

  await t.test("the settle ring reads 0 to 59, one unit per six degrees", () => {
    const { got, want } = sweep(SETTLE_RADIUS, 0, 59);
    const wrong = got.map((v, i) => [i, v, want[i]]).filter(([, v, w]) => v !== w);
    assert.deepEqual(wrong, [], `first wrong: ${JSON.stringify(wrong[0])}`);
  });

  await t.test("the meditate ring reads 1 to 60 the same way", () => {
    const { got, want } = sweep(MEDITATE_RADIUS, 1, 60);
    const wrong = got.map((v, i) => [i, v, want[i]]).filter(([, v, w]) => v !== w);
    assert.deepEqual(wrong, [], `first wrong: ${JSON.stringify(wrong[0])}`);
  });
});


test("a drag that goes more than halfway round", async (t) => {
  // adjustSit reads a movement of more than half a turn as having gone the other
  // way, because a finger cannot cross the whole ring between two pointer samples.
  // Only a drag of JUST over half a turn tells the two readings apart, so nothing
  // above pinned the boundary.
  const running = async () => {
    const page = sitting(loadPage(), { bellIn: 0, endIn: 40 * 60000 });
    await wait(AFTER_BACKSTOP_MS);
    return page;
  };

  await t.test("just over half a turn forwards is read as backwards", async () => {
    const page = await running();
    const before = page.seam.getState().msToEnd;
    page.fire("rings", "pointerdown", onRing(MEDITATE_RADIUS, 0));
    page.fire(page.window, "pointermove", onRing(MEDITATE_RADIUS, 180.5));
    const took = (before - page.seam.getState().msToEnd) / 60000;
    // Read forwards it would lengthen the sit, which is refused outright and would
    // leave the end where it was. Read backwards it takes off just under thirty.
    assert.ok(Math.abs(took - 29.9) < 0.3, `took off ${took} min`);
  });

  await t.test("just under half a turn forwards stays forwards", async () => {
    const page = await running();
    const before = page.seam.getState().msToEnd;
    page.fire("rings", "pointerdown", onRing(MEDITATE_RADIUS, 0));
    page.fire(page.window, "pointermove", onRing(MEDITATE_RADIUS, 179.5));
    // Forwards lengthens, and a sit is never lengthened, so nothing moves.
    assert.ok(Math.abs(before - page.seam.getState().msToEnd) < 200);
  });

  await t.test("and the same boundary the other way round leaves it alone", async () => {
    // Mirror image, and not symmetrical in effect: a big BACKWARDS movement wraps
    // to forwards, and forwards is refused, so the end stays put. Without the wrap
    // it would read as a backwards drag and take half an hour off.
    const page = await running();
    const before = page.seam.getState().msToEnd;
    page.fire("rings", "pointerdown", onRing(MEDITATE_RADIUS, 181));
    page.fire(page.window, "pointermove", onRing(MEDITATE_RADIUS, 0.5));
    assert.ok(Math.abs(before - page.seam.getState().msToEnd) < 200,
              `moved by ${(before - page.seam.getState().msToEnd) / 60000} min`);
  });
});


test("the session arithmetic, on a clock the test drives", async (t) => {
  // No waiting and no tolerances. Every assertion above about durations had to
  // allow for real time passing between the act and the check, and a tolerance
  // wide enough for that is wide enough to hide the deadline being off by a
  // second -- which is why changing `settleSec * 1000` survived every one of them.
  const atMinute = (page, minutes) => {
    page.seam.internals.setClock(() => START + minutes * 60000);
    return page;
  };
  const START = Date.parse("2026-09-07T09:00:00.000Z");

  const frozen = (opts) => {
    const page = loadPage(opts);
    page.seam.internals.setClock(() => START);
    return page;
  };

  await t.test("the bell is exactly settleSec after Begin", () => {
    const page = frozen({ seed: { "two-bells:durations": '{"settleSec":40,"sitMin":20}' } });
    page.fire("start", "click");
    assert.equal(page.seam.getState().msToBell, 40000);
  });

  await t.test("and the end is exactly settleSec plus sitMin after it", () => {
    const page = frozen({ seed: { "two-bells:durations": '{"settleSec":40,"sitMin":20}' } });
    page.fire("start", "click");
    assert.equal(page.seam.getState().msToEnd, 40000 + 20 * 60000);
  });

  await t.test("a zero settle puts the bell exactly now", () => {
    const page = frozen({ seed: { "two-bells:durations": '{"settleSec":0,"sitMin":20}' } });
    page.fire("start", "click");
    assert.equal(page.seam.getState().msToBell, 0);
  });

  await t.test("the bell goes at the instant it is due, not the one after", () => {
    // `now >= bellAt`, not `>`. One millisecond of difference, and only an exact
    // clock can tell them apart.
    const page = frozen({ seed: { "two-bells:durations": '{"settleSec":40,"sitMin":20}' } });
    page.fire("start", "click");
    atMinute(page, 40 / 60);                      // exactly 40 seconds later
    page.document.visibilityState = "visible";
    page.fire(page.document, "visibilitychange");
    assert.equal(page.seam.getState().rang, true);
  });

  await t.test("and not a millisecond before", () => {
    const page = frozen({ seed: { "two-bells:durations": '{"settleSec":40,"sitMin":20}' } });
    page.fire("start", "click");
    page.seam.internals.setClock(() => START + 39999);
    page.document.visibilityState = "visible";
    page.fire(page.document, "visibilitychange");
    assert.equal(page.seam.getState().rang, false);
  });

  await t.test("the sit ends at the instant it is due", () => {
    const page = frozen({ seed: { "two-bells:durations": '{"settleSec":0,"sitMin":20}' } });
    page.fire("start", "click");
    atMinute(page, 20);
    page.document.visibilityState = "visible";
    page.fire(page.document, "visibilitychange");
    assert.equal(page.seam.getState().phase, "complete");
  });

  await t.test("and not a millisecond before", () => {
    const page = frozen({ seed: { "two-bells:durations": '{"settleSec":0,"sitMin":20}' } });
    page.fire("start", "click");
    page.seam.internals.setClock(() => START + 20 * 60000 - 1);
    page.document.visibilityState = "visible";
    page.fire(page.document, "visibilitychange");
    assert.notEqual(page.seam.getState().phase, "complete");
  });

  await t.test("a sit cut short records the minutes actually sat", () => {
    const page = frozen({ seed: { "two-bells:durations": '{"settleSec":0,"sitMin":20}' } });
    page.fire("start", "click");
    atMinute(page, 0);
    page.document.visibilityState = "visible";
    page.fire(page.document, "visibilitychange");   // rings
    atMinute(page, 7);
    page.fire("cancel", "click");
    const row = page.seam.internals.getHistory()[0];
    assert.equal(row.satMin, 7);
    assert.equal(row.sitMin, 20);
    assert.equal(row.elapsedMs, 7 * 60000);
  });

  await t.test("elapsedMs covers the settle too, not just the sitting", () => {
    // Every other assertion used a zero settle, where Begin and the bell are the
    // same instant and measuring from either gives the same answer.
    const page = frozen({ seed: { "two-bells:durations": '{"settleSec":40,"sitMin":20}' } });
    page.fire("start", "click");
    page.seam.internals.setClock(() => START + 40000);
    page.document.visibilityState = "visible";
    page.fire(page.document, "visibilitychange");     // rings, 40s in
    page.seam.internals.setClock(() => START + 40000 + 5 * 60000);
    page.fire("cancel", "click");
    const row = page.seam.internals.getHistory()[0];
    assert.equal(row.satMin, 5);                      // sat for five
    assert.equal(row.elapsedMs, 40000 + 5 * 60000);   // was here for five and forty
  });

  await t.test("the minutes sat are rounded, not truncated", () => {
    const page = frozen({ seed: { "two-bells:durations": '{"settleSec":0,"sitMin":20}' } });
    page.fire("start", "click");
    page.document.visibilityState = "visible";
    page.fire(page.document, "visibilitychange");
    page.seam.internals.setClock(() => START + 7.6 * 60000);
    page.fire("cancel", "click");
    assert.equal(page.seam.internals.getHistory()[0].satMin, 8);
  });

  await t.test("and never negative, however the clock behaves", () => {
    const page = frozen({ seed: { "two-bells:durations": '{"settleSec":0,"sitMin":20}' } });
    page.fire("start", "click");
    page.document.visibilityState = "visible";
    page.fire(page.document, "visibilitychange");
    page.seam.internals.setClock(() => START - 60000);
    page.fire("cancel", "click");
    assert.equal(page.seam.internals.getHistory()[0].satMin, 0);
  });

  await t.test("shortening a sit moves the end by exactly the angle dragged", () => {
    const page = frozen({ seed: { "two-bells:durations": '{"settleSec":0,"sitMin":40}' } });
    page.fire("start", "click");
    page.document.visibilityState = "visible";
    page.fire(page.document, "visibilitychange");
    const before = page.seam.getState().msToEnd;
    page.fire("rings", "pointerdown", onRing(MEDITATE_RADIUS, 240));
    page.fire(page.window, "pointermove", onRing(MEDITATE_RADIUS, 150));
    // A quarter of the ring is a quarter of its sixty minutes, to the millisecond.
    const took = before - page.seam.getState().msToEnd;
    assert.ok(Math.abs(took - 15 * 60000) < 5, `took off ${took} ms`);
  });
});
