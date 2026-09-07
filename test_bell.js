// What the bell actually plays.
//
// This tier could not exist while the stub set AudioContext on the global object
// and the page read it off `window`: `audio` stayed null, strike() returned at its
// guard, and roughly two hundred lines -- the whole synthesis path plus every
// timbre table feeding it -- never ran in any test. mutate.js recorded those as
// survivors that "no test tier can hear", which was the wrong diagnosis: the stub
// is not deaf, it was disconnected.
//
// A struck bell is a set of oscillator frequencies and decay times. Nothing here
// listens to anything; it asserts the numbers.
const test = require("node:test");
const assert = require("node:assert");
const { loadPage } = require("./stub_dom");

/** Ring the bell by choosing a voice, and report what was played. */
function struck(voiceId, opts = {}) {
  const page = loadPage(opts);
  const button = page.nodes["voices"].children.find((b) => b.dataset.voice === voiceId);
  page.fire(button, "click");
  return { page, played: page.played };
}

/** Ring the custom voice with one of the bodies chosen. */
function body(timbre) {
  const page = loadPage();
  const custom = page.nodes["voices"].children.find((b) => b.dataset.voice === "custom");
  page.fire(custom, "click");
  const bodies = page.nodes["tune"].children
    .find((row) => row.children.some((c) => c.className === "timbres"))
    .children.find((c) => c.className === "timbres");
  page.played.tones.length = 0;
  page.fire(bodies.children.find((b) => b.dataset.timbre === timbre), "click");
  return page;
}

/** The shortest bell the sliders can make: a hard-damped body at half a second. */
function shortest() {
  const page = body("marimba");
  const duration = page.nodes["tune"].children
    .map((row) => row.children.find((c) => c.min !== undefined && c.step !== undefined))
    .find((range) => range && range.getAttribute("aria-label") === "Duration");
  duration.value = String(duration.min);
  page.fire(duration, "input");
  page.played.tones.length = 0;
  page.fire(duration, "change");
  return page;
}

const pitches = (played) =>
  [...new Set(played.tones.map((t) => Math.round(t.hz)))].sort((a, b) => a - b);

/** The lowest tone, which is the fundamental. */
const fundamental = (played) => pitches(played)[0];

/** The ratio of each partial to the fundamental.
 *
 * Averaged over the detuned pair, not read off one of them: each partial is two
 * oscillators a few cents either side of the nominal ratio, so a single tone is
 * never at it. The detune is symmetric, so the mean is.
 */
const ratios = (played) => {
  // Grouped and averaged BEFORE dividing. Dividing by the lowest tone divides by
  // the detuned-down half of the fundamental, which inflates every ratio by the
  // detune -- enough to move 5.15 to 5.159 and hide a real change.
  const lowest = Math.min(...played.tones.map((t) => t.hz));
  const groups = new Map();
  for (const tone of played.tones) {
    const key = Math.round(tone.hz / lowest * 10) / 10;
    groups.set(key, (groups.get(key) || []).concat(tone.hz));
  }
  const means = [...groups.values()]
    .map((pair) => pair.reduce((a, b) => a + b, 0) / pair.length)
    .sort((a, b) => a - b);
  return means.map((hz) => hz / means[0]);
};


