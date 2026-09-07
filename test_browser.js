// The tier that needs a real browser: pointer gestures on SVG, CSS transitions
// running in real time, layout at a real width. Everything here failed at least
// once during the day this page was built, and every one of those failures was
// invisible to node.
//
// Driven through chromectl (an internal Playwright wrapper living in the
// analysis_and_visualization checkout). It is not vendored here and not on npm, so
// this file skips itself when chromectl has not been built rather than failing:
// the node tier is what a stranger cloning this repo can run.
//
//   CHROMECTL=/path/to/tools/chromectl node --test test_browser.js
const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CHROMECTL = process.env.CHROMECTL || path.join(
  os.homedir(), "dev/summer_robotics/analysis_and_visualization/tools/chromectl");
const CLI = path.join(CHROMECTL, "dist/cli.js");
const PAGE = "file://" + path.join(__dirname, "index.html");
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "twobells-browser-"));

const REASON = fs.existsSync(CLI) ? null
  : `chromectl not built at ${CLI} -- npm install && npm run build there, or set CHROMECTL`;

// Passed as the options object, and omitted entirely when there is no reason to
// skip: node:test reads the mere presence of a `skip` key as a skip, so
// `{ skip: null }` marks the suite skipped while its subtests run and pass. A
// green run that reports SKIP is the kind of thing you only notice too late.
const SUITE = REASON ? { skip: REASON } : {};

// One browser per case: chromectl is one-shot by design, and a fresh page is also
// a fresh localStorage, which is the isolation these tests want anyway.
function inPage(body, { size = "390x844" } = {}) {
  const expr = `(async () => {\n${body}\n})()`;
  execFileSync("node", [CLI, PAGE, "--size", size, "--eval", expr, "--out", OUT], {
    encoding: "utf8",
    env: { PLAYWRIGHT_BROWSERS_PATH: path.join(os.homedir(), ".cache/ms-playwright"),
           ...process.env },
  });
  return JSON.parse(fs.readFileSync(path.join(OUT, "eval.json"), "utf8"));
}

// Shared preamble: the seam, a sleep, and the page's own controls.
const PRELUDE = `
  const seam = window.__twobells;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (id) => document.getElementById(id);
  const opacityOf = (sel) => Number(getComputedStyle(document.querySelector(sel)).opacity);
  const setDurations = (first, sit) => {
    $("rng-first").value = String(first);
    $("rng-sit").value = String(sit);
  };
`;

const run = (body, options) => inPage(PRELUDE + body, options);

test("a sit, start to finish", SUITE, async (t) => {
  await t.test("runs through settle, sitting and into its rest", () => {
    const seen = run(`
      const phases = [];
      setDurations(30, 20);
      $("start").click();
      phases.push($("sit").dataset.phase);
      // A sit that takes as long as a sit is a test nobody runs twice.
      seam.hurry({ bellIn: 150, endIn: 500 });
      await wait(300);
      phases.push($("sit").dataset.phase);
      await wait(400);
      phases.push($("sit").dataset.phase);
      return { phases, state: seam.getState() };
    `);
    // Not idle: a finished sit rests for half a minute before it resets.
    assert.deepEqual(seen.phases, ["waiting", "sitting", "complete"]);
    assert.equal(seen.state.rows, 1);
    assert.equal(seen.state.totals.sits, 1);
  });

  await t.test("says what leaving would mean at each point", () => {
    const seen = run(`
      const labels = [];
      setDurations(30, 20);
      $("start").click();
      labels.push($("cancel").textContent);
      seam.hurry({ bellIn: 100, endIn: 60000 });
      await wait(250);
      labels.push($("cancel").textContent);
      return labels;
    `);
    // Nothing has started yet, so it is a way back; afterwards it ends a sit.
    assert.deepEqual(seen, ["Oops, never mind", "End Now"]);
  });

  await t.test("does not record walking away during the settle", () => {
    const seen = run(`
      setDurations(30, 20);
      $("start").click();
      $("cancel").click();
      return seam.getState();
    `);
    assert.equal(seen.rows, 0);
    assert.equal(seen.totals.sits, 0);
  });
});

