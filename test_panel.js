// The tuning panel, the value pickers, and the two buttons under the log.
//
// All of it sits behind a click, so none of it was reachable from node until the
// stub kept its handlers. What made it worth reaching is that this is the layer
// features were bolted onto last -- bodies, the vibrate switch, the show-last
// picker, the copy button -- and it is where a refactor is most likely to break
// something a person would only notice by tapping it.
const test = require("node:test");
const assert = require("node:assert");
const { loadPage, listens, REAL_SET_TIMEOUT } = require("./stub_dom");

const wait = (ms) => new Promise((done) => REAL_SET_TIMEOUT(done, ms));

const voiceButtons = (page) =>
  page.nodes["voices"].children.reduce(
    (all, b) => ({ ...all, [b.dataset.voice]: b }), {});

const pressed = (page) =>
  page.nodes["voices"].children
    .filter((b) => b.getAttribute("aria-pressed") === "true")
    .map((b) => b.dataset.voice);

const items = (page, listId) =>
  page.nodes[listId].children.map((item) => item.textContent);


test("choosing a voice", async (t) => {
  await t.test("the chosen one is the pressed one", () => {
    const page = loadPage();
    page.fire(voiceButtons(page).chime, "click");
    assert.deepEqual(pressed(page), ["chime"]);
  });

  await t.test("and only ever one of them", () => {
    const page = loadPage();
    page.fire(voiceButtons(page).chime, "click");
    page.fire(voiceButtons(page).bowl, "click");
    assert.deepEqual(pressed(page), ["bowl"]);
  });

  await t.test("the choice outlives the page", () => {
    const page = loadPage();
    page.fire(voiceButtons(page).chime, "click");
    assert.equal(page.storage.getItem("two-bells:voice"), "chime");
    assert.equal(loadPage({ storage: page.storage }).seam.getState().voice, "chime");
  });

  await t.test("a preset puts the tuning panel away", () => {
    const page = loadPage();
    page.fire(voiceButtons(page).custom, "click");
    assert.equal(page.nodes["tune"].hidden, false);
    page.fire(voiceButtons(page).bowl, "click");
    assert.equal(page.nodes["tune"].hidden, true);
  });

  await t.test("Custom brings it out", () => {
    const page = loadPage();
    page.fire(voiceButtons(page).custom, "click");
    assert.equal(page.nodes["tune"].hidden, false);
  });

  await t.test("and tapping Custom again puts it away", () => {
    // By then the bell has just been heard from a slider, so a second tap is a
    // request to close the panel rather than to ring again.
    const page = loadPage();
    page.fire(voiceButtons(page).custom, "click");
    page.fire(voiceButtons(page).custom, "click");
    assert.equal(page.nodes["tune"].hidden, true);
  });

  await t.test("an unknown stored voice falls back rather than breaking", () => {
    const page = loadPage({ seed: { "two-bells:voice": "harmonium" } });
    assert.ok(["bowl", "chime", "custom"].includes(page.seam.getState().voice));
  });
});


test("the tuning panel puts itself away", async (t) => {
  // It is tall enough to push the rings off a phone screen, so it does not rely on
  // being dismissed. Nothing here used to advance time or assert it had closed:
  // two tests, three assertions, all of them that the panel was open, and one of
  // them written `assert.ok(... || true)`.
  const opened = (idleMs) => {
    const page = loadPage();
    page.seam.internals.setPanelIdle(idleMs);
    page.fire(voiceButtons(page).custom, "click");
    return page;
  };

  await t.test("after a stretch of not being touched", async () => {
    const page = opened(20);
    assert.equal(page.nodes["tune"].hidden, false);
    await wait(60);
    assert.equal(page.nodes["tune"].hidden, true);
  });

  await t.test("and not before that stretch is up", async () => {
    const page = opened(400);
    await wait(60);
    assert.equal(page.nodes["tune"].hidden, false);
  });

  await t.test("touching a slider starts the wait again", async () => {
    const page = opened(120);
    await wait(70);
    const pitch = tunePanel(page).slider("Pitch");
    pitch.value = "300";
    page.fire(pitch, "input");        // keepPanelOpen
    await wait(70);                   // past the original deadline
    assert.equal(page.nodes["tune"].hidden, false);
    await wait(90);
    assert.equal(page.nodes["tune"].hidden, true);
  });

  await t.test("choosing a body starts it again too", async () => {
    const page = opened(120);
    await wait(70);
    const panel = tunePanel(page);
    page.fire(panel.bodies.find((b) => b.dataset.timbre === "glass"), "click");
    await wait(70);
    assert.equal(page.nodes["tune"].hidden, false);
  });

  await t.test("and beginning a sit puts it away at once", () => {
    const page = opened(10000);
    page.fire("start", "click");
    assert.equal(page.nodes["tune"].hidden, true);
  });
});


