// The check that came first, and is still the one that matters most: does the
// page's script finish running at all?
//
// Written after a patch silently deleted begin/tick/loop/finish. The file still
// parsed, `node --check` was happy, and the page loaded -- then threw at wiring
// time and left no voices, no pickers and unpositioned rings. Nothing about it
// looked broken until you tried to use it.
const test = require("node:test");
const assert = require("node:assert");
const { loadPage, listens } = require("./stub_dom");

test("the page wires itself up", async (t) => {
  const { nodes } = loadPage();
  const wired = (id, event) => listens(nodes[id], event);

  await t.test("the voices are built and named", () => {
    const voices = nodes["voices"];
    assert.equal(voices.children.map((c) => c.textContent).join(","),
                 "Bowl,Chime,Custom");
  });

  for (const id of ["pick-first", "pick-sit"]) {
    await t.test(`${id} shows a value and opens on a tap`, () => {
      assert.match(nodes[id].textContent, /\d/);
      assert.ok(wired(id, "click"));
    });
  }

  for (const id of ["grip-sit", "grip-first", "halo-sit", "halo-first"]) {
    await t.test(`${id} is placed on its ring`, () => {
      const at = nodes[id].attrs.cx;
      assert.ok(at !== undefined && at !== "0", `cx=${at}`);
    });
  }

  for (const id of ["arc-sit", "arc-first"]) {
    await t.test(`${id} is drawn to its duration`, () => {
      assert.notEqual(nodes[id].style.strokeDashoffset, undefined);
    });
  }

  await t.test("Begin and the rings listen", () => {
    assert.ok(wired("start", "click"));
    assert.ok(wired("rings", "pointerdown"));
  });

  await t.test("the seam is there for the tests that need it", () => {
    assert.equal(typeof global.window.__twobells.getState, "function");
    assert.equal(typeof global.window.__twobells.hurry, "function");
  });
});

test("what the page opens on", async (t) => {
  await t.test("forty seconds to settle, twenty minutes to sit", () => {
    const { seam } = loadPage();
    assert.deepEqual([seam.getState().settleSec, seam.getState().sitMin], [40, 20]);
  });

  await t.test("durations already chosen are restored", () => {
    const { seam } = loadPage({ seed: {
      "two-bells:durations": JSON.stringify({ settleSec: 15, sitMin: 45 }) } });
    assert.deepEqual([seam.getState().settleSec, seam.getState().sitMin], [15, 45]);
  });

  await t.test("and a stored duration outside the dial is pulled back onto it", () => {
    // A value saved when the ranges were 0-55 and 5-60 would otherwise put a
    // handle somewhere the ring does not go.
    const { seam } = loadPage({ seed: {
      "two-bells:durations": JSON.stringify({ settleSec: 999, sitMin: 0 }) } });
    assert.deepEqual([seam.getState().settleSec, seam.getState().sitMin], [59, 1]);
  });
});