test("the page empties over the bell and fills back over the last one",
     SUITE, async (t) => {
  await t.test("the legend goes as the first bell rings, and stays gone", () => {
    // Sampled as it moves rather than at a fixed threshold: the fade lasts as long
    // as the bell, which is eight seconds for the bowl and six for the chime, and a
    // test that picks a number has to be edited every time a voice is retuned.
    //
    // It does not come back at the closing bell any more -- the half minute after
    // a sit belongs to the sit. What fills back in over that bell is the log.
    const seen = run(`
      const legend = () => opacityOf(".legend");
      seam.internals.setNoteLinger(20000);
      setDurations(0, 20);
      $("start").click();
      seam.hurry({ bellIn: 0, endIn: 3000 });
      await wait(600);
      const fade = getComputedStyle($("sit")).getPropertyValue("--bell-fade").trim();
      const leaving = [legend()];
      await wait(1800);
      leaving.push(legend());
      await wait(1200);                       // the closing bell has rung
      const logFilling = [opacityOf(".log")];
      const legendAfter = legend();
      await wait(2500);
      logFilling.push(opacityOf(".log"));
      return { fade, leaving, logFilling, legendAfter, phase: $("sit").dataset.phase };
    `);
    assert.equal(seen.fade, "8s");
    assert.ok(seen.leaving[1] < seen.leaving[0],
              `legend not fading: ${seen.leaving.join(" -> ")}`);
    assert.equal(seen.phase, "complete");
    assert.ok(seen.legendAfter < 0.4, `legend at ${seen.legendAfter}`);
    assert.ok(seen.logFilling[1] > seen.logFilling[0],
              `log not filling: ${seen.logFilling.join(" -> ")}`);
  });

  await t.test("the settle ring vanishes rather than fading", () => {
    const seen = run(`
      setDurations(30, 20);
      $("start").click();
      const before = opacityOf(".arc-settle");
      seam.hurry({ bellIn: 0, endIn: 60000 });
      await wait(120);
      // Gone within a frame or two: by the bell it has finished counting and a
      // ring that lingers reads as one that still means something.
      return { before, after: opacityOf(".arc-settle") };
    `);
    assert.equal(seen.before, 1);
    assert.equal(seen.after, 0);
  });

  await t.test("the half minute after is still the sit, and resets itself", () => {
    // Everything is inert while the words say Sit complete, Begin included: there
    // is nothing left to end and nobody starts another one this soon. The log is
    // the exception -- a row was just added to it.
    const seen = run(`
      const op = (sel) => Number(getComputedStyle(document.querySelector(sel)).opacity);
      seam.internals.setNoteLinger(12000);
      setDurations(0, 20);
      $("start").click();
      seam.hurry({ bellIn: 0, endIn: 9000 });
      await wait(9200);
      await wait(9000);                       // past the closing bell's own fade
      const resting = { phase: $("sit").dataset.phase, legend: op(".legend"),
                        log: op(".log"), controls: op(".controls"), rings: op("#rings"),
                        beginLive: getComputedStyle(document.querySelector(".controls"))
                                     .pointerEvents !== "none" };
      await wait(3800);
      const after = { phase: $("sit").dataset.phase, legend: op(".legend"),
                      note: $("note").innerHTML,
                      beginLive: getComputedStyle(document.querySelector(".controls"))
                                   .pointerEvents !== "none" };
      return { resting, after };
    `);
    assert.equal(seen.resting.phase, "complete");
    assert.equal(seen.resting.legend, 0);
    assert.ok(seen.resting.log > 0.3 && seen.resting.log < 0.8,
              `log at ${seen.resting.log}`);
    assert.ok(seen.resting.controls > 0 && seen.resting.controls < 1,
              `controls at ${seen.resting.controls}`);
    assert.ok(seen.resting.rings < 0.5, `rings at ${seen.resting.rings}`);
    assert.equal(seen.resting.beginLive, false);

    // And it comes back without being asked.
    assert.equal(seen.after.phase, "idle");
    assert.equal(seen.after.note, "Settle<br>then begin");
    assert.ok(seen.after.legend > 0.7, `legend at ${seen.after.legend}`);
    assert.equal(seen.after.beginLive, true);
  });

  await t.test("'Sit complete' settles back to the resting words", () => {
    const seen = run(`
      seam.internals.setNoteLinger(300);
      setDurations(0, 20);
      $("start").click();
      seam.hurry({ bellIn: 0, endIn: 100 });
      await wait(250);
      const acknowledged = $("note").innerHTML;
      await wait(1200);
      return { acknowledged, resting: $("note").innerHTML };
    `);
    assert.equal(seen.acknowledged, "Sit complete");
    assert.equal(seen.resting, "Settle<br>then begin");
  });
});

