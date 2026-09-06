# Two Bells

A meditation timer. Two bells, an unwinding ring, and a one-line practice log.
No ads, no donations, no countdown to peek at. Free, forever.

<https://twobells.org>

One self-contained `index.html`: no build step, no framework, no backend. The
bells are synthesised with the Web Audio API rather than fetched.

## Tests

    ./run_tests            everything
    ./run_tests --quick    the browser-free tier, in about a tenth of a second

Two tiers, because they cost different amounts and catch different things.

**`test_smoke.js` and `test_logic.js`** need nothing but node. `stub_dom.js` runs
the page's script against a DOM thin enough to be honest about what it is, and the
tests go in through the seam described below. Between them: that initialisation
finishes at all, the export's arithmetic and its columns, merging a log with the
store's copy, the running totals, the 400-sit cap, and what happens when the
browser says it is full. Anyone who has cloned this repo can run these.

`test_smoke.js` is the oldest and still the one that matters most. An edit once
deleted four functions; the file parsed, `node --check` was happy, the page loaded
-- and then threw at wiring time, leaving no voices, no pickers, and rings that
were never positioned. Nothing looked broken until you tried to use it.

**`test_browser.js`** needs a real Chrome, driven through `chromectl`
(`analysis_and_visualization/tools/chromectl`, Playwright-based, internal and not
vendored here). It skips itself when chromectl has not been built, so the tier
above is what a stranger gets:

    CHROMECTL=/path/to/tools/chromectl ./run_tests

What is here is what only a browser can answer: pointer drags on the SVG rings,
the fade leaving over the first bell and returning over the last, the settle ring
vanishing, "Sit complete" settling back, the show-list opening upward at the foot
of the page, Copy reaching the clipboard, and the exit button staying on one line
at 320px. Every one of those broke at least once while the page was being built,
and none of them was visible to node.

## The seam

`window.__twobells` exists for the tests, and is on the live page because there is
no build step to strip it and nothing here worth hiding.

| | |
|---|---|
| `settleCount` | rises on every render |
| `getState()` | phase, note, voice, durations, rows, totals, ms to the next bell |
| `hurry({bellIn, endIn})` | brings the deadlines forward |
| `seed(records)` | loads a practice log without a reload |
| `internals` | the pure functions, for the node tier |

`hurry` is what makes the browser tier bearable. The deadlines are absolute, so
moving them is invisible to the frame loop and the backstops: a twenty-minute sit
finishes in under a second, and the whole browser suite runs in about twenty
seconds rather than the twelve minutes of real sitting it would otherwise take.

The name and the shape of `settleCount`/`getState` match what chromectl's `--seam`
expects, so `settle` and `assert` work against this page.

## Two things that will cost you an afternoon

`chromectl` cannot run script before page load, so seeding `localStorage` and then
loading the page needs a doctored copy of the file with a `<script>` spliced in
ahead of the page's own. Where the seam will do instead -- `seed()`, or setting a
value through the control that owns it -- prefer that. Note that writing to
`localStorage` after load does **not** change state the page has already read into
memory: the custom bell's settings live in a variable, and seeding the key behind
its back changes nothing.

The `.ring-centre` overlay is `position: absolute; inset: 0` and sits after the
`<svg>`, so it hit-tests ahead of every ring. `elementFromPoint` at the ring
returned `ring-centre` rather than `arc-sit`, which is the whole bug in one line
-- after three rounds of guessing at it from descriptions. It stays inert only
because of an explicit `pointer-events: none`, and `test_browser.js` asserts that.