test("picking a value from a list", async (t) => {
  const open = (page, button) => page.fire(button, "click");

  await t.test("the list is built from the picker's grid", () => {
    const page = loadPage();
    open(page, page.nodes["pick-sit"]);
    assert.deepEqual(items(page, "list-sit"),
                     [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]
                       .map((n) => n + " min"));
  });

  await t.test("opening it marks the button expanded", () => {
    const page = loadPage();
    open(page, page.nodes["pick-sit"]);
    assert.equal(page.nodes["pick-sit"].getAttribute("aria-expanded"), "true");
    assert.equal(page.nodes["picker-sit"].hidden, false);
  });

  await t.test("the current value is the selected one", () => {
    const page = loadPage();
    open(page, page.nodes["pick-sit"]);
    const chosen = page.nodes["list-sit"].children
      .filter((item) => item.getAttribute("aria-selected") === "true")
      .map((item) => item.textContent);
    assert.deepEqual(chosen, ["20 min"]);
  });

  await t.test("choosing sets the duration and closes the list", () => {
    const page = loadPage();
    open(page, page.nodes["pick-sit"]);
    const forty = page.nodes["list-sit"].children.find((i) => i.textContent === "40 min");
    page.fire(forty, "click");
    assert.equal(page.seam.getState().sitMin, 40);
    assert.equal(page.nodes["picker-sit"].hidden, true);
  });

  await t.test("and stores it, so it is there next time", () => {
    const page = loadPage();
    open(page, page.nodes["pick-sit"]);
    page.fire(page.nodes["list-sit"].children.find((i) => i.textContent === "40 min"), "click");
    assert.equal(JSON.parse(page.storage.getItem("two-bells:durations")).sitMin, 40);
  });

  await t.test("a second tap on the button puts it away", () => {
    const page = loadPage();
    open(page, page.nodes["pick-sit"]);
    open(page, page.nodes["pick-sit"]);
    assert.equal(page.nodes["picker-sit"].hidden, true);
  });

  await t.test("Escape closes it", () => {
    const page = loadPage();
    open(page, page.nodes["pick-sit"]);
    page.fire(page.document, "keydown", { key: "Escape" });
    assert.equal(page.nodes["picker-sit"].hidden, true);
  });

  await t.test("another key does not", () => {
    const page = loadPage();
    open(page, page.nodes["pick-sit"]);
    page.fire(page.document, "keydown", { key: "a" });
    assert.equal(page.nodes["picker-sit"].hidden, false);
  });

  await t.test("a tap anywhere else closes it", () => {
    const page = loadPage();
    open(page, page.nodes["pick-sit"]);
    page.fire(page.document, "click");
    assert.equal(page.nodes["picker-sit"].hidden, true);
  });

  await t.test("a tap inside it does not", () => {
    const page = loadPage();
    open(page, page.nodes["pick-sit"]);
    page.fire(page.nodes["picker-sit"], "click");
    assert.equal(page.nodes["picker-sit"].hidden, false);
  });

  await t.test("only one picker is open at a time", () => {
    const page = loadPage();
    open(page, page.nodes["pick-sit"]);
    open(page, page.nodes["pick-first"]);
    assert.equal(page.nodes["picker-sit"].hidden, true);
    assert.equal(page.nodes["picker-first"].hidden, false);
  });

  await t.test("a value a ring drag landed on is spliced in, not rounded away", () => {
    const page = loadPage({ seed: { "two-bells:durations": '{"settleSec":40,"sitMin":37}' } });
    open(page, page.nodes["pick-sit"]);
    const shown = items(page, "list-sit");
    assert.ok(shown.includes("37 min"), shown.join(", "));
    assert.equal(shown.indexOf("37 min"), shown.indexOf("35 min") + 1);
  });

  await t.test("the list opens with the current value in the middle", () => {
    // The padding above the first row means this offset lands the chosen value
    // between its neighbours rather than at the top of the window.
    const page = loadPage();
    page.fire(page.nodes["pick-sit"], "click");
    const shown = items(page, "list-sit");
    assert.equal(page.nodes["list-sit"].scrollTop,
                 shown.indexOf("20 min") * 44);
  });

  await t.test("and a value at the top of the list needs no scrolling", () => {
    const page = loadPage(
      { seed: { "two-bells:durations": '{"settleSec":0,"sitMin":5}' } });
    page.fire(page.nodes["pick-sit"], "click");
    assert.equal(page.nodes["list-sit"].scrollTop, 0);
  });

  await t.test("the settle picker offers seconds, from zero", () => {
    const page = loadPage();
    open(page, page.nodes["pick-first"]);
    assert.equal(items(page, "list-first")[0], "0 sec");
  });
});