test("a tuned bell is not lost by trying another", SUITE, async (t) => {
  // Tuned the way a person tunes it: the stored copy only exists because a slider
  // moved, and seeding storage after load would be overwritten by the in-memory one.
  const TUNE_RING_TO_THREE = `
    const pick = (id) => document.querySelector('[data-voice="' + id + '"]').click();
    pick("custom");
    await wait(80);
    // By its label. Picking it by range or step matched Brightness instead and the
    // test went green against a slider nobody had asked about.
    const row = Array.from(document.querySelectorAll(".tune .tune-row"))
                     .find((r) => r.querySelector(".dial-label").textContent === "Duration");
    if (!row) throw new Error("no Duration slider in the tuning panel");
    const ring = row.querySelector(".slider");
    ring.value = "3";
    ring.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(80);
  `;

  await t.test("switching to a preset leaves the custom settings alone", () => {
    const seen = run(TUNE_RING_TO_THREE + `
      const tuned = JSON.parse(localStorage.getItem("two-bells:custom"));
      pick("bowl");
      await wait(80);
      return { tuned, afterSwitch: JSON.parse(localStorage.getItem("two-bells:custom")),
               chosen: localStorage.getItem("two-bells:voice") };
    `);
    assert.equal(seen.chosen, "bowl");
    assert.deepEqual(seen.afterSwitch, seen.tuned);
  });

  await t.test("and it still rings for as long as it was tuned to on the way back", () => {
    // The fade is set from the voice's own decay, so the page says which bell it
    // thinks it is ringing without anyone having to listen to it.
    const seen = run(TUNE_RING_TO_THREE + `
      const ringWas = JSON.parse(localStorage.getItem("two-bells:custom")).durationSec;
      pick("bowl");
      await wait(80);
      pick("custom");
      await wait(80);
      setDurations(0, 20);
      $("start").click();
      seam.hurry({ bellIn: 0, endIn: 60000 });
      await wait(150);
      return { ringWas, voice: seam.getState().voice,
               fade: getComputedStyle($("sit")).getPropertyValue("--bell-fade").trim() };
    `);
    assert.equal(seen.ringWas, 3);
    assert.equal(seen.voice, "custom");
    assert.equal(seen.fade, "3s");
  });
});

