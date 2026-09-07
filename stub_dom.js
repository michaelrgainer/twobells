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

const REAL_SET_TIMEOUT = setTimeout;

//: What --note-fade resolves to when nothing has set it, in the same units the
//: stylesheet uses. index.html declares `--note-fade: 600ms` and the page
//: parseFloats it and hands the number to setTimeout, so the unit here is not
//: cosmetic: "0.6s" parses to 0.6 and makes a 600ms fade a 0.6ms one.
const NOTE_FADE = "600ms";

// TWOBELLS_PAGE lets the mutation harness point the whole suite at a mutated
// copy without touching the real page: writing broken code into index.html and
// relying on putting it back is one interrupt away from committing it.
const HTML = process.env.TWOBELLS_PAGE || path.join(__dirname, "index.html");
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

// Attributes the markup carries that the page then reads back. data-phase is the
// one that matters: index.html ships `data-phase="idle"` on <main>, and without it
// here every phase check starts from undefined and the page never looks idle.
const SEED_DATA = { sit: { phase: "idle" } };

// Direct assignment (style.strokeDashoffset = x) and setProperty both work, because
// the page uses both: dashoffset is a plain property and --bell-fade is a custom one,
// and a custom property can only be set through setProperty.
function makeStyle() {
  return {
    setProperty(name, value) { this[name] = value; },
    removeProperty(name) { const had = this[name]; delete this[name]; return had; },
    getPropertyValue(name) { return this[name] ?? ""; },
  };
}

// Enough of a selector engine for what the page asks: `.voice`, `.timbres`, a tag.
// The page reads its own buttons back to mark which voice is pressed, and with
// querySelectorAll returning [] that whole loop was a silent no-op -- so no test
// could tell a chosen voice from an unchosen one.
function selectorMatches(node, selector) {
  if (selector.startsWith(".")) {
    const name = selector.slice(1);
    return String(node.className || "").split(/\s+/).includes(name) ||
           (node.classList ? node.classList.contains(name) : false);
  }
  if (selector.startsWith("#")) return node.id === selector.slice(1);
  return node.id === selector;
}

function matching(root, selector) {
  const found = [];
  (function walk(node) {
    (node.children || []).forEach((child) => {
      if (selectorMatches(child, selector)) found.push(child);
      walk(child);
    });
  })(root);
  return found;
}

// A real class list, because the page both writes classes and reads them back:
// markLearned asks `contains` before it decides it has anything to record, and
// updateFades toggles the fade edges. A no-op version made both untestable.
function makeClassList() {
  const held = new Set();
  return {
    add(...names) { names.forEach((n) => held.add(n)); },
    remove(...names) { names.forEach((n) => held.delete(n)); },
    contains(name) { return held.has(name); },
    toggle(name, on) {
      const want = on === undefined ? !held.has(name) : !!on;
      if (want) held.add(name); else held.delete(name);
      return want;
    },
    values() { return [...held]; },
  };
}

function makeNode(id) {
  return {
    id, style: makeStyle(), dataset: { ...(SEED_DATA[id] || {}) },
    children: [], attrs: {},
    textContent: "", innerHTML: "", value: SEED[id] ?? "", hidden: false,
    min: id === "rng-sit" ? "1" : "0", max: id === "rng-first" ? "59" : "60",
    classList: makeClassList(),
    // updateFades measures the list to decide whether to show its fade edges, so
    // these have to be numbers rather than undefined.
    scrollTop: 0, scrollHeight: 400, clientHeight: 200,
    focus() { global.document.activeElement = this; },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k] ?? null; },
    addEventListener(type, handler) {
      ((this.listeners ||= {})[type] ||= []).push(handler);
    },
    removeEventListener(type, handler) {
      const list = (this.listeners || {})[type] || [];
      const at = list.indexOf(handler);
      if (at >= 0) list.splice(at, 1);
    },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    append(...c) { c.forEach((n) => { n.parentNode = this; }); this.children.push(...c); },
    querySelectorAll(selector) { return matching(this, selector); },
    querySelector(selector) { return matching(this, selector)[0] || makeNode("sub"); },
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

