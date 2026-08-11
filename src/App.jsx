import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";

/* ============================================================================
   PHASE 1 — CAPTURE CORE
   Voice-driven girls lacrosse stat tracker.

   This is the sideline prototype. The parser below (§ PARSER) is written as
   pure functions with no React or browser dependencies so it ports directly
   into the Expo build without modification. That is the whole point of this
   artifact: tune the grammar here, move the file over unchanged.
   ========================================================================= */

/* ============================================================================
   § CONSTANTS
   ========================================================================= */

const NUM_WORDS = {
  zero: 0, oh: 0, o: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
  fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

// Phrases matched greedily, longest first. [phrase, kind, value]
const PHRASES = [
  ["free position", "QUAL", "fp"],
  ["eight meter", "QUAL", "fp"],
  ["eight metre", "QUAL", "fp"],
  ["ground ball", "STAT", "GB"],
  ["draw control", "STAT", "DC"],
  ["caused turnover", "STAT", "CT"],
  ["green card", "STAT", "GC"],
  ["yellow card", "STAT", "YC"],
  ["red card", "STAT", "RC"],
  ["on goal", "STAT", "SOG"],
  ["on cage", "STAT", "SOG"],
  ["off cage", "STAT", "MISS"],
  ["scratch that", "CMD", "undo"],
  ["end period", "CMD", "period"],
  ["other team", "SIDE", "them"],
  ["groundie", "STAT", "GB"],
  ["turnover", "STAT", "TO"],
  ["assisted", "STAT", "A"],
  ["assists", "STAT", "A"],
  ["assist", "STAT", "A"],
  ["opponent", "SIDE", "them"],
  ["intercept", "STAT", "INT"],
  ["shoots", "STAT", "SH"],
  ["shots", "STAT", "SH"],
  ["shot", "STAT", "SH"],
  ["scores", "STAT", "G"],
  ["score", "STAT", "G"],
  ["goals", "STAT", "G"],
  ["goal", "STAT", "G"],
  ["saved", "STAT", "SV"],
  ["saves", "STAT", "SV"],
  ["save", "STAT", "SV"],
  ["missed", "STAT", "MISS"],
  ["wide", "STAT", "MISS"],
  ["strip", "STAT", "CT"],
  ["caused", "STAT", "CT"],
  ["draw", "STAT", "DC"],
  ["green", "STAT", "GC"],
  ["yellow", "STAT", "YC"],
  ["red", "STAT", "RC"],
  ["feed", "STAT", "A"],
  ["keeper", "CMD", "keeper"],
  ["goalie", "CMD", "keeper"],
  ["undo", "CMD", "undo"],
  ["mark", "CMD", "mark"],
  ["they", "SIDE", "them"],
  ["them", "SIDE", "them"],
].sort((a, b) => b[0].split(" ").length - a[0].split(" ").length);

const STAT_LABEL = {
  G: "GOAL", A: "ASSIST", SH: "SHOT", SOG: "ON GOAL", MISS: "SHOT",
  GB: "GROUND BALL", DC: "DRAW", CT: "CAUSED TO", TO: "TURNOVER",
  SV: "SAVE", GA: "GOAL AGAINST", GC: "GREEN", YC: "YELLOW", RC: "RED",
  INT: "INTERCEPT", FPG: "FP GOAL", FPA: "FP ATTEMPT",
};

// Jersey numbers speech recognizers reliably swap.
const CONFUSION = {
  12: 20, 20: 12, 13: 30, 30: 13, 14: 40, 40: 14, 15: 50, 50: 15,
  16: 60, 60: 16, 17: 70, 70: 17, 18: 80, 80: 18, 19: 90, 90: 19,
};

/* ============================================================================
   § PARSER — pure, portable, no dependencies
   ========================================================================= */

function combineAt(words, i) {
  const a = NUM_WORDS[words[i]];
  const b = i + 1 < words.length && words[i + 1] in NUM_WORDS ? NUM_WORDS[words[i + 1]] : null;
  if (b !== null) {
    if (a >= 20 && a % 10 === 0 && b > 0 && b < 10) return { val: a + b, consumed: 2 };
    if (a < 10 && b < 10) return { val: a * 10 + b, consumed: 2 };
  }
  return { val: a, consumed: 1 };
}

export function tokenize(text) {
  const words = String(text).toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ").replace(/-/g, " ")
    .split(/\s+/).filter(Boolean);

  const out = [];
  let i = 0;
  while (i < words.length) {
    let hit = null;
    for (const [phrase, kind, val] of PHRASES) {
      const pw = phrase.split(" ");
      if (words.slice(i, i + pw.length).join(" ") === phrase) {
        hit = { kind, val, text: phrase, len: pw.length };
        break;
      }
    }
    if (hit) { out.push(hit); i += hit.len; continue; }

    const w = words[i];
    if (/^\d{1,2}$/.test(w)) { out.push({ kind: "NUM", val: parseInt(w, 10), text: w }); i++; continue; }
    if (w in NUM_WORDS) {
      const { val, consumed } = combineAt(words, i);
      out.push({ kind: "NUM", val, text: words.slice(i, i + consumed).join(" ") });
      i += consumed; continue;
    }
    out.push({ kind: "NOISE", text: w }); i++;
  }
  return out;
}

// Snap a spoken number onto the dressed roster.
export function resolveJersey(n, dressed) {
  if (n === null || n === undefined) return { jersey: null, conf: 0.3, note: "no number" };
  if (dressed.includes(n)) return { jersey: n, conf: 1, note: null };
  const alt = CONFUSION[n];
  if (alt !== undefined && dressed.includes(alt)) {
    return { jersey: alt, conf: 0.65, note: `heard ${n}, snapped to ${alt}` };
  }
  return { jersey: n, conf: 0.3, note: `#${n} not dressed` };
}

// Auto-derived stats. One call writes every implied event.
function derive(stat, fp) {
  switch (stat) {
    case "G": return fp ? ["G", "FPG", "FPA", "SH", "SOG"] : ["G", "SH", "SOG"];
    case "SOG": return fp ? ["FPA", "SH", "SOG"] : ["SH", "SOG"];
    case "SH": return fp ? ["FPA", "SH"] : ["SH"];
    case "MISS": return fp ? ["FPA", "SH"] : ["SH"];
    default: return [stat];
  }
}

/**
 * Parse one utterance into a command or an event group.
 * @param {string} transcript
 * @param {object} ctx { dressed:number[], keeper:number|null, asrConf:number }
 */
export function parseUtterance(transcript, ctx) {
  const tokens = tokenize(transcript);
  const { dressed = [], keeper = null, asrConf = 1 } = ctx || {};

  // --- commands take the whole utterance ---
  const cmd = tokens.find((t) => t.kind === "CMD");
  if (cmd) {
    if (cmd.val === "keeper") {
      const n = tokens.find((t) => t.kind === "NUM");
      const r = n ? resolveJersey(n.val, dressed) : { jersey: null };
      return { type: "command", command: "keeper", jersey: r.jersey, transcript };
    }
    return { type: "command", command: cmd.val, transcript };
  }

  const side = tokens.some((t) => t.kind === "SIDE") ? "them" : "us";
  const fp = tokens.some((t) => t.kind === "QUAL" && t.val === "fp");

  // --- bind numbers to stats, order-independent ---
  const spoken = [];
  let pending = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === "NUM") { pending = t.val; continue; }
    if (t.kind !== "STAT") continue;

    let num = pending;
    if (num !== null) { pending = null; }
    else {
      for (let j = i + 1; j < tokens.length; j++) {
        if (tokens[j].kind === "STAT") break;
        if (tokens[j].kind === "NUM") { num = tokens[j].val; tokens[j].used = true; break; }
      }
    }
    if (tokens[i].used) continue;
    spoken.push({ stat: t.val, num });
  }

  if (spoken.length === 0) {
    return { type: "unparsed", transcript, reason: "no stat recognized" };
  }

  // --- expand into events ---
  const groupId = ulid();
  const events = [];
  let worst = asrConf;

  for (const s of spoken) {
    // Opponent goal → goal against on our keeper. Never make the operator say it.
    if (side === "them" && s.stat === "G") {
      events.push(mkEvent({ groupId, teamSide: "them", jersey: null, statType: "G", derived: false, conf: asrConf, transcript }));
      if (keeper !== null) {
        events.push(mkEvent({ groupId, teamSide: "us", jersey: keeper, statType: "GA", derived: true, conf: asrConf, transcript }));
      }
      continue;
    }
    if (side === "them") {
      events.push(mkEvent({ groupId, teamSide: "them", jersey: null, statType: s.stat, derived: false, conf: asrConf, transcript }));
      continue;
    }

    // A bare "save" belongs to the keeper.
    let num = s.num;
    if (s.stat === "SV" && num === null && keeper !== null) num = keeper;

    const r = resolveJersey(num, dressed);
    const conf = Math.min(asrConf, r.conf);
    worst = Math.min(worst, conf);

    const chain = derive(s.stat, fp);
    chain.forEach((code, idx) => {
      events.push(mkEvent({
        groupId, teamSide: "us", jersey: r.jersey, statType: code,
        derived: idx > 0, conf, transcript, note: idx === 0 ? r.note : null,
      }));
    });
  }

  return { type: "events", groupId, events, confidence: worst, transcript };
}