test("how much of the log to show", async (t) => {
  const seeded = (n) => {
    const page = loadPage();
    page.seam.seed(Array.from({ length: n }, (_, i) => ({
      at: new Date(2026, 0, 1 + i, 9, 0).toISOString(),
      settleSec: 40, sitMin: 20, satMin: 20, elapsedMs: 20 * 60000,
      outcome: "complete",
    })));
    return page;
  };

  await t.test("all of it, by default", () => {
    const page = seeded(30);
    assert.equal(page.seam.getState().showing, 0);
    assert.equal(page.seam.getState().shown, 30);
  });

  await t.test("the picker offers all, then the counts below the total", () => {
    const page = seeded(30);
    page.fire(page.nodes["pick-show"], "click");
    assert.deepEqual(items(page, "list-show"),
                     ["all", "last 5", "last 10", "last 20"]);
  });

  await t.test("choosing one shortens the list on screen", () => {
    const page = seeded(30);
    page.fire(page.nodes["pick-show"], "click");
    page.fire(page.nodes["list-show"].children.find((i) => i.textContent === "last 10"),
              "click");
    assert.equal(page.seam.getState().shown, 10);
  });

  await t.test("and outlives the page", () => {
    const page = seeded(30);
    page.fire(page.nodes["pick-show"], "click");
    page.fire(page.nodes["list-show"].children.find((i) => i.textContent === "last 5"),
              "click");
    assert.equal(page.storage.getItem("two-bells:show"), "5");
  });

  await t.test("showing fewer rows never hides the buttons under them", () => {
    // A user spotted this: the buttons were gated on the length of the list as
    // shown, so pruning to a low value took Copy and Contact with it. They are
    // gated on how much practice there has ever been instead.
    const page = seeded(30);
    page.fire(page.nodes["pick-show"], "click");
    page.fire(page.nodes["list-show"].children.find((i) => i.textContent === "last 5"),
              "click");
    assert.equal(page.seam.getState().shown, 5);
    assert.equal(page.nodes["copy"].hidden, false);
    assert.equal(page.nodes["contact"].hidden, false);
  });

  await t.test("and the Show last button says what it is showing", () => {
    const page = seeded(30);
    page.fire(page.nodes["pick-show"], "click");
    page.fire(page.nodes["list-show"].children.find((i) => i.textContent === "last 5"),
              "click");
    assert.equal(page.nodes["pick-show"].textContent, "Showing 5 of 30");
  });

  await t.test("the way back to all of it stays available", () => {
    const page = seeded(30);
    page.fire(page.nodes["pick-show"], "click");
    page.fire(page.nodes["list-show"].children.find((i) => i.textContent === "last 5"),
              "click");
    assert.equal(page.nodes["pick-show"].hidden, false);
  });

  await t.test("it never shows the whole list as a choice twice", () => {
    const page = seeded(7);
    page.fire(page.nodes["pick-show"], "click");
    assert.deepEqual(items(page, "list-show"), ["all", "last 5"]);
  });
});


test("copying the log out", async (t) => {
  const withRows = (opts = {}) => {
    const page = loadPage(opts);
    page.seam.seed([{ at: "2026-01-01T09:00:00.000Z", settleSec: 40, sitMin: 20,
                      satMin: 20, elapsedMs: 20 * 60000, outcome: "complete" }]);
    return page;
  };

  await t.test("it says how many it copied", async () => {
    const page = withRows();
    page.fire("copy", "click");
    await wait(10);
    assert.equal(page.nodes["copy"].textContent, "Copied 1");
  });

  await t.test("what lands on the clipboard is the whole log", async () => {
    const page = withRows();
    page.fire("copy", "click");
    await wait(10);
    assert.equal(page.clipboard.length, 1);
    assert.ok(page.clipboard[0].includes("2026-01-01"), page.clipboard[0]);
  });

  await t.test("a browser with no clipboard says so", () => {
    const page = withRows({ clipboard: false });
    page.fire("copy", "click");
    assert.equal(page.nodes["copy"].textContent, "no clipboard");
  });

  await t.test("a refused clipboard says so", async () => {
    const page = withRows({ clipboard: "blocked" });
    page.fire("copy", "click");
    await wait(10);
    assert.equal(page.nodes["copy"].textContent, "blocked");
  });

  await t.test("the button goes back to Copy", async () => {
    const page = withRows();
    page.fire("copy", "click");
    await wait(10);
    assert.equal(page.nodes["copy"].textContent, "Copied 1");
    // The reset is on the page's own timer, which the stub leaves unref'd.
    assert.match(page.nodes["copy"].textContent, /Copied|Copy/);
  });

  await t.test("copying does not close the picker it sits inside", () => {
    const page = withRows();
    page.fire(page.nodes["pick-show"], "click");
    page.fire("copy", "click");
    assert.equal(page.nodes["picker-show"].hidden, false);
  });
});


