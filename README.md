# Two Bells

A meditation timer. Two bells, an unwinding ring, and a one-line practice log.
No ads, no donations, no countdown to peek at. Free, forever.

<https://twobells.org>

One self-contained `index.html`: no build step, no framework, no backend. The
bells are synthesised with the Web Audio API rather than fetched.

## Checking a change

    sed -n '/^<script>/,/^<\/script>/p' index.html | sed '1d;$d' > /tmp/tb.js
    cp smoke.js /tmp/ && (cd /tmp && node smoke.js)

`smoke.js` runs the page script against a stub DOM and asserts that
initialisation finished: voices built, pickers populated, ring handles positioned,
controls wired. It exists because an edit once deleted four functions, and the
resulting `ReferenceError` fired before initialisation -- leaving a page that
parsed cleanly, passed a syntax check, and did nothing at all.

## Driving it in a real browser

`smoke.js` catches broken initialisation, but it cannot see layout or hit-testing.
For that, drive a real Chrome with `chromectl`
(`analysis_and_visualization/tools/chromectl`, Playwright-based). Copy it somewhere
scratch and `npm install` there -- its `node_modules` is not gitignored in that
worktree:

    npx tsx src/cli.ts "file://$HOME/twobells/index.html" \
        --eval 'document.elementFromPoint(x, y).id' --out /tmp/out

    npx tsx src/cli.ts "file://$HOME/twobells/index.html" \
        --script drag.json --out /tmp/out    # drag/click/wheel/key + eval + assert

This is how the `.ring-centre` overlay was found: it is `position: absolute;
inset: 0` and sits after the `<svg>`, so it hit-tested ahead of every ring.
`elementFromPoint` at the ring returned `ring-centre` rather than `arc-sit`, which
is the whole bug in one line -- after three rounds of guessing at it from
descriptions. Skip `settle` in scripts; it waits on an app seam this page has not
got.