function mkEvent({ groupId, teamSide, jersey, statType, derived, conf, transcript, note }) {
  return {
    id: ulid(), groupId, teamSide, jersey, statType, derived,
    parseConfidence: conf, rawTranscript: transcript, note: note || null,
    status: conf >= 0.75 ? "committed" : "review",
    wallClock: new Date().toISOString(),
  };
}

let _ulidSeq = 0;
function ulid() {
  return Date.now().toString(36) + "-" + (_ulidSeq++).toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

/* ============================================================================
   § AUDIO CONFIRMATION
   iOS Safari ignores navigator.vibrate, so the eyes-free confirmation channel
   has to be sound. High blip = logged. Low buzz = needs review.
   ========================================================================= */

function useBlip() {
  const ctxRef = useRef(null);
  return useCallback((kind) => {
    try {
      if (!ctxRef.current) ctxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      const ac = ctxRef.current;
      if (ac.state === "suspended") ac.resume();
      const o = ac.createOscillator(), g = ac.createGain();
      o.connect(g); g.connect(ac.destination);
      const map = { ok: 1180, warn: 420, err: 220, start: 760 };
      o.frequency.value = map[kind] || 800;
      o.type = kind === "ok" ? "sine" : "square";
      const dur = kind === "warn" ? 0.18 : 0.07;
      g.gain.setValueAtTime(0.0001, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.22, ac.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
      o.start(); o.stop(ac.currentTime + dur + 0.02);
    } catch (e) { /* silent */ }
  }, []);
}

/* ============================================================================
   § SPEECH
   ========================================================================= */

function useSpeech(onFinal, onInterim) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState(null);
  const recRef = useRef(null);
  const finalRef = useRef("");

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setSupported(false); return; }
    setSupported(true);
    const r = new SR();
    r.continuous = false;
    r.interimResults = true;
    r.lang = "en-US";
    r.maxAlternatives = 1;

    r.onresult = (e) => {
      let interim = "", final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const txt = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          final += txt;
          finalRef.current = txt;
          finalRef.confidence = e.results[i][0].confidence || 0.9;
        } else interim += txt;
      }
      if (interim) onInterim(interim);
      if (final) onInterim(final);
    };
    r.onerror = (e) => {
      setError(e.error);
      setListening(false);
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setSupported(false);
    };
    r.onend = () => {
      setListening(false);
      const t = finalRef.current;
      finalRef.current = "";
      if (t && t.trim()) onFinal(t.trim(), finalRef.confidence || 0.9);
      else onFinal(null, 0);
    };
    recRef.current = r;
    return () => { try { r.abort(); } catch (e) {} };
  }, [onFinal, onInterim]);

  const start = useCallback(() => {
    if (!recRef.current) return;
    setError(null);
    finalRef.current = "";
    try { recRef.current.start(); setListening(true); } catch (e) { /* already started */ }
  }, []);

  const stop = useCallback(() => {
    if (!recRef.current) return;
    try { recRef.current.stop(); } catch (e) {}
  }, []);

  return { supported, listening, error, start, stop };
}