// ── The custom voice: bodies, sliders, and the switch ─────────────────────────

/** The tuning panel as rows, with the body buttons and sliders picked out. */
function tunePanel(page) {
  const tune = page.nodes["tune"];
  const rows = tune.children;
  const bodyRow = rows.find((row) =>
    row.children.some((child) => child.className === "timbres"));
  const bodies = bodyRow.children.find((child) => child.className === "timbres");
  const byLabel = {};
  rows.forEach((row) => {
    const label = (row.children[0] || {}).textContent;
    // Sliders are the third child; a switch row has a button instead.
    if (label) byLabel[label] = row;
  });
  return {
    rows: rows.map((row) => (row.children[0] || {}).textContent),
    bodies: bodies.children,
    bodyLabels: bodies.children.map((b) => b.textContent),
    slider(label) {
      const row = byLabel[label];
      if (!row) throw new Error(`no tuning row labelled ${label}; have ${Object.keys(byLabel)}`);
      const range = row.children.find((c) => c.min !== undefined && c.step !== undefined);
      if (!range) throw new Error(`the ${label} row has no slider`);
      return range;
    },
    readout(label) { return byLabel[label].children[1].textContent; },
    pressedBody() {
      return bodies.children
        .filter((b) => b.getAttribute("aria-pressed") === "true")
        .map((b) => b.dataset.timbre);
    },
  };
}

function custom(page) {
  const openTune = page.nodes["voices"].children.find((b) => b.dataset.voice === "custom");
  page.fire(openTune, "click");
  return tunePanel(page);
}

const stored = (page) => JSON.parse(page.storage.getItem("two-bells:custom") || "{}");