// Handlers, not just their names. The stub used to record the event TYPE and throw
// the function away, which meant no node test could click anything -- and since
// every gesture, every panel and the whole session lifecycle sits behind a
// listener, two thirds of the page was reachable only from the browser tier.
// Dispatched up the tree, not just at the target. Without bubbling
// `stopPropagation` is a no-op, and the page's calls to it are load-bearing: the
// pick button stops its own click reaching the document listener that closes
// pickers, so a picker without it opens and shuts in the same gesture. Deleting
// every stopPropagation in the page left the whole suite green.
function fire(node, type, event = {}) {
  if (!node) throw new Error(`nothing to fire ${type} at`);
  let stopped = false;
  const full = {
    type, target: node,
    preventDefault() {},
    stopPropagation() { stopped = true; },
    ...event,
  };
  // Target, then each ancestor the stub knows about, then document and window --
  // which is where the page hangs its click-away and Escape handlers.
  const path = [];
  for (let at = node; at; at = at.parentNode) path.push(at);
  const doc = global.document;
  if (doc && !path.includes(doc)) path.push(doc);
  if (global.window && !path.includes(global.window)) path.push(global.window);

  let reached = 0;
  for (const step of path) {
    const handlers = ((step || {}).listeners || {})[type] || [];
    reached += handlers.length;
    handlers.slice().forEach((handler) => handler(full));
    if (stopped) break;
  }
  if (!reached) throw new Error(`nothing listens for ${type} on ${node.id || node}`);
  return full;
}

function listens(node, type) {
  return (((node || {}).listeners || {})[type] || []).length > 0;
}