test("Silent is a body, not a switch", SUITE, async (t) => {
  const OPEN_PANEL = `
    document.querySelector('[data-voice="custom"]').click();
    await wait(100);
    const rowFor = (label) => Array.from(document.querySelectorAll(".tune .tune-row"))
      .find((r) => r.querySelector(".dial-label").textContent === label);
  `;

  await t.test("it is in the body picker, and no row of its own", () => {
    const seen = run(OPEN_PANEL + `
      return { bodies: Array.from(document.querySelectorAll(".timbre[data-timbre]"))
                            .map((b) => b.textContent),
               rows: Array.from(document.querySelectorAll(".tune .tune-row"))
                          .map((r) => r.querySelector(".dial-label").textContent) };
    `);
    assert.ok(seen.bodies.includes("Silent"), seen.bodies.join(", "));
    assert.ok(!seen.rows.includes("Silent"), seen.rows.join(" | "));
    // A headless Chrome is a laptop: navigator.vibrate exists and moves nothing.
    // Which device gets that row is settled in test_logic.js.
    assert.ok(!seen.rows.includes("And vibrate"), seen.rows.join(" | "));
  });

  await t.test("choosing it leaves Duration live and the rest dimmed", () => {
    // How long the page takes to empty is a real choice even when nothing sounds.
    const seen = run(OPEN_PANEL + `
      document.querySelector('[data-timbre="silent"]').click();
      await wait(150);
      const state = {};
      Array.from(document.querySelectorAll(".tune .tune-row")).forEach((r) => {
        const slider = r.querySelector(".slider");
        if (slider) state[r.querySelector(".dial-label").textContent] = slider.disabled;
      });
      return state;
    `);
    assert.equal(seen.Duration, false);
    assert.equal(seen.Pitch, true);
    assert.equal(seen.Brightness, true);
    assert.equal(seen.Shimmer, true);
  });

  await t.test("a silent bell still empties the page and still ends the sit", () => {
    const seen = run(OPEN_PANEL + `
      document.querySelector('[data-timbre="silent"]').click();
      await wait(150);
      setDurations(0, 20);
      $("start").click();
      seam.hurry({ bellIn: 0, endIn: 400 });
      await wait(200);
      const mid = { fade: getComputedStyle($("sit")).getPropertyValue("--bell-fade").trim(),
                    legend: opacityOf(".legend") };
      await wait(500);
      return { mid, rows: seam.getState().rows, phase: $("sit").dataset.phase,
               voice: seam.getState().voice };
    `);
    assert.notEqual(seen.mid.fade, "600ms");
    assert.ok(seen.mid.legend < 1, `legend at ${seen.mid.legend}`);
    assert.equal(seen.phase, "complete");
    assert.equal(seen.rows, 1);
  });
});

