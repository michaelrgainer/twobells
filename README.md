# Two Bells

A meditation timer. Two bells, an unwinding ring, and a one-line practice log.
No ads, no donations, no countdown to peek at.

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