test("a struck bowl", async (t) => {
  await t.test("it plays something", () => {
    assert.ok(struck("bowl").played.tones.length > 0);
  });

  await t.test("its fundamental is the voice's own pitch", () => {
    // Bowl is defined at 210 Hz. A test that read the number out of the page
    // would agree with any number at all.
    assert.equal(fundamental(struck("bowl").played), 210);
  });

  await t.test("and the chime's is a different one", () => {
    assert.equal(fundamental(struck("chime").played), 440);
  });

  await t.test("the partials are inharmonic, which is what makes it a bowl", () => {
    // 1 : 2.68 : 5.15 : 8.40 -- measured ratios, not integer harmonics. An
    // integer series is an organ pipe, and sounds like one.
    const found = ratios(struck("bowl").played);
    for (const wanted of [1, 2.68, 5.15, 8.4]) {
      assert.ok(found.some((r) => Math.abs(r - wanted) < 0.005),
                `${wanted} missing from ${found.join(", ")}`);
    }
  });

  await t.test("each partial is a beating pair, a few cents apart", () => {
    // Two oscillators per partial, detuned against each other, which is what
    // stops it sounding like a sine wave.
    const played = struck("bowl").played;
    assert.equal(played.tones.length, 8);
    const exact = new Set(played.tones.map((t) => t.hz));
    assert.equal(exact.size, 8, "some pair is not detuned");
  });

  await t.test("higher partials die first", () => {
    // By `damping`: the top of a real bell goes before the bottom.
    const played = struck("bowl").played;
    const byPitch = [...played.tones].sort((a, b) => a.hz - b.hz);
    const lowest = byPitch[0].until;
    const highest = byPitch[byPitch.length - 1].until;
    assert.ok(highest < lowest, `top rang ${highest}s, bottom ${lowest}s`);
  });

  await t.test("how much faster the top dies is what damping means", () => {
    // Not just "sooner": the ring lengths follow ratio^-damping, so the 8.40
    // partial of a bowl lasts 8.40^-0.95 of the fundamental -- about an eighth.
    // "Sooner" alone holds at any damping at all and pins nothing.
    const played = struck("bowl").played;
    const byPitch = [...played.tones].sort((a, b) => a.hz - b.hz);
    const share = byPitch[byPitch.length - 1].until / byPitch[0].until;
    assert.ok(Math.abs(share - Math.pow(8.4, -0.95)) < 0.02,
              `the top partial rang for ${(share * 100).toFixed(1)}% of the bottom`);
  });

  await t.test("and none of them rings for less than a moment", () => {
    // The floor under the decay. Neither a bowl nor a hard-damped body at the
    // default length reaches it, so it has to be asked of the shortest bell the
    // sliders can make: half a second on Marimba puts the 9.2 partial under 5ms.
    for (const tone of shortest().played.tones) {
      assert.ok(tone.until > 0.1, `a partial rang for ${tone.until}s`);
    }
  });

  await t.test("and that bell really does reach the floor", () => {
    // Otherwise the assertion above passes on a bell that never needed it.
    const played = shortest().played;
    const briefest = Math.min(...played.tones.map((t) => t.until));
    assert.ok(briefest < 0.18, `the briefest partial rang ${briefest}s`);
  });

  await t.test("the strike itself is a band of noise at the moment of contact", () => {
    // Without it the tone fades up rather than being struck.
    assert.ok(struck("bowl").played.noises.length > 0);
  });

  await t.test("the brightness envelope sweeps down over the strike", () => {
    // The top end belongs to the impact, not to the ring after it.
    const filters = struck("bowl").played.filters;
    const set = filters.find((f) => f.set !== undefined);
    const ramp = filters.find((f) => f.ramp !== undefined);
    assert.ok(set && ramp, "no filter envelope");
    assert.ok(ramp.ramp < set.set, `swept from ${set.set} up to ${ramp.ramp}`);
  });
});


test("a silent bell", async (t) => {
  const silent = () => {
    const page = loadPage({ touch: true });
    const custom = page.nodes["voices"].children.find((b) => b.dataset.voice === "custom");
    page.fire(custom, "click");
    const tune = page.nodes["tune"];
    const bodies = tune.children
      .find((row) => row.children.some((c) => c.className === "timbres"))
      .children.find((c) => c.className === "timbres");
    page.played.tones.length = 0;
    page.played.noises.length = 0;
    page.fire(bodies.children.find((b) => b.dataset.timbre === "silent"), "click");
    return page;
  };

  await t.test("plays nothing", () => {
    assert.deepEqual(silent().played.tones, []);
  });

  await t.test("and strikes nothing", () => {
    assert.deepEqual(silent().played.noises, []);
  });
});


test("the cowbell has its own generator", async (t) => {
  const found = () => {
    const page = loadPage();
    for (let i = 0; i < 5; i++) page.fire(".wordmark", "click");
    return page;
  };

  await t.test("five taps on the wordmark ring it", () => {
    assert.ok(found().played.tones.length > 0);
  });

  await t.test("it is not a fundamental with overtones", () => {
    // Nobody hears a cowbell as a pitch, so the preset synth cannot reach one:
    // its modes are struck separately, several times, as a figure.
    const played = found().played;
    const starts = [...new Set(played.tones.map((t) => t.from))];
    assert.ok(starts.length > 1, "every mode started at once, like a bell");
  });

  await t.test("and it is struck more than once, as a figure", () => {
    const played = found().played;
    assert.ok(Math.max(...played.tones.map((t) => t.from)) > 0.1,
              "nothing was struck after the first hit");
  });
});