test("more cowbell", SUITE, async (t) => {
  const bodies = `Array.from(document.querySelectorAll(".timbre[data-timbre]")).map((b) => b.textContent)`;

  await t.test("is not on the menu", () => {
    const seen = run(`
      document.querySelector('[data-voice="custom"]').click();
      await wait(100);
      return ${bodies};
    `);
    assert.ok(!seen.includes("Cowbell"), seen.join(", "));
  });

  await t.test("nor after a couple of idle taps", () => {
    const seen = run(`
      document.querySelector('[data-voice="custom"]').click();
      await wait(100);
      const wm = document.querySelector(".wordmark");
      for (let i = 0; i < 3; i++) { wm.click(); await wait(30); }
      await wait(150);
      return ${bodies};
    `);
    assert.ok(!seen.includes("Cowbell"), seen.join(", "));
  });

  await t.test("and it insists on being short and still", () => {
    // A cowbell that rings for ten seconds is a different instrument and not a
    // funny one, so picking the body drags Duration and Shimmer with it.
    const seen = run(`
      const wm = document.querySelector(".wordmark");
      for (let i = 0; i < 5; i++) { wm.click(); await wait(30); }
      await wait(250);
      const sliderFor = (label) => Array.from(document.querySelectorAll(".tune .tune-row"))
        .find((r) => r.querySelector(".dial-label").textContent === label)
        .querySelector(".slider").value;
      const pinned = { duration: sliderFor("Duration"), shimmer: sliderFor("Shimmer"),
                       bright: sliderFor("Brightness") };

      // Back to a body that pins nothing, then to the cowbell again by hand.
      document.querySelector('[data-timbre="church"]').click();
      await wait(120);
      const loosened = { duration: sliderFor("Duration"), shimmer: sliderFor("Shimmer") };
      document.querySelector('[data-timbre="church"]').parentElement
              .querySelector('[data-timbre="cowbell"]').click();
      await wait(120);
      return { pinned, loosened, again: { duration: sliderFor("Duration"), shimmer: sliderFor("Shimmer"),
                                          bright: sliderFor("Brightness") },
               stored: JSON.parse(localStorage.getItem("two-bells:custom")) };
    `);
    assert.deepEqual(seen.pinned, { duration: "1.25", shimmer: "0", bright: "0" });
    assert.deepEqual(seen.again, { duration: "1.25", shimmer: "0", bright: "0" });
    assert.equal(seen.stored.durationSec, 1.25);
    assert.equal(seen.stored.shimmerPct, 0);
    assert.equal(seen.stored.brightPct, 0);
  });

  await t.test("and the fade follows it, so the page snaps back", () => {
    const seen = run(`
      const wm = document.querySelector(".wordmark");
      for (let i = 0; i < 5; i++) { wm.click(); await wait(30); }
      await wait(250);
      setDurations(0, 20);
      $("start").click();
      seam.hurry({ bellIn: 0, endIn: 60000 });
      await wait(150);
      return getComputedStyle($("sit")).getPropertyValue("--bell-fade").trim();
    `);
    assert.equal(seen, "1.25s");
  });

  await t.test("but five taps finds it, and it stays found", () => {
    const seen = run(`
      const wm = document.querySelector(".wordmark");
      for (let i = 0; i < 5; i++) { wm.click(); await wait(30); }
      await wait(250);
      return { bodies: ${bodies},
               timbre: JSON.parse(localStorage.getItem("two-bells:custom")).timbre,
               unlocked: localStorage.getItem("two-bells:cowbell"),
               title: wm.title,
               voice: seam.getState().voice };
    `);
    assert.ok(seen.bodies.includes("Cowbell"), seen.bodies.join(", "));
    // Straight to it, and struck: an egg you have to go and find twice is one
    // nobody finds once.
    assert.equal(seen.timbre, "cowbell");
    assert.equal(seen.voice, "custom");
    assert.equal(seen.unlocked, "1");
    assert.equal(seen.title, "Now with more cowbell.");
  });
});

test("the rings are the control", SUITE, async (t) => {
  await t.test("dragging the meditation handle changes the duration", () => {
    const seen = run(`
      setDurations(30, 20);
      const before = seam.getState().sitMin;
      const rings = $("rings").getBoundingClientRect();
      const cx = rings.left + rings.width / 2;
      const cy = rings.top + rings.height / 2;
      // A quarter turn clockwise from twelve, on the outer ring.
      const r = rings.width * 0.40;
      const send = (type, x, y) => $("rings").dispatchEvent(new PointerEvent(type, {
        clientX: x, clientY: y, bubbles: true, pointerId: 1, isPrimary: true }));
      send("pointerdown", cx, cy - r);
      window.dispatchEvent(new PointerEvent("pointermove", {
        clientX: cx + r, clientY: cy, bubbles: true, pointerId: 1, isPrimary: true }));
      window.dispatchEvent(new PointerEvent("pointerup", {
        clientX: cx + r, clientY: cy, bubbles: true, pointerId: 1, isPrimary: true }));
      return { before, after: seam.getState().sitMin };
    `);
    assert.notEqual(seen.after, seen.before);
  });

  await t.test("the handle is what the pointer finds, not the text over it", () => {
    // Three wrong fixes went by before elementFromPoint said the centre overlay
    // was swallowing every press. The overlay is still there; it must stay inert.
    const seen = run(`
      const rings = $("rings").getBoundingClientRect();
      const at = document.elementFromPoint(rings.left + rings.width / 2,
                                           rings.top + rings.height / 2);
      const note = getComputedStyle(document.querySelector(".ring-centre"));
      return { hitClass: at ? at.getAttribute("class") : null,
               centreEvents: note.pointerEvents };
    `);
    assert.equal(seen.centreEvents, "none");
    assert.notEqual(seen.hitClass, "ring-centre");
  });
});

