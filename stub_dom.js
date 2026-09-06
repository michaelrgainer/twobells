// Runs index.html's script in node, against a DOM thin enough to be honest about
// what it is: enough of one for the page to finish initialising, and no more.
//
// It exists because the page has no build step and no module boundary -- one IIFE
// in one file -- so the only way to reach the code from a test is to execute it
// the way a browser would and then go in through the seam it exposes.
//
// The localStorage here really stores things, and can be given a byte limit, since
// most of what is worth testing on this page is about what gets written and read
// back, and what happens when it will not fit.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const HTML = path.join(__dirname, "index.html");
const OPENS = "<script>\n(() => {";

function pageScript() {
  const html = fs.readFileSync(HTML, "utf8");
  const start = html.indexOf(OPENS);
  if (start < 0) throw new Error("index.html: no page script found");
  const end = html.indexOf("</script>", start);
  if (end < 0) throw new Error("index.html: page script is not closed");
  return html.slice(start + "<script>\n".length, end);
}

// The stub does not parse the markup, so the inputs that hold the durations are
// seeded the way index.html declares them. Without this every value derived from
// them is empty and the assertions test nothing.
const SEED = { "rng-first": "40", "rng-sit": "20" };

function makeNode(id) {
  return {
    id, style: {}, dataset: {}, children: [], attrs: {},
    textContent: "", innerHTML: "", value: SEED[id] ?? "", hidden: false,
    min: id === "rng-sit" ? "1" : "0", max: id === "rng-first" ? "59" : "60",
    classList: { add() {}, remove() {}, contains() { return false; } },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k] ?? null; },
    addEventListener(type) { (this.listeners ||= []).push(type); },
    removeEventListener() {},
    appendChild(c) { this.children.push(c); return c; },
    append(...c) { this.children.push(...c); },
    querySelectorAll() { return []; },
    querySelector() { return makeNode("sub"); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 300 }; },
    setPointerCapture() {}, releasePointerCapture() {},
  };
}

// A byte limit makes the quota path reachable: past it every write throws the way
// a full origin does, which is the only way to test code that exists for that case.
function makeStorage(limitBytes) {
  const cells = new Map();
  const sizeOf = (k, v) => k.length + v.length;
  const usedWithout = (key) => {
    let total = 0;
    for (const [k, v] of cells) if (k !== key) total += sizeOf(k, v);
    return total;
  };
  return {
    getItem(k) { return cells.has(k) ? cells.get(k) : null; },
    setItem(k, value) {
      const v = String(value);
      if (limitBytes !== undefined && usedWithout(k) + sizeOf(k, v) > limitBytes) {
        const err = new Error("exceeded the quota");
        err.name = "QuotaExceededError";
        err.code = 22;
        throw err;
      }
      cells.set(k, v);
    },
    removeItem(k) { cells.delete(k); },
    clear() { cells.clear(); },
    get length() { return cells.size; },
    keys() { return [...cells.keys()]; },
  };
}

// Enough of an AudioContext that strike() can build its graph and hear nothing.
function makeAudio() {
  const param = { setValueAtTime() {}, linearRampToValueAtTime() {},
                  exponentialRampToValueAtTime() {} };
  const node = (extra) => ({ connect: (n) => n, start() {}, stop() {}, ...extra });
  return function AudioContext() {
    return {
      state: "running", currentTime: 0, sampleRate: 48000, destination: {},
      resume() {},
      createGain: () => node({ gain: param }),
      createOscillator: () => node({ frequency: {} }),
      createBiquadFilter: () => node({ frequency: param, Q: {} }),
      createBufferSource: () => node({}),
      createBuffer: () => ({ getChannelData: () => new Float32Array(4) }),
    };
  };
}

// Each call builds a fresh set of globals and runs the script again, so one test
// cannot leave state where the next one will find it.
function loadPage(options = {}) {
  const nodes = {};
  const storage = options.storage || makeStorage(options.limitBytes);
  Object.entries(options.seed || {}).forEach(([k, v]) => storage.setItem(k, v));

  global.document = {
    activeElement: null,
    visibilityState: "visible",
    getElementById(id) { return nodes[id] ||= makeNode(id); },
    querySelector(sel) { return nodes[sel] ||= makeNode(sel); },
    querySelectorAll() { return []; },
    createElement(tag) { return makeNode(tag); },
    addEventListener() {},
  };
  global.window = { addEventListener() {}, removeEventListener() {} };
  global.localStorage = storage;
  global.navigator = {};
  global.requestAnimationFrame = () => 0;
  global.cancelAnimationFrame = () => {};
  global.AudioContext = makeAudio();

  vm.runInThisContext(pageScript(), { filename: "index.html" });
  return { nodes, storage, seam: global.window.__twobells };
}

module.exports = { loadPage, makeStorage, pageScript };
