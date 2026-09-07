#!/usr/bin/env node
// Break the page on purpose, one small change at a time, and report what no test
// objected to.
//
// A green suite says the page passes its tests. It does not say the tests would
// notice if the page changed. A survivor is one of three things, and which one
// matters:
//
//   the line is untested        -- a gap, and the useful kind to find
//   the change cannot matter    -- equivalent code, a log string, defensive belt
//   the test asserts nothing    -- the dangerous kind, because it is counted as
//                                  coverage and would pass either way
//
//   ./mutate.js                 a sample of mutants
//   ./mutate.js --limit 60      how many to try
//   ./mutate.js --seed 7        the same sample again
//   ./mutate.js --all           every site (slow)
//
// Survivors that have been looked at and are NOT gaps, so nobody chases them twice:
//
//   the tuning of a timbre  the exact level of a partial, or the third decimal of
//                           a damping. What a bell IS -- its fundamental, its
//                           partial ratios, that the top dies first, that each
//                           partial is a beating pair -- is asserted in
//                           test_bell.js against a recording AudioContext. What no
//                           test can judge is whether 0.20 or 0.21 sounds better,
//                           which is a listening decision and not an assertion.
//   `degrees / 360`       provably equivalent: /361 drifts by at most 0.166 units
//                         over a whole turn and every reading is rounded to an
//                         integer, so no value can move. Same for the +90 rotation.
//   raiseTotals's guard   `<=` to `<` writes the same numbers back rather than
//                         returning early. It is an optimisation, not behaviour.
//
// Runs against a COPY of the page in a temp directory, pointed at by TWOBELLS_PAGE.
// The real index.html is never written to: the method involves putting deliberately
// broken code on disk, and doing that in the working tree is one Ctrl-C away from
// committing it.
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TESTS = ["test_smoke.js", "test_logic.js", "test_session.js", "test_panel.js",
                "test_bell.js"];

// `+` is deliberately absent: it is string concatenation as often as arithmetic
// here, and a mutant that only reshuffles a label is noise in the report.
const SWAPS = [
  [">=", ">"], ["<=", "<"], ["===", "!=="], ["!==", "==="],
  ["&&", "||"], ["||", "&&"],
];

/** Offsets that are real code: not inside a string, template, comment or regex. */
function codeMask(source) {
  const mask = new Uint8Array(source.length).fill(1);
  let i = 0;
  const blank = (from, to) => { for (let k = from; k < to && k < mask.length; k++) mask[k] = 0; };
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === "//") {
      const end = source.indexOf("\n", i);
      blank(i, end < 0 ? source.length : end);
      i = end < 0 ? source.length : end;
    } else if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      blank(i, end < 0 ? source.length : end + 2);
      i = end < 0 ? source.length : end + 2;
    } else if (source[i] === '"' || source[i] === "'" || source[i] === "`") {
      const quote = source[i];
      let k = i + 1;
      while (k < source.length && source[k] !== quote) k += source[k] === "\\" ? 2 : 1;
      blank(i, k + 1);
      i = k + 1;
    } else {
      i++;
    }
  }
  return mask;
}

function lineOf(source, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) if (source[i] === "\n") line++;
  return line;
}

function scriptRegion(source) {
  const opens = source.indexOf("<script>\n(() => {");
  if (opens < 0) throw new Error("index.html: no page script found");
  const from = opens + "<script>\n".length;
  const to = source.indexOf("</script>", from);
  if (to < 0) throw new Error("index.html: page script is not closed");
  return { from, to };
}

function sites(source) {
  const mask = codeMask(source);
  const found = [];
  for (const [from, to] of SWAPS) {
    let at = source.indexOf(from);
    while (at >= 0) {
      // Longest match wins: `===` must not be found as `==` plus a stray `=`.
      const longer = source.slice(at, at + 3);
      const isPartOfLonger = (from === "<=" || from === ">=") && false;
      if (mask[at] && !isPartOfLonger &&
          !(from === "===" && source[at + 3] === "=") &&
          !((from === ">=" || from === "<=") && source[at + 2] === "=")) {
        found.push({ kind: `${from} -> ${to}`, at, from, to });
      }
      at = source.indexOf(from, at + 1);
    }
  }
  // Numeric literals, nudged by one. Catches a threshold nobody pinned.
  const number = /(?<![\w.$])(\d+(?:\.\d+)?)(?![\w.])/g;
  let match;
  while ((match = number.exec(source))) {
    if (!mask[match.index]) continue;
    const value = Number(match[1]);
    if (value === 0 && match[1].length === 1) continue;   // 0 -> 1 is mostly noise
    found.push({ kind: `${match[1]} -> ${value + 1}`, at: match.index,
                 from: match[1], to: String(value + 1) });
  }
  return found.sort((a, b) => a.at - b.at);
}

function apply(source, site) {
  return source.slice(0, site.at) + site.to + source.slice(site.at + site.from.length);
}

function shuffled(list, seed) {
  let state = seed || 1;
  const random = () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function runSuite(pagePath) {
  try {
    execFileSync(process.execPath, ["--test", ...TESTS], {
      cwd: __dirname,
      env: { ...process.env, TWOBELLS_PAGE: pagePath },
      stdio: "ignore", timeout: 120000,
    });
    return true;    // every test passed: the mutant survived
  } catch (err) {
    return false;   // something objected
  }
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (name, fallback) => {
    const at = argv.indexOf(name);
    return at >= 0 ? Number(argv[at + 1]) : fallback;
  };
  const limit = argv.includes("--all") ? Infinity : flag("--limit", 40);
  const seed = flag("--seed", 1);

  const real = path.join(__dirname, "index.html");
  const source = fs.readFileSync(real, "utf8");
  // Only the page script. The file is two thirds CSS and markup, and mutating
  // `left: 50%` produces a survivor every time -- no test asserts a stylesheet, so
  // those crowd out the ones that mean something.
  const region = scriptRegion(source);
  const all = sites(source).filter((s) => s.at >= region.from && s.at < region.to);
  const chosen = shuffled(all, seed).slice(0, limit).sort((a, b) => a.at - b.at);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "twobells-mutate-"));
  const page = path.join(dir, "index.html");

  fs.writeFileSync(page, source);
  if (!runSuite(page)) {
    console.error("BASELINE IS RED against an unmutated copy — nothing below means anything.");
    process.exit(1);
  }
  console.log(`${all.length} mutation site(s) in the page script; ` +
              `trying ${chosen.length} (seed ${seed})\n`);

  const survivors = [];
  chosen.forEach((site, index) => {
    fs.writeFileSync(page, apply(source, site));
    const survived = runSuite(page);
    if (survived) survivors.push(site);
    process.stdout.write(
      `  ${String(index + 1).padStart(3)}/${chosen.length}  ` +
      `${survived ? "SURVIVED" : "killed  "}  line ${String(lineOf(source, site.at)).padStart(4)}  ${site.kind}\n`);
  });
  fs.rmSync(dir, { recursive: true, force: true });

  console.log(`\n${chosen.length - survivors.length} killed, ${survivors.length} survived`);
  if (survivors.length) {
    console.log("\nSURVIVORS — no test objected:");
    for (const site of survivors) {
      const line = lineOf(source, site.at);
      const text = source.split("\n")[line - 1].trim().slice(0, 90);
      console.log(`  line ${String(line).padStart(4)}  ${site.kind.padEnd(18)} ${text}`);
    }
  }
}

main();
