#!/usr/bin/env node
// What the tests never run, in the one file that matters.
//
// index.html has no module boundary and no build step, so node's own
// --experimental-test-coverage cannot see it: the page script is handed to `vm`
// and never exists on disk. V8 does record it, under the url "index.html", so this
// reads the raw coverage V8 writes to NODE_V8_COVERAGE and reports that one entry.
//
// It reports functions and blocks, not a line percentage. A percentage over a file
// that is two thirds comments and CSS is a number with a caveat attached, and the
// caveat is the part that matters: what is worth knowing is which functions no test
// has ever called, and which branches inside the called ones never ran.
//
//   ./coverage.js                  run the node tier and report
//   ./coverage.js --json           machine-readable
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { pageScript } = require("./stub_dom.js");

const SCRIPT_URL = "index.html";
const TEST_FILES = ["test_smoke.js", "test_logic.js", "test_session.js",
                    "test_panel.js", "test_bell.js"];

function collectCoverage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "twobells-cov-"));
  try {
    execFileSync(process.execPath, ["--test", ...TEST_FILES], {
      cwd: __dirname,
      env: { ...process.env, NODE_V8_COVERAGE: dir },
      stdio: "ignore",
    });
  } catch (err) {
    // A failing suite still leaves usable coverage, and saying so beats guessing.
    process.stderr.write("warning: the node tier did not pass; coverage is of a red suite\n");
  }
  const scripts = [];
  for (const name of fs.readdirSync(dir)) {
    const report = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    for (const script of report.result) {
      if (script.url === SCRIPT_URL) scripts.push(script);
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  if (!scripts.length) throw new Error(`no coverage recorded for ${SCRIPT_URL}`);
  return scripts;
}

// V8 emits one entry per process, and a function unrun in one may have run in the
// other. Counts add, so the union is the sum at every offset.
function mergeCounts(scripts, length) {
  const counts = new Int32Array(length);
  const known = new Uint8Array(length);
  for (const script of scripts) {
    const ranges = script.functions.flatMap((fn) => fn.ranges);
    // Innermost wins, so apply outermost first and let inner ranges overwrite.
    ranges.sort((a, b) => (a.startOffset - b.startOffset) ||
                          (b.endOffset - a.endOffset));
    const own = new Int32Array(length);
    for (const range of ranges) {
      for (let i = range.startOffset; i < range.endOffset && i < length; i++) {
        own[i] = range.count;
        known[i] = 1;
      }
    }
    for (let i = 0; i < length; i++) counts[i] += own[i];
  }
  return { counts, known };
}

function lineStarts(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineAt(starts, offset) {
  let low = 0, high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid] <= offset) low = mid; else high = mid - 1;
  }
  return low + 1;
}

function uncalledFunctions(scripts, source, starts) {
  // Called in one process counts as called, so a function is unrun only if every
  // process says so.
  const byRange = new Map();
  for (const script of scripts) {
    for (const fn of script.functions) {
      const outer = fn.ranges[0];
      const key = `${outer.startOffset}:${outer.endOffset}`;
      const seen = byRange.get(key);
      byRange.set(key, {
        name: fn.functionName || "(anonymous)",
        offset: outer.startOffset,
        count: (seen ? seen.count : 0) + outer.count,
      });
    }
  }
  return [...byRange.values()]
    .filter((fn) => fn.count === 0)
    .map((fn) => ({ name: fn.name, line: lineAt(starts, fn.offset),
                    source: source.slice(fn.offset, fn.offset + 60).split("\n")[0] }))
    .sort((a, b) => a.line - b.line);
}

function uncoveredBlocks(scripts, source, starts) {
  // Blocks inside functions that DID run: the branch a test never took.
  const blocks = new Map();
  for (const script of scripts) {
    for (const fn of script.functions) {
      if (fn.ranges[0].count === 0) continue;   // reported as an uncalled function
      for (const range of fn.ranges.slice(1)) {
        const key = `${range.startOffset}:${range.endOffset}`;
        const seen = blocks.get(key) || { range, count: 0 };
        seen.count += range.count;
        blocks.set(key, seen);
      }
    }
  }
  const ran = new Set();
  for (const { range, count } of blocks.values()) {
    if (count > 0) ran.add(`${range.startOffset}:${range.endOffset}`);
  }
  return [...blocks.values()]
    .filter(({ range, count }) =>
      count === 0 && !ran.has(`${range.startOffset}:${range.endOffset}`))
    .map(({ range }) => ({
      from: lineAt(starts, range.startOffset),
      to: lineAt(starts, range.endOffset - 1),
      source: source.slice(range.startOffset, range.startOffset + 70)
                    .split("\n")[0].trim(),
    }))
    .sort((a, b) => a.from - b.from);
}

function main() {
  const source = pageScript();
  const starts = lineStarts(source);
  const scripts = collectCoverage();
  const uncalled = uncalledFunctions(scripts, source, starts);
  const blocks = uncoveredBlocks(scripts, source, starts);
  const { counts, known } = mergeCounts(scripts, source.length);
  let executable = 0, executed = 0;
  for (let i = 0; i < source.length; i++) {
    if (!known[i]) continue;
    executable++;
    if (counts[i] > 0) executed++;
  }

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ uncalled, blocks,
                                 bytesExecuted: executed, bytesExecutable: executable }, null, 2));
    return;
  }
  const pct = executable ? (executed * 100 / executable).toFixed(1) : "0.0";
  console.log(`index.html page script: ${pct}% of executable bytes run ` +
              `(${uncalled.length} function(s) never called, ` +
              `${blocks.length} block(s) never entered)\n`);
  if (uncalled.length) {
    console.log("NEVER CALLED — no test reaches these at all:");
    for (const fn of uncalled) {
      console.log(`  line ${String(fn.line).padStart(4)}  ${fn.name.padEnd(24)} ${fn.source.trim()}`);
    }
    console.log("");
  }
  if (blocks.length) {
    console.log("NEVER ENTERED — the function runs, this branch does not:");
    for (const b of blocks) {
      const where = b.from === b.to ? `line ${b.from}` : `lines ${b.from}-${b.to}`;
      console.log(`  ${where.padEnd(16)} ${b.source}`);
    }
  }
}

main();