/* ============================================================================
   § STORAGE
   ========================================================================= */

async function loadKey(key, fallback) {
  try {
    const r = await window.storage.get(key);
    return r ? JSON.parse(r.value) : fallback;
  } catch (e) { return fallback; }
}
async function saveKey(key, value) {
  try { await window.storage.set(key, JSON.stringify(value)); } catch (e) {}
}

/* ============================================================================
   § STYLES
   Scoreboard vernacular: warm charcoal housing, incandescent amber bulbs,
   condensed sign type. Legible at arm's length in direct sun.
   ========================================================================= */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@300;500;700&family=Archivo:wght@400;500;600;700&display=swap');

.lx { --bg:#14120F; --panel:#1E1B16; --panel2:#272319; --line:#3A3428;
  --amber:#FFB020; --amber-dim:#8A6620; --bulb:#F5EDDD; --muted:#8A8378;
  --alert:#E5484D; --ok:#7FB77E;
  position:absolute; inset:0; background:var(--bg); color:var(--bulb);
  font-family:'Archivo',system-ui,sans-serif; display:flex; flex-direction:column;
  overflow:hidden; -webkit-font-smoothing:antialiased; touch-action:manipulation; }
.lx *{ box-sizing:border-box; }
.lx button{ font-family:inherit; cursor:pointer; border:none; background:none; color:inherit; }
.lx :focus-visible{ outline:2px solid var(--amber); outline-offset:2px; }

.disp{ font-family:'Oswald',sans-serif; font-variant-numeric:tabular-nums; letter-spacing:.02em; }
.eyebrow{ font-size:10px; letter-spacing:.18em; text-transform:uppercase; color:var(--muted); font-weight:600; }