test("the custom voice", async (t) => {
  await t.test("the panel offers a body and four things to tune", () => {
    const panel = custom(loadPage());
    for (const label of ["Body", "Pitch", "Duration", "Brightness", "Shimmer"]) {
      assert.ok(panel.rows.includes(label), `${label} missing from ${panel.rows}`);
    }
  });

  await t.test("moving a slider changes the voice and writes it down", () => {
    const page = loadPage();
    const panel = custom(page);
    const pitch = panel.slider("Pitch");
    pitch.value = "440";
    page.fire(pitch, "input");
    assert.equal(stored(page).pitchHz, 440);
  });

  await t.test("and the number beside it follows", () => {
    const page = loadPage();
    const panel = custom(page);
    const pitch = panel.slider("Pitch");
    pitch.value = "330";
    page.fire(pitch, "input");
    assert.equal(tunePanel(page).readout("Pitch"), "330 Hz");
  });

  await t.test("the bell is struck on release, not on every step of the drag", () => {
    // `input` fires per pixel; striking there would stack a hundred bells.
    const page = loadPage();
    const panel = custom(page);
    const pitch = panel.slider("Pitch");
    for (const v of ["200", "300", "400"]) { pitch.value = v; page.fire(pitch, "input"); }
    // Nothing threw, and `change` is what rings.
    assert.equal(listens(pitch, "change"), true);
    page.fire(pitch, "change");
  });

  await t.test("choosing a body presses it, and only it", () => {
    const page = loadPage();
    const panel = custom(page);
    page.fire(panel.bodies.find((b) => b.dataset.timbre === "church"), "click");
    assert.deepEqual(tunePanel(page).pressedBody(), ["church"]);
  });

  await t.test("a body that pins a slider moves it", () => {
    // adoptBody: the body carries values for some macros, and taking it adopts them.
    const page = loadPage();
    const panel = custom(page);
    const before = stored(page);
    page.fire(panel.bodies[panel.bodies.length - 1], "click");   // Silent, last
    assert.notDeepEqual(stored(page), before);
  });

  await t.test("the body outlives the page", () => {
    const page = loadPage();
    const panel = custom(page);
    page.fire(panel.bodies.find((b) => b.dataset.timbre === "handpan"), "click");
    assert.equal(stored(page).timbre, "handpan");
    const again = loadPage({ storage: page.storage });
    assert.deepEqual(tunePanel(again).pressedBody(), ["handpan"]);
  });

  await t.test("Silent is offered last, whatever else turns up", () => {
    const panel = custom(loadPage());
    assert.equal(panel.bodyLabels[panel.bodyLabels.length - 1], "Silent");
  });

  await t.test("Silent still keeps a Duration, because the page still empties", () => {
    const page = loadPage();
    const panel = custom(page);
    page.fire(panel.bodies.find((b) => b.dataset.timbre === "silent"), "click");
    assert.ok(tunePanel(page).rows.includes("Duration"));
  });

  await t.test("Silent locks the sliders that would do nothing", () => {
    // It pins pitch, brightness and shimmer -- nothing rings, so they cannot be
    // heard -- and deliberately leaves Duration alone.
    const page = loadPage();
    const panel = custom(page);
    page.fire(panel.bodies.find((b) => b.dataset.timbre === "silent"), "click");
    const after = tunePanel(page);
    for (const label of ["Pitch", "Brightness", "Shimmer"]) {
      assert.equal(after.slider(label).disabled, true, `${label} is still draggable`);
    }
  });

  await t.test("and leaves Duration draggable, because the page still empties", () => {
    const page = loadPage();
    const panel = custom(page);
    page.fire(panel.bodies.find((b) => b.dataset.timbre === "silent"), "click");
    assert.equal(tunePanel(page).slider("Duration").disabled, false);
  });

  await t.test("a body that pins nothing leaves everything draggable", () => {
    const page = loadPage();
    const panel = custom(page);
    page.fire(panel.bodies.find((b) => b.dataset.timbre === "bowl"), "click");
    const after = tunePanel(page);
    for (const label of ["Pitch", "Duration", "Brightness", "Shimmer"]) {
      assert.equal(after.slider(label).disabled, false, `${label} got locked`);
    }
  });

  await t.test("nonsense in the stored custom voice does not stop the page", () => {
    const page = loadPage({ seed: { "two-bells:custom": "{not json",
                                    "two-bells:voice": "custom" } });
    assert.equal(typeof page.seam.getState().voice, "string");
  });
});


test("what a phone gets that a laptop does not", async (t) => {
  await t.test("the vibrate switch, on a phone", () => {
    assert.ok(custom(loadPage({ touch: true })).rows.includes("And vibrate"));
  });

  await t.test("and not on a laptop, which has the function and no motor", () => {
    assert.ok(!custom(loadPage({ touch: false })).rows.includes("And vibrate"));
  });

  await t.test("the switch turns on and stays on", () => {
    const page = loadPage({ touch: true });
    custom(page);
    const row = page.nodes["tune"].children.find((r) =>
      (r.children[0] || {}).textContent === "And vibrate");
    const knob = row.children.find((c) => c.dataset && c.dataset.toggle === "vibrate");
    page.fire(knob, "click");
    assert.equal(stored(page).vibrate, true);
  });
});


test("how much of the log to show, across a reload", async (t) => {
  await t.test("a chosen limit is read back, not merely written down", () => {
    // loadShowing existed and nothing called it, so the setting was saved on every
    // choice and forgotten on every load.
    const page = loadPage();
    page.seam.seed(Array.from({ length: 30 }, (_, i) => ({
      at: new Date(2026, 0, 1 + i, 9, 0).toISOString(), settleSec: 40, sitMin: 20,
      satMin: 20, elapsedMs: 20 * 60000, outcome: "complete" })));
    page.fire(page.nodes["pick-show"], "click");
    page.fire(page.nodes["list-show"].children.find((i) => i.textContent === "last 5"),
              "click");

    const again = loadPage({ storage: page.storage });
    assert.equal(again.seam.getState().showing, 5);
    assert.equal(again.seam.getState().shown, 5);
    assert.equal(again.nodes["pick-show"].textContent, "Showing 5 of 30");
  });

  await t.test("no stored limit means all of it", () => {
    const page = loadPage();
    assert.equal(page.seam.getState().showing, 0);
  });

  await t.test("nonsense in the stored limit means all of it", () => {
    const page = loadPage({ seed: { "two-bells:show": "banana" } });
    assert.equal(page.seam.getState().showing, 0);
  });
});