// An AudioContext that writes down what it was asked to play. It hears nothing,
// but a struck bell is a set of oscillator frequencies and decay times, and those
// are numbers a test can assert -- which is what makes the timbre tables testable
// at all. Recording rather than discarding is the difference between a stub that
// proves strike() does not throw and one that proves it plays the right bell.
function makeAudio(played) {
  const makeParam = (log, name) => ({
    setValueAtTime(value, at) { log.push({ param: name, set: value, at }); },
    linearRampToValueAtTime(value, at) { log.push({ param: name, ramp: value, at }); },
    exponentialRampToValueAtTime(value, at) {
      log.push({ param: name, ramp: value, at, curve: "exp" });
    },
    value: 0,
  });
  const node = (extra) => ({ connect: (n) => n, start() {}, stop() {}, ...extra });
  return function AudioContext() {
    return {
      state: "running", currentTime: 0, sampleRate: 48000, destination: {},
      resume() {},
      createGain: () => node({ gain: makeParam(played.envelopes, "gain") }),
      createOscillator: () => {
        const osc = node({
          frequency: makeParam(played.envelopes, "frequency"),
          start(at) { played.tones.push({ hz: osc.frequency.value, from: at }); },
          stop(at) {
            const last = played.tones[played.tones.length - 1];
            if (last) last.until = at;
          },
        });
        return osc;
      },
      createBiquadFilter: () => node({
        frequency: makeParam(played.filters, "frequency"), Q: {},
      }),
      createBufferSource: () => node({
        start() { played.noises.push(true); },
      }),
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

  const docNode = makeNode("document");
  global.document = {
    activeElement: null,
    visibilityState: "visible",
    getElementById(id) { return nodes[id] ||= makeNode(id); },
    querySelector(sel) { return nodes[sel] ||= makeNode(sel); },
    querySelectorAll() { return []; },
    createElement(tag) { return makeNode(tag); },
    addEventListener: docNode.addEventListener.bind(docNode),
    removeEventListener: docNode.removeEventListener.bind(docNode),
    get listeners() { return docNode.listeners; },
  };
  // window and document take listeners too: the drag follows pointermove on
  // window, and Escape and the click-away close pickers on document.
  const windowNode = makeNode("window");
  global.window = windowNode;
  // The capability seam. `claude: {...}` is a browser that offers one; the default
  // is a plain browser, which is what almost every visitor is.
  if (options.claude) windowNode.claude = options.claude;
  global.localStorage = storage;
  // `touch: true` is a phone: a motor, and a finger as the primary pointer.
  // Anything else is a laptop -- which is the case the page's check exists for, so
  // it gets navigator.vibrate TOO. Desktop Chrome ships the function and moves
  // nothing, and a stub laptop with no vibrate at all never exercised the pointer
  // test that is the whole point: mutating it away changed no test's answer.
  // `clipboard: "blocked"` rejects, `clipboard: false` is a browser without one,
  // and the default is a clipboard that works and remembers what it was given.
  const written = [];
  const hasVibrate = options.vibrate !== false;   // desktop Chrome has it too
  const clipboard =
    options.clipboard === false ? undefined
    : options.clipboard === "blocked"
      ? { writeText: () => Promise.reject(new Error("denied")) }
      : { writeText: (text) => { written.push(text); return Promise.resolve(); } };
  // A wake-lock API that records, so a test can see whether the screen was left
  // held. `wakeLock: false` is a browser without one, which is most of them.
  const locks = { issued: [], released: [] };
  const wakeLock = options.wakeLock === false ? undefined : {
    request: () => {
      const id = locks.issued.length + 1;
      locks.issued.push(id);
      return Promise.resolve({
        release: () => { locks.released.push(id); return Promise.resolve(); },
      });
    },
  };
  global.vibrations = [];
  global.navigator = {
    ...(hasVibrate ? { vibrate: (pattern) => { global.vibrations.push(pattern);
                                               return true; } } : {}),
    ...(clipboard ? { clipboard } : {}),
    ...(wakeLock ? { wakeLock } : {}),
  };
  global.clipboardWrites = written;
  global.matchMedia = (query) => ({
    matches: !!options.touch && /pointer:\s*coarse/.test(query),
    media: query,
  });
  // The page's own timers do not hold the process open. A sit arms its backstops for
  // the full length of the sit, so a test that starts a twenty-minute one and asserts
  // on the first second would otherwise leave node waiting twenty minutes for a timer
  // whose result nobody wants. A test that means to wait uses REAL_SET_TIMEOUT.
  global.setTimeout = (fn, ms, ...rest) => {
    const timer = REAL_SET_TIMEOUT(fn, ms, ...rest);
    if (timer && typeof timer.unref === "function") timer.unref();
    return timer;
  };

  global.requestAnimationFrame = () => 0;
  global.cancelAnimationFrame = () => {};
  // Only --note-fade is read back, and only to time how long "Sit complete" stays.
  global.getComputedStyle = (node) => ({
    getPropertyValue: (name) => (node.style || {})[name] ?? NOTE_FADE,
  });
  const played = { tones: [], envelopes: [], filters: [], noises: [] };
  windowNode.AudioContext = makeAudio(played);

  vm.runInThisContext(pageScript(), { filename: "index.html" });
  return {
    nodes, storage,
    clipboard: written,
    vibrations: global.vibrations,
    // What the bell actually played: one entry per oscillator, with its pitch and
    // how long it was left ringing.
    played,
    // Which locks were asked for and which given back. Held = issued minus released.
    locks: { ...locks, held: () => locks.issued.filter((i) => !locks.released.includes(i)) },
    seam: global.window.__twobells,
    document: global.document,
    window: windowNode,
    fire: (target, type, event) => fire(nodes[target] || target, type, event),
  };
}

module.exports = { loadPage, makeStorage, pageScript, fire, listens,
                   REAL_SET_TIMEOUT };