/* scoreboard header */
.board{ display:flex; align-items:stretch; border-bottom:1px solid var(--line);
  background:linear-gradient(180deg,#221E18,#1A1712); flex:none; }
.bcell{ flex:1; padding:10px 14px; }
.bcell + .bcell{ border-left:1px solid var(--line); }
.bscore{ font-family:'Oswald',sans-serif; font-weight:700; font-size:38px; line-height:.95;
  color:var(--amber); text-shadow:0 0 18px rgba(255,176,32,.28); font-variant-numeric:tabular-nums; }
.bper{ flex:none; width:74px; display:flex; flex-direction:column; justify-content:center;
  align-items:center; border-left:1px solid var(--line); }

/* ghost line */
.ghost{ flex:none; min-height:40px; padding:9px 14px; border-bottom:1px solid var(--line);
  background:#100E0B; display:flex; align-items:center; gap:9px; }
.ghost-txt{ font-family:'Oswald',sans-serif; font-weight:300; font-size:19px;
  color:var(--amber); opacity:.95; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pulse{ width:8px; height:8px; border-radius:50%; background:var(--amber); flex:none;
  animation:pl .9s ease-in-out infinite; }
@keyframes pl{ 0%,100%{opacity:.25;transform:scale(.8)} 50%{opacity:1;transform:scale(1.25)} }

/* tape */
.tape{ flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch; }
.row{ display:flex; align-items:baseline; gap:10px; padding:9px 14px;
  border-bottom:1px solid rgba(58,52,40,.5); width:100%; text-align:left; }
.row:active{ background:var(--panel2); }
.row.new{ animation:pr .5s ease-out; }
@keyframes pr{ from{ background:rgba(255,176,32,.22) } to{ background:transparent } }
.row.der{ padding-top:4px; padding-bottom:4px; padding-left:34px; opacity:.5; border-bottom-color:transparent; }
.row.rev{ background:rgba(229,72,77,.09); }
.row.void{ opacity:.28; text-decoration:line-through; }
.r-time{ font-size:11px; color:var(--muted); font-variant-numeric:tabular-nums; flex:none; width:38px; }
.r-num{ font-family:'Oswald',sans-serif; font-weight:700; font-size:22px; color:var(--amber);
  flex:none; min-width:38px; font-variant-numeric:tabular-nums; }
.r-stat{ font-family:'Oswald',sans-serif; font-weight:500; font-size:16px; letter-spacing:.06em; flex:1; }
.r-flag{ font-size:10px; color:var(--alert); font-weight:700; letter-spacing:.1em; flex:none; }
.der .r-num{ font-size:14px; color:var(--amber-dim); }
.der .r-stat{ font-size:12px; color:var(--muted); letter-spacing:.1em; }
.them .r-num, .them .r-stat{ color:var(--muted); }

/* PTT */
.ptt-wrap{ flex:none; padding:12px 12px calc(12px + env(safe-area-inset-bottom)); background:var(--bg);
  border-top:1px solid var(--line); }
.ptt{ width:100%; height:132px; border-radius:14px; background:var(--panel);
  border:2px solid var(--line); display:flex; flex-direction:column; align-items:center;
  justify-content:center; gap:5px; user-select:none; -webkit-user-select:none;
  touch-action:none; transition:transform .07s, background .12s, border-color .12s; }
.ptt-lbl{ font-family:'Oswald',sans-serif; font-weight:500; font-size:21px; letter-spacing:.13em; }
.ptt.hot{ background:#4A2E08; border-color:var(--amber); transform:scale(.985); }
.ptt.hot .ptt-lbl{ color:var(--amber); }

/* chrome */
.bar{ display:flex; gap:6px; padding:8px 12px; border-top:1px solid var(--line); flex:none;
  background:var(--panel); overflow-x:auto; }
.chip{ padding:7px 12px; border-radius:7px; background:var(--panel2); border:1px solid var(--line);
  font-size:11px; font-weight:600; letter-spacing:.08em; text-transform:uppercase;
  white-space:nowrap; flex:none; }
.chip.on{ background:var(--amber); color:#14120F; border-color:var(--amber); }
.chip.warn{ border-color:var(--alert); color:var(--alert); }

.pad{ padding:16px; overflow-y:auto; flex:1; }
.h1{ font-family:'Oswald',sans-serif; font-weight:700; font-size:26px; letter-spacing:.02em; margin:0 0 3px; }
.sub{ font-size:13px; color:var(--muted); margin:0 0 18px; line-height:1.45; }
.inp{ width:100%; padding:11px 12px; border-radius:8px; background:var(--panel2);
  border:1px solid var(--line); color:var(--bulb); font-size:16px; font-family:inherit; }
.btn{ padding:13px 18px; border-radius:9px; background:var(--amber); color:#14120F;
  font-weight:700; font-size:14px; letter-spacing:.06em; text-transform:uppercase; }
.btn.ghost-b{ background:transparent; border:1px solid var(--line); color:var(--bulb); }
.btn:disabled{ opacity:.35; }

.plist{ display:flex; flex-wrap:wrap; gap:7px; margin:12px 0; }
.pchip{ padding:9px 11px; border-radius:8px; background:var(--panel2); border:1px solid var(--line);
  display:flex; align-items:baseline; gap:7px; }
.pchip.on{ background:#3A2A0C; border-color:var(--amber); }
.pchip .n{ font-family:'Oswald',sans-serif; font-weight:700; font-size:17px; color:var(--amber); }
.pchip.on .n{ color:var(--amber); }
.pchip .nm{ font-size:12px; color:var(--muted); }
.pchip.on .nm{ color:var(--bulb); }
.pchip.gk{ border-left:3px solid var(--ok); }

.warn{ padding:11px 13px; border-radius:8px; background:rgba(229,72,77,.1);
  border:1px solid rgba(229,72,77,.4); font-size:12.5px; line-height:1.5; margin:10px 0; }
.warn b{ color:var(--alert); }
.note{ padding:11px 13px; border-radius:8px; background:var(--panel2); border:1px solid var(--line);
  font-size:12.5px; line-height:1.5; color:var(--muted); margin:10px 0; }

table.bx{ width:100%; border-collapse:collapse; font-size:13px; }
.bx th{ text-align:right; padding:7px 5px; font-size:9.5px; letter-spacing:.1em; color:var(--muted);
  border-bottom:1px solid var(--line); font-weight:700; }
.bx th:first-child, .bx td:first-child{ text-align:left; }
.bx td{ padding:8px 5px; text-align:right; border-bottom:1px solid rgba(58,52,40,.45);
  font-variant-numeric:tabular-nums; }
.bx td.j{ font-family:'Oswald',sans-serif; font-weight:700; color:var(--amber); }
.bx tr.tot td{ border-top:2px solid var(--line); font-weight:700; border-bottom:none; }

@media (prefers-reduced-motion:reduce){ .lx *{ animation:none!important; transition:none!important; } }
`;

/* ============================================================================
   § APP
   ========================================================================= */

const BOX_COLS = ["G", "A", "SH", "SOG", "GB", "DC", "CT", "TO", "FPG", "SV", "GA"];

export default function App() {
  const [screen, setScreen] = useState("setup");
  const [roster, setRoster] = useState([]);
  const [dressed, setDressed] = useState([]);
  const [keeper, setKeeper] = useState(null);
  const [opponent, setOpponent] = useState("");
  const [events, setEvents] = useState([]);
  const [period, setPeriod] = useState(1);
  const [ghost, setGhost] = useState("");
  const [held, setHeld] = useState(false);
  const [typed, setTyped] = useState("");
  const [textMode, setTextMode] = useState(false);
  const [ready, setReady] = useState(false);
  const [flashGroup, setFlashGroup] = useState(null);
  const [editing, setEditing] = useState(null);

  const blip = useBlip();
  const tapeRef = useRef(null);
  const stateRef = useRef({ dressed, keeper, period });
  useEffect(() => { stateRef.current = { dressed, keeper, period }; }, [dressed, keeper, period]);

  // load
  useEffect(() => {
    (async () => {
      setRoster(await loadKey("lax:roster", []));
      const g = await loadKey("lax:game", null);
      if (g) {
        setDressed(g.dressed || []); setKeeper(g.keeper ?? null);
        setOpponent(g.opponent || ""); setEvents(g.events || []);
        setPeriod(g.period || 1);
        if ((g.events || []).length) setScreen("live");
      }
      setReady(true);
    })();
  }, []);

  useEffect(() => { if (ready) saveKey("lax:roster", roster); }, [roster, ready]);
  useEffect(() => {
    if (ready) saveKey("lax:game", { dressed, keeper, opponent, events, period });
  }, [dressed, keeper, opponent, events, period, ready]);

  /* --- ingest one utterance --- */
  const ingest = useCallback((text, asrConf) => {
    if (!text) { setGhost(""); blip("err"); return; }
    const { dressed: d, keeper: k, period: p } = stateRef.current;
    const res = parseUtterance(text, { dressed: d, keeper: k, asrConf: asrConf ?? 0.9 });
    setGhost("");

    if (res.type === "command") {
      if (res.command === "undo") {
        setEvents((prev) => {
          const live = prev.filter((e) => e.status !== "void");
          if (!live.length) return prev;
          const gid = live[live.length - 1].groupId;
          return prev.map((e) => (e.groupId === gid ? { ...e, status: "void" } : e));
        });
        blip("warn");
      } else if (res.command === "period") {
        setPeriod((x) => (x >= 2 ? "OT" : x + 1)); blip("ok");
      } else if (res.command === "keeper" && res.jersey !== null) {
        setKeeper(res.jersey); blip("ok");
      } else if (res.command === "mark") {
        const ev = mkEvent({ groupId: ulid(), teamSide: "us", jersey: null, statType: "MARK",
          derived: false, conf: 0.4, transcript: text });
        setEvents((prev) => [...prev, ev]); blip("warn");
      }
      return;
    }

    if (res.type === "unparsed") {
      const ev = mkEvent({ groupId: ulid(), teamSide: "us", jersey: null, statType: "MARK",
        derived: false, conf: 0.3, transcript: text, note: res.reason });
      setEvents((prev) => [...prev, ev]);
      blip("err");
      return;
    }

    const stamped = res.events.map((e) => ({ ...e, period: p }));
    setEvents((prev) => [...prev, ...stamped]);
    setFlashGroup(res.groupId);
    setTimeout(() => setFlashGroup(null), 550);
    blip(res.confidence >= 0.75 ? "ok" : "warn");
  }, [blip]);

  const onFinal = useCallback((t, c) => ingest(t, c), [ingest]);
  const onInterim = useCallback((t) => setGhost(t), []);
  const speech = useSpeech(onFinal, onInterim);
  const voiceOK = speech.supported && !textMode;

  const pttDown = (e) => { e.preventDefault(); setHeld(true); blip("start"); if (voiceOK) speech.start(); };
  const pttUp = (e) => { e.preventDefault(); if (!held) return; setHeld(false); if (voiceOK) speech.stop(); };

  /* --- derived --- */
  const live = useMemo(() => events.filter((e) => e.status !== "void"), [events]);
  const usScore = live.filter((e) => e.teamSide === "us" && e.statType === "G" && !e.derived).length;
  const themScore = live.filter((e) => e.teamSide === "them" && e.statType === "G").length;
  const reviewCount = live.filter((e) => e.status === "review" && !e.derived).length;

  const conflicts = useMemo(() => {
    const out = [];
    for (const n of dressed) {
      const alt = CONFUSION[n];
      if (alt !== undefined && dressed.includes(alt) && n < alt) out.push([n, alt]);
    }
    return out;
  }, [dressed]);

  const tapeRows = useMemo(() => [...events].reverse(), [events]);

  const box = useMemo(() => {
    const rows = {};
    for (const e of live) {
      if (e.teamSide !== "us" || e.jersey === null) continue;
      if (!rows[e.jersey]) rows[e.jersey] = {};
      rows[e.jersey][e.statType] = (rows[e.jersey][e.statType] || 0) + 1;
    }
    return Object.entries(rows)
      .map(([j, s]) => ({ jersey: +j, name: (roster.find((p) => p.num === +j) || {}).name || "", ...s }))
      .sort((a, b) => a.jersey - b.jersey);
  }, [live, roster]);

  const setStatus = (id, status) => setEvents((p) => p.map((e) => (e.id === id ? { ...e, status } : e)));
  const voidGroup = (gid) => setEvents((p) => p.map((e) => (e.groupId === gid ? { ...e, status: "void" } : e)));
  const setJersey = (gid, j) =>
    setEvents((p) => p.map((e) => (e.groupId === gid && e.teamSide === "us"
      ? { ...e, jersey: j, status: "committed", parseConfidence: 1 } : e)));

  const download = (name, text, mime) => {
    const b = new Blob([text], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  if (!ready) return <div className="lx"><style>{CSS}</style></div>;

  /* ---------------------------------------------------------------- SETUP */
  if (screen === "setup") {
    return (
      <div className="lx">
        <style>{CSS}</style>
        <div className="pad">
          <div className="eyebrow">Phase 1 · Capture core</div>
          <h1 className="h1">Pre-game</h1>
          <p className="sub">Tap the players who are dressed. The parser only accepts numbers from this list, which is what makes fourteen-versus-forty survivable.</p>

          <RosterEditor roster={roster} setRoster={setRoster} />

          <div className="eyebrow" style={{ marginTop: 20 }}>Dressed · {dressed.length}</div>
          <div className="plist">
            {roster.slice().sort((a, b) => a.num - b.num).map((p) => {
              const on = dressed.includes(p.num);
              return (
                <button key={p.num}
                  className={"pchip" + (on ? " on" : "") + (keeper === p.num ? " gk" : "")}
                  onClick={() => setDressed((d) => on ? d.filter((x) => x !== p.num) : [...d, p.num])}
                  onDoubleClick={() => on && setKeeper(p.num)}>
                  <span className="n">{p.num}</span>
                  <span className="nm">{p.name}</span>
                </button>
              );
            })}
          </div>
          {roster.length === 0 && <div className="note">Add players above. Double-tap a dressed player to make her the keeper.</div>}

          {conflicts.length > 0 && (
            <div className="warn">
              <b>Phonetic conflict.</b> {conflicts.map(([a, b]) => `#${a} and #${b}`).join(", ")} sound alike to the recognizer and both are dressed. Say these digit-by-digit — "one five", "five oh" — or expect them in the review queue.
            </div>
          )}

          <div className="eyebrow" style={{ marginTop: 18 }}>Keeper</div>
          <div className="plist">
            {dressed.slice().sort((a, b) => a - b).map((n) => (
              <button key={n} className={"pchip" + (keeper === n ? " on" : "")} onClick={() => setKeeper(n)}>
                <span className="n">{n}</span>
              </button>
            ))}
          </div>

          <div className="eyebrow" style={{ marginTop: 18 }}>Opponent</div>
          <input className="inp" value={opponent} onChange={(e) => setOpponent(e.target.value)} placeholder="Opponent school" style={{ marginTop: 6 }} />

          {!speech.supported && (
            <div className="note" style={{ marginTop: 16 }}>
              Speech recognition isn't available here — likely the browser or a blocked mic permission. The app falls back to typing calls, which exercises the identical parser. Test the grammar this way, then run voice in the Expo build.
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 22 }}>
            <button className="btn" style={{ flex: 1 }} disabled={dressed.length === 0}
              onClick={() => setScreen("live")}>Start game</button>
            {events.length > 0 && (
              <button className="btn ghost-b" onClick={() => { setEvents([]); setPeriod(1); }}>Clear log</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ----------------------------------------------------------------- BOX */
  if (screen === "box") {
    return (
      <div className="lx">
        <style>{CSS}</style>
        <div className="pad">
          <div className="eyebrow">MaxPreps manual entry sheet</div>
          <h1 className="h1">{usScore}–{themScore} {opponent && <span style={{ fontSize: 15, color: "var(--muted)" }}>vs {opponent}</span>}</h1>
          <p className="sub">Field order matches MaxPreps' manual stat entry. Type it straight down the column.</p>
          <table className="bx">
            <thead><tr><th>#</th><th>Player</th>{BOX_COLS.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>
              {box.map((r) => (
                <tr key={r.jersey}>
                  <td className="j">{r.jersey}</td>
                  <td style={{ fontSize: 12, color: "var(--muted)" }}>{r.name}</td>
                  {BOX_COLS.map((c) => <td key={c}>{r[c] || ""}</td>)}
                </tr>
              ))}
              <tr className="tot">
                <td colSpan={2}>TEAM</td>
                {BOX_COLS.map((c) => <td key={c}>{box.reduce((s, r) => s + (r[c] || 0), 0) || ""}</td>)}
              </tr>
            </tbody>
          </table>
          <div style={{ display: "flex", gap: 8, marginTop: 20, flexWrap: "wrap" }}>
            <button className="btn ghost-b" onClick={() => setScreen("live")}>Back to game</button>
            <button className="btn ghost-b" onClick={() => download("events.json", JSON.stringify(events, null, 2), "application/json")}>Export log</button>
            <button className="btn ghost-b" onClick={() => {
              const head = ["jersey", "name", ...BOX_COLS].join(",");
              const body = box.map((r) => [r.jersey, r.name, ...BOX_COLS.map((c) => r[c] || 0)].join(",")).join("\n");
              download("boxscore.csv", head + "\n" + body, "text/csv");
            }}>Export CSV</button>
          </div>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- LIVE */
  return (
    <div className="lx">
      <style>{CSS}</style>

      <div className="board">
        <div className="bcell">
          <div className="eyebrow">Us</div>
          <div className="bscore">{usScore}</div>
        </div>
        <div className="bcell">
          <div className="eyebrow">{opponent ? opponent.slice(0, 12) : "Them"}</div>
          <div className="bscore">{themScore}</div>
        </div>
        <div className="bper">
          <div className="eyebrow">Per</div>
          <div className="disp" style={{ fontSize: 25, fontWeight: 700 }}>{period}</div>
        </div>
        <div className="bper" style={{ width: 68 }}>
          <div className="eyebrow">GK</div>
          <div className="disp" style={{ fontSize: 25, fontWeight: 700, color: "var(--ok)" }}>{keeper ?? "–"}</div>
        </div>
      </div>

      <div className="ghost">
        {held && <span className="pulse" />}
        <span className="ghost-txt">
          {ghost || (held ? "listening…" : <span style={{ color: "var(--muted)", fontSize: 15 }}>
            {live.length} events · {reviewCount > 0 ? `${reviewCount} need review` : "all clear"}
          </span>)}
        </span>
      </div>

      <div className="tape" ref={tapeRef}>
        {tapeRows.length === 0 && (
          <div style={{ padding: "26px 16px", color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>
            Hold the button and call the play.<br />
            <span style={{ color: "var(--amber-dim)" }}>"twenty two goal assist fourteen"</span><br />
            <span style={{ color: "var(--amber-dim)" }}>"ground ball seven"</span> · <span style={{ color: "var(--amber-dim)" }}>"draw eleven"</span><br />
            <span style={{ color: "var(--amber-dim)" }}>"save"</span> · <span style={{ color: "var(--amber-dim)" }}>"they goal"</span> · <span style={{ color: "var(--amber-dim)" }}>"undo"</span> · <span style={{ color: "var(--amber-dim)" }}>"mark"</span>
          </div>
        )}
        {tapeRows.map((e) => (
          <button key={e.id}
            className={"row" + (e.derived ? " der" : "") + (e.status === "review" ? " rev" : "")
              + (e.status === "void" ? " void" : "") + (e.groupId === flashGroup ? " new" : "")
              + (e.teamSide === "them" ? " them" : "")}
            onClick={() => setEditing(e)}>
            {!e.derived && <span className="r-time">{fmtTime(e.wallClock)}</span>}
            <span className="r-num">{e.derived ? "└" : (e.jersey ?? (e.teamSide === "them" ? "OPP" : "?"))}</span>
            <span className="r-stat">{STAT_LABEL[e.statType] || e.statType}
              {e.statType === "MARK" && <span style={{ color: "var(--muted)", fontWeight: 400, letterSpacing: 0, fontSize: 12 }}> · {e.rawTranscript}</span>}
            </span>
            {e.status === "review" && !e.derived && <span className="r-flag">CHECK</span>}
          </button>
        ))}
      </div>

      {textMode || !speech.supported ? (
        <div className="ptt-wrap">
          <input className="inp" value={typed} placeholder='Type a call — "22 goal assist 14"'
            onChange={(ev) => setTyped(ev.target.value)}
            onKeyDown={(ev) => { if (ev.key === "Enter" && typed.trim()) { ingest(typed.trim(), 1); setTyped(""); } }} />
          <button className="btn" style={{ width: "100%", marginTop: 8 }}
            onClick={() => { if (typed.trim()) { ingest(typed.trim(), 1); setTyped(""); } }}>Log call</button>
        </div>
      ) : (
        <div className="ptt-wrap">
          <div className={"ptt" + (held ? " hot" : "")}
            onPointerDown={pttDown} onPointerUp={pttUp} onPointerCancel={pttUp} onPointerLeave={pttUp}
            role="button" tabIndex={0} aria-label="Hold to call">
            <span className="ptt-lbl">{held ? "LISTENING" : "HOLD TO CALL"}</span>
            <span style={{ fontSize: 11, color: "var(--muted)", letterSpacing: ".1em" }}>
              {held ? "release to log" : "eyes on the field"}
            </span>
          </div>
        </div>
      )}

      <div className="bar">
        <button className="chip" onClick={() => setScreen("box")}>Box</button>
        <button className={"chip" + (reviewCount ? " warn" : "")} onClick={() => setScreen("box")}>
          Review {reviewCount || 0}
        </button>
        <button className="chip" onClick={() => {
          const l = live; if (!l.length) return; voidGroup(l[l.length - 1].groupId); blip("warn");
        }}>Undo</button>
        <button className="chip" onClick={() => setPeriod((x) => (x === "OT" ? 1 : x >= 2 ? "OT" : x + 1))}>Period +</button>
        <button className={"chip" + (textMode ? " on" : "")} onClick={() => setTextMode((v) => !v)}>
          {textMode ? "Typing" : "Voice"}
        </button>
        <button className="chip" onClick={() => setScreen("setup")}>Roster</button>
      </div>

      {editing && (
        <EditSheet ev={editing} dressed={dressed} roster={roster}
          onJersey={(j) => { setJersey(editing.groupId, j); setEditing(null); }}
          onCommit={() => { setStatus(editing.id, "committed"); setEditing(null); }}
          onVoid={() => { voidGroup(editing.groupId); setEditing(null); }}
          onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

/* ============================================================================
   § SUBVIEWS
   ========================================================================= */

function fmtTime(iso) {
  const d = new Date(iso);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

function RosterEditor({ roster, setRoster }) {
  const [num, setNum] = useState("");
  const [name, setName] = useState("");
  const add = () => {
    const n = parseInt(num, 10);
    if (isNaN(n) || n < 0 || n > 99) return;
    if (roster.some((p) => p.num === n)) return;
    setRoster([...roster, { num: n, name: name.trim() }]);
    setNum(""); setName("");
  };
  return (
    <div>
      <div className="eyebrow">Roster</div>
      <div style={{ display: "flex", gap: 7, marginTop: 6 }}>
        <input className="inp" style={{ width: 74 }} value={num} inputMode="numeric" placeholder="#"
          onChange={(e) => setNum(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <input className="inp" style={{ flex: 1 }} value={name} placeholder="Last name"
          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="btn" onClick={add}>Add</button>
      </div>
      {roster.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
          {roster.length} on roster ·{" "}
          <button style={{ textDecoration: "underline", color: "var(--muted)", fontSize: 12 }}
            onClick={() => setRoster([])}>clear roster</button>
        </div>
      )}
    </div>
  );
}

function EditSheet({ ev, dressed, roster, onJersey, onCommit, onVoid, onClose }) {
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(8,7,5,.82)", display: "flex",
      flexDirection: "column", justifyContent: "flex-end", zIndex: 20 }} onClick={onClose}>
      <div style={{ background: "var(--panel)", borderTop: "1px solid var(--line)",
        borderRadius: "16px 16px 0 0", padding: "18px 16px calc(18px + env(safe-area-inset-bottom))",
        maxHeight: "78%", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="eyebrow">Heard</div>
        <div className="disp" style={{ fontSize: 19, fontWeight: 300, color: "var(--amber)", margin: "3px 0 4px" }}>
          "{ev.rawTranscript}"
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 14 }}>
          {STAT_LABEL[ev.statType] || ev.statType}
          {ev.note && <> · {ev.note}</>}
          {" · confidence "}{Math.round(ev.parseConfidence * 100)}%
        </div>

        <div className="eyebrow">Reassign to</div>
        <div className="plist">
          {dressed.slice().sort((a, b) => a - b).map((n) => (
            <button key={n} className={"pchip" + (ev.jersey === n ? " on" : "")} onClick={() => onJersey(n)}>
              <span className="n">{n}</span>
              <span className="nm">{(roster.find((p) => p.num === n) || {}).name || ""}</span>
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          {ev.status === "review" && <button className="btn" style={{ flex: 1 }} onClick={onCommit}>Looks right</button>}
          <button className="btn ghost-b" style={{ flex: 1 }} onClick={onVoid}>Delete call</button>
          <button className="btn ghost-b" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