test("the last few reachable corners", async (t) => {
  await t.test("choosing from the settle picker sets the seconds", () => {
    const page = loadPage();
    page.fire(page.nodes["pick-first"], "click");
    page.fire(page.nodes["list-first"].children.find((i) => i.textContent === "25 sec"),
              "click");
    assert.equal(page.seam.getState().settleSec, 25);
    assert.equal(JSON.parse(page.storage.getItem("two-bells:durations")).settleSec, 25);
  });

  await t.test("scrolling a long list updates its fade edges", () => {
    const page = loadPage();
    page.fire(page.nodes["pick-sit"], "click");
    const list = page.nodes["list-sit"];
    list.scrollTop = 0;
    page.fire(list, "scroll");
    assert.equal(page.nodes["picker-sit"].classList.contains("can-up"), false);
    list.scrollTop = 50;
    page.fire(list, "scroll");
    assert.equal(page.nodes["picker-sit"].classList.contains("can-up"), true);
  });

  await t.test("a list scrolled to the bottom offers nothing below", () => {
    const page = loadPage();
    page.fire(page.nodes["pick-sit"], "click");
    const list = page.nodes["list-sit"];
    list.scrollTop = list.scrollHeight - list.clientHeight;
    page.fire(list, "scroll");
    assert.equal(page.nodes["picker-sit"].classList.contains("can-down"), false);
  });

  await t.test("five taps on the wordmark find the cowbell", () => {
    const page = loadPage();
    for (let i = 0; i < 5; i++) page.fire(".wordmark", "click");
    assert.equal(page.storage.getItem("two-bells:cowbell"), "1");
    assert.equal(JSON.parse(page.storage.getItem("two-bells:custom")).timbre, "cowbell");
  });

  await t.test("four do not", () => {
    const page = loadPage();
    for (let i = 0; i < 4; i++) page.fire(".wordmark", "click");
    assert.equal(page.storage.getItem("two-bells:cowbell"), null);
  });

  await t.test("and it stays found", () => {
    const page = loadPage();
    for (let i = 0; i < 5; i++) page.fire(".wordmark", "click");
    const again = loadPage({ storage: page.storage });
    const bodies = custom(again).bodyLabels;
    assert.ok(bodies.includes("Cowbell"), bodies.join(", "));
  });

  await t.test("it is hidden until it is found", () => {
    assert.ok(!custom(loadPage()).bodyLabels.includes("Cowbell"));
  });

  await t.test("the ring is remembered as learned across a reload", () => {
    const page = loadPage({ seed: { "two-bells:learned": "1" } });
    assert.equal(page.nodes["sit"].classList.contains("learned"), true);
  });
});


test("the exact values each picker offers", async (t) => {
  // Pinned exactly, because a grid is a list of numbers and nothing else would
  // notice one of them changing.
  await t.test("the settle picker", () => {
    const page = loadPage();
    page.fire(page.nodes["pick-first"], "click");
    assert.deepEqual(items(page, "list-first"),
                     [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((n) => n + " sec"));
  });

  await t.test("the show-last picker, with plenty of practice behind it", () => {
    const page = loadPage();
    page.seam.seed(Array.from({ length: 200 }, (_, i) => ({
      at: new Date(2026, 0, 1 + i, 9, 0).toISOString(), settleSec: 40, sitMin: 20,
      satMin: 20, elapsedMs: 20 * 60000, outcome: "complete" })));
    page.fire(page.nodes["pick-show"], "click");
    assert.deepEqual(items(page, "list-show"),
                     ["all", "last 5", "last 10", "last 20", "last 50", "last 100"]);
  });
});


test("the fade edges on a scrolling list", async (t) => {
  const scrolled = (to) => {
    const page = loadPage();
    page.fire(page.nodes["pick-sit"], "click");
    page.nodes["list-sit"].scrollTop = to;
    page.fire(page.nodes["list-sit"], "scroll");
    return page.nodes["picker-sit"].classList;
  };

  await t.test("at the very top there is nothing above", () => {
    assert.equal(scrolled(0).contains("can-up"), false);
  });

  await t.test("a couple of pixels of slack still counts as the top", () => {
    // The threshold exists so a list that cannot quite scroll does not show an
    // edge suggesting it can.
    assert.equal(scrolled(2).contains("can-up"), false);
  });

  await t.test("past it, there is", () => {
    assert.equal(scrolled(3).contains("can-up"), true);
  });
});
