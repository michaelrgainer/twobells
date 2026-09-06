// Smoke test for two_bells: run the page script against a stub DOM and assert the
// initialisation actually completed. Written after a patch silently deleted begin/
// tick/loop/finish, which threw at wiring time and left the page with no voices,
// no pickers and unpositioned rings -- all of it invisible to a syntax check.
const nodes = {};
// The stub does not parse the markup, so the state-holding inputs are seeded the
// way index.html declares them -- otherwise every value derived from them is empty
// and the assertions test nothing.
const SEED = { "rng-first": "10", "rng-sit": "20" };

function make(id) {
  const el = {
    id, style: {}, dataset: {}, children: [], attrs: {},
    textContent: "", innerHTML: "", value: SEED[id] ?? "", hidden: false,
    min: id === "rng-sit" ? "1" : "0", max: id === "rng-first" ? "59" : "60",
    classList: { add(){}, remove(){}, contains(){ return false; } },
    setAttribute(k, v){ this.attrs[k] = v; }, getAttribute(k){ return this.attrs[k] ?? null; },
    addEventListener(t){ (this.listeners ||= []).push(t); }, removeEventListener(){},
    appendChild(c){ this.children.push(c); return c; },
    append(...c){ this.children.push(...c); },
    querySelectorAll(){ return []; }, querySelector(){ return make("sub"); },
    getBoundingClientRect(){ return { left:0, top:0, width:300, height:300 }; },
    setPointerCapture(){}, releasePointerCapture(){},
  };
  return el;
}
global.document = {
  activeElement: null,
  getElementById(id){ return nodes[id] ||= make(id); },
  querySelector(sel){ return nodes[sel] ||= make(sel); },
  querySelectorAll(){ return []; },
  createElement(t){ return make(t); },
  addEventListener(){}, visibilityState: "visible",
};
global.window = { addEventListener(){}, removeEventListener(){} };
global.localStorage = { getItem: () => null, setItem(){}, removeItem(){} };
global.navigator = {};
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};
global.AudioContext = function(){ return { state:"running", currentTime:0, resume(){},
  createGain:()=>({gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect:n=>n}),
  createOscillator:()=>({frequency:{},connect:n=>n,start(){},stop(){}}),
  createBiquadFilter:()=>({frequency:{setValueAtTime(){},exponentialRampToValueAtTime(){}},Q:{},connect:n=>n}),
  createBufferSource:()=>({connect:n=>n,start(){},stop(){}}),
  createBuffer:()=>({getChannelData:()=>new Float32Array(4)}),
  sampleRate:48000, destination:{} }; };

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${ok ? "" : "   " + detail}`);
  if (!ok) failures++;
}

try { require("./tb.js"); check("script initialises without throwing", true); }
catch (e) { check("script initialises without throwing", false, e.message); process.exit(1); }

const voices = nodes["voices"];
check("voice buttons built", voices && voices.children.length >= 3,
      `got ${voices ? voices.children.length : "no element"}`);
check("voice labels are Bowl/Chime/Custom",
      voices && voices.children.map(c => c.textContent).join(",") === "Bowl,Chime,Custom",
      voices && voices.children.map(c => c.textContent).join(","));

for (const id of ["pick-first", "pick-sit"]) {
  const b = nodes[id];
  check(`${id} shows a value`, b && /\d/.test(b.textContent), `text=${b && b.textContent}`);
  check(`${id} opens on click`, b && (b.listeners || []).includes("click"));
}

for (const id of ["grip-sit", "grip-first", "halo-sit", "halo-first"]) {
  const el = nodes[id];
  const placed = el && el.attrs.cx !== undefined && el.attrs.cx !== "0";
  check(`${id} positioned on its ring`, placed, `cx=${el && el.attrs.cx}`);
}

for (const id of ["arc-sit", "arc-first"]) {
  const el = nodes[id];
  check(`${id} has a dash offset`, el && el.style.strokeDashoffset !== undefined,
        JSON.stringify(el && el.style));
}

check("start button wired", (nodes["start"].listeners || []).includes("click"));
check("rings wired for pointerdown", (nodes["rings"].listeners || []).includes("pointerdown"));

console.log(failures ? `\n  ${failures} FAILURE(S)` : "\n  all checks passed");
process.exit(failures ? 1 : 0);