test("the log and its tools", SUITE, async (t) => {
  await t.test("shows fewer rows without losing any", () => {
    const seen = run(`
      const rows = () => document.querySelectorAll(".log .sit-row").length;
      const stored = () => JSON.parse(localStorage.getItem("two-bells:log")).length;
      const at = Date.now();
      seam.seed(Array.from({ length: 40 }, (_, i) => ({
        at: new Date(at - i * 3600000).toISOString(),
        settleSec: 30, sitMin: 20, satMin: 20, elapsedMs: 1230000, outcome: "complete" })));
      const all = { rows: rows(), stored: stored() };
      $("pick-show").click();
      await wait(120);
      Array.from(document.querySelectorAll("#list-show .picker-item"))
           .find((el) => el.textContent.trim() === "last 10").click();
      await wait(120);
      return { all, limited: { rows: rows(), stored: stored(),
                               label: $("pick-show").textContent } };
    `);
    assert.deepEqual(seen.all, { rows: 40, stored: 40 });
    assert.equal(seen.limited.rows, 10);
    assert.equal(seen.limited.stored, 40);
    assert.equal(seen.limited.label, "Showing 10 of 40");
  });

  await t.test("the show-list opens upward, inside the document", () => {
    // It sits at the foot of the page; centred on its button, half of it hung
    // past the bottom edge and grew the document to match.
    const seen = run(`
      const at = Date.now();
      seam.seed(Array.from({ length: 8 }, (_, i) => ({
        at: new Date(at - i * 3600000).toISOString(),
        settleSec: 30, sitMin: 20, satMin: 20, elapsedMs: 1230000, outcome: "complete" })));
      $("pick-show").click();
      await wait(150);
      const picker = $("picker-show").getBoundingClientRect();
      const button = $("pick-show").getBoundingClientRect();
      return { opensUpward: picker.bottom <= button.top + 1,
               bottom: picker.bottom + window.scrollY,
               documentHeight: document.documentElement.scrollHeight };
    `);
    assert.ok(seen.opensUpward, "picker is not above its button");
    assert.ok(seen.bottom <= seen.documentHeight + 1,
              `picker reaches ${seen.bottom} of ${seen.documentHeight}`);
  });

  await t.test("Copy puts the whole log on the clipboard", () => {
    const seen = run(`
      let copied = "";
      // readText is denied to a headless page, so the write side is what we watch.
      navigator.clipboard.writeText = (text) => { copied = text; return Promise.resolve(); };
      const at = Date.now();
      seam.seed(Array.from({ length: 8 }, (_, i) => ({
        at: new Date(at - i * 3600000).toISOString(),
        settleSec: 30, sitMin: 20, satMin: 20, elapsedMs: 1230000, outcome: "complete" })));
      $("copy").click();
      await wait(150);
      const lines = copied.split("\\n");
      return { header: lines[0], dataRows: lines.filter((l) => /^\\d{4}-/.test(l)).length,
               tail: lines.slice(-2) };
    `);
    assert.equal(seen.header, "date\ttime\tsettle_sec\tset_min\tsat_min\toutcome");
    assert.equal(seen.dataRows, 8);
    assert.deepEqual(seen.tail, ["total_sits\t8", "total_min\t160"]);
  });
});

test("layout on the narrowest phone still sold", SUITE, async (t) => {
  await t.test("the settle exit stays on one line", () => {
    // "Oops, never mind" wraps at 320px unless its padding is tighter than Begin's.
    const seen = run(`
      setDurations(30, 20);
      $("start").click();
      const box = $("cancel").getBoundingClientRect();
      return { height: Math.round(box.height),
               overflows: document.documentElement.scrollWidth > window.innerWidth };
    `, { size: "320x780" });
    assert.ok(seen.height < 70, `button is ${seen.height}px tall, so it wrapped`);
    assert.equal(seen.overflows, false);
  });
});
