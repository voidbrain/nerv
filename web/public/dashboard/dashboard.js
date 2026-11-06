/* Live mode (F-019): served by NERV Agency, the page always shows this service's real data (live.js) and never the
   simulation's invented numbers, even after a reload without a login code. The simulation runs only when the file is
   opened from disk, or with ?demo in the address. */
const LIVE = location.protocol !== "file:" && !/[?&]demo\b/.test(location.search);
"use strict";
/* ================= RULES (mirror src/policy.ts) ================= */
const EFFECT_FACTOR = { "read":1, "write-local":1, "write-external":0.9, "irreversible":0.6, "physical":0.5 };
const STAGE_FACTOR = { prototype:0.6, test:0.85, production:1 };
const SCROLLS = { deny:[], blue:[], syncThreshold:80, maxRejects:3, dailyBudget:1.00, approvalTtlMin:60 };
const isLocal = e => e === "read" || e === "write-local";
function patternOf(effect, trust, tool) {
  if (effect === "irreversible" || effect === "physical" || SCROLLS.blue.includes(tool) || (trust === "tainted" && !isLocal(effect))) return "blue";
  return isLocal(effect) ? "green" : "orange";
}
function executorOf(a, effect) {
  if (a.trust === "tainted" && isLocal(effect)) return "EVA-03";
  if (a.proactive && a.stage !== "production") return "EVA-00";
  return a.stage === "prototype" ? "EVA-00" : a.stage === "test" ? "EVA-01" : "EVA-02";
}
function ballot(a, spent, casper, extras) {
  const tool = TOOLS[a.tool]; const effect = tool ? tool.effect : "irreversible";
  const pattern = patternOf(effect, a.trust, a.tool); const executor = executorOf(a, effect);
  const v = [];
  v.push(SCROLLS.deny.includes(a.tool) ? { seat:"melchior", vote:"reject", reason:"Tool denied by the Scrolls." } : { seat:"melchior", vote:"approve", reason:"Effect class " + effect + "." });
  if (spent + a.cost > a.battery) v.push({ seat:"balthasar", vote:"reject", reason:"Battery exhausted: sortie budget exceeded." });
  else if (executor === "EVA-00" && !isLocal(effect)) v.push({ seat:"balthasar", vote:"reject", reason:"EVA-00 runs shadow work only." });
  else v.push({ seat:"balthasar", vote:"approve", reason: a.trust === "tainted" ? "Tainted context; external effects escalate." : "Within battery and executor class." });
  const needsCasper = pattern !== "green";
  if (needsCasper && casper) v.push(Object.assign({ seat:"casper" }, casper));
  (extras || []).forEach(x => v.push(Object.assign({}, x, { seat:"extra:" + x.seat })));
  const inputs = { effect:EFFECT_FACTOR[effect], stage:STAGE_FACTOR[a.stage] };
  if (needsCasper && casper && casper.vote === "approve") inputs.casper = casper.confidence;
  const value = Math.round(100 * Object.values(inputs).reduce((x, y) => x * y, 1));
  const veto = v.find(x => x.vote === "reject" && !x.shadow);
  const base = { effect, pattern, executor, verdicts:v, sync:{ value, inputs } };
  if (veto) return Object.assign(base, { outcome:"reject", reason:veto.seat + ": " + veto.reason });
  if (needsCasper && (!casper || casper.vote !== "approve")) return Object.assign(base, { outcome:"approval", reason:"Casper verdict unavailable; the owner decides." });
  if (pattern === "blue") return Object.assign(base, { outcome:"approval", reason:"Pattern Blue always needs the owner." });
  if (value < SCROLLS.syncThreshold) return Object.assign(base, { outcome:"approval", reason:"Sync Ratio " + value + "% below " + SCROLLS.syncThreshold + "%." });
  return Object.assign(base, { outcome:"grant", reason:"Sync Ratio " + value + "%." });
}

/* ================= INVENTED DATA ================= */
const TOOLS = {
  "mail.read":{ effect:"read" }, "calendar.read":{ effect:"read" }, "contacts.read":{ effect:"read" }, "web.fetch":{ effect:"read" },
  "reminders.add":{ effect:"write-local", inverse:"reminders.cancel" }, "notes.write":{ effect:"write-local", inverse:"notes.restore" },
  "mail.send":{ effect:"write-external" }, "git.branch.delete":{ effect:"irreversible" }, "charger.start":{ effect:"physical", inverse:"charger.stop" }
};
const BASES = [
  // Illustrative positions: three bases in the same hills-and-valleys district around Tokyo-3 (Hakone). A real deployment reads lat/lon from each base's enrolment.
  { id:"tokyo3", name:"TOKYO-3", role:"HQ · coordinator · MAGI · Dogma", lat:35.236, lon:138.985, status:"online", cpu:22, gpu:null, ram:61, rtt:0, models:"S² gemma (Mac)" },
  { id:"nerv01", name:"NERV-01", role:"branch · S² GPU · EVA cage", lat:35.305, lon:139.215, status:"online", cpu:35, gpu:58, ram:47, rtt:142, models:"S² qwen-coder (GPU)" },
  { id:"nerv02", name:"NERV-02", role:"branch · vault · EVA cage", lat:35.160, lon:139.240, status:"standby", cpu:4, gpu:null, ram:18, rtt:null, models:"—" }
];
const LINKS = [["tokyo3","nerv01"],["tokyo3","nerv02"],["nerv01","nerv02"]];
const CAGES = [
  { id:"EVA-00", label:"PROTOTYPE · shadow", base:"tokyo3", color:"#2a7fff" },
  { id:"EVA-01", label:"TEST TYPE · bounded", base:"nerv01", color:"#9b5cff" },
  { id:"EVA-02", label:"PRODUCTION · full grant", base:"tokyo3", color:"#ff3b30" },
  { id:"EVA-03", label:"QUARANTINE · tainted", base:"nerv02", color:"#8a8a8a" }
];
const PILOTS = [
  { id:"mail-brief", stage:"production", runs:41, rejects:0, overrides:1 },
  { id:"reply-draft", stage:"test", runs:12, rejects:1, overrides:3 },
  { id:"repo-tidy", stage:"test", runs:6, rejects:0, overrides:0 },
  { id:"web-clipper", stage:"prototype", runs:3, rejects:0, overrides:0 },
  { id:"fpv-charger", stage:"test", runs:9, rejects:0, overrides:0 }
];
/* Requests the planner understands; the Pattern always comes from the tool's effect class. */
const PRESETS = {
  brief:{ title:"Summarise unread mail", pilot:"mail-brief", source:"aoba", consult:false,
    plan:[{ tool:"mail.read", args:{ folder:"INBOX", unread:true, limit:20 }, taintAfter:true, cost:0.004 },
          { tool:"notes.write", args:{ path:"briefs/today.md", from:"summary" }, cost:0.002 }] },
  reply:{ title:"Reply to Luca that I'm late", pilot:"reply-draft", source:"aoba", consult:false,
    plan:[{ tool:"contacts.read", args:{ name:"Luca" }, cost:0.001 },
          { tool:"mail.send", args:{ to:"luca@example.com", subject:"Running late", body:"Hi Luca, I'm 15 minutes late. Sorry!" }, cost:0.006, casper:0.92 }] },
  branches:{ title:"Delete merged branches in repo", pilot:"repo-tidy", source:"aoba", consult:true,
    plan:[{ tool:"git.branch.delete", args:{ repo:"example/app", branches:["feat/old-login","fix/typo-42"] }, cost:0.003, casper:0.95 }] },
  charger:{ title:"Charge FPV battery at 18:00", pilot:"fpv-charger", source:"aoba", consult:false,
    plan:[{ tool:"charger.start", args:{ device:"bench-charger", pack:"6S-1300", profile:"storage→full" }, cost:0.001, casper:0.97 }] },
  note:{ title:"Save a note from this web page", pilot:"web-clipper", source:"aoba", consult:false,
    plan:[{ tool:"web.fetch", args:{ url:"https://example.com/article" }, taintAfter:true, cost:0.002 },
          { tool:"notes.write", args:{ path:"clips/article.md" }, cost:0.001 }] }
};
const STEP_IDS = ["detect","intake","route","consult","plan","magi","sync","apt","plug","eva","debrief"];
const LABELS = {
  eva:{ brandTitle:"TACTICAL COMMAND", brandTag:"SEELE SCROLLS ENFORCED // CENTRAL DOGMA LEDGER · LILITH MEMORY",
    needs:"Misato's apartment · needs you", sorties:"Sorties", next:"Coming up", flow:"Sephirot · sortie flow",
    detail:"Misato plan · current action", log:"Comms · Misato & Maya trace", away:"Debrief · while you were away", health:"Health",
    bases:"NERV bases · Kaji line", cages:"EVA cages · heartbeat", budget:"Battery · budget", melons:"Marduk Institute · Pilots", skills:"Kaji's watermelons · skills", skillStages:"seed → sprout → ripe", lilith:"Terminal Dogma · Lilith",
    spear:"SPEAR OF LONGINUS", dummy:"DUMMY PLUG ACTIVE", launch:"Launch",
    qNeeds:"Needs you", qAway:"While you were away", qNext:"Coming up", qHealth:"Broken or stuck", qBudget:"Battery today",
    steps:{ detect:"Detect", intake:"Naoko", route:"Gendo", consult:"Consult", plan:"Misato", magi:"MAGI", sync:"Sync", apt:"Apartment", plug:"Plug", eva:"EVA", debrief:"Debrief" },
    seats:{ melchior:"MELCHIOR", balthasar:"BALTHASAR", casper:"CASPER" }, short:{ melchior:"MEL", balthasar:"BAL", casper:"CAS" } },
  neutral:{ brandTitle:"OPERATIONS", brandTag:"owner rules enforced · append-only ledger · long-term memory",
    needs:"Needs your approval", sorties:"Jobs", next:"Coming up", flow:"Decision timeline",
    detail:"Plan · current action", log:"Messages · trace", away:"While you were away", health:"Health",
    bases:"Machines · mesh", cages:"Sandboxes · heartbeat", budget:"Budget", melons:"Pilots", skills:"Skills", skillStages:"create → try → use", lilith:"Memory",
    spear:"STOP EVERYTHING", dummy:"MODELS UNAVAILABLE", launch:"Run",
    qNeeds:"Needs you", qAway:"While you were away", qNext:"Coming up", qHealth:"Broken or stuck", qBudget:"Budget today",
    steps:{ detect:"Ingress", intake:"Intake", route:"Route", consult:"Consult", plan:"Plan", magi:"Review", sync:"Confidence", apt:"Approval", plug:"Grant", eva:"Sandbox", debrief:"Done" },
    seats:{ melchior:"RULES", balthasar:"PROTECT", casper:"INTENT" }, short:{ melchior:"rules", balthasar:"protect", casper:"intent" } }
};

/* ================= STATE ================= */
const T0 = Date.now(); const MIN = 60000; const HOUR = 60 * MIN;
let state;
function freshState() {
  const s = { theme:"eva", mode:"dark", accent:"orange", crt:false, dummy:false, selected:null, filter:"all", lastVisit:T0 - 7.5 * HOUR,
    sorties:[], approvals:[], log:[], spentToday:0, routeSpend:{ s2:0, umbilical:0 }, deliveries:[], packets:[], seq:0, retries:[] };
  return s;
}
/* F-019: the searched text marked in a title: escaped first, then each case-insensitive occurrence wrapped in <mark>. */
function highlight(text, q) {
  const t = esc(text), n = String(q || "").trim(); if (!n) return t;
  const needle = esc(n).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); return t.replace(new RegExp(needle, "gi"), m => "<mark>" + m + "</mark>");
}
function esc(v) { return String(v).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c])); }
function hhmm(t) { const d = new Date(t); return d.toTimeString().slice(0, 5); }
/* B-002: a time with its day when it is not today (browser local time): 14:05 · yesterday 14:05 · 3 Nov 14:05 · 3 Nov 2025 14:05. */
function dayTime(t, now) { const d = new Date(t), n = new Date(now === undefined ? Date.now() : now), y = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1); const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); if (same(d, n)) return hhmm(t); if (same(d, y)) return "yesterday " + hhmm(t); return d.toLocaleDateString("en-GB", d.getFullYear() === n.getFullYear() ? { day:"numeric", month:"short" } : { day:"numeric", month:"short", year:"numeric" }) + " " + hhmm(t); }
function ago(t) { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? s + " s" : s < 3600 ? Math.round(s / 60) + " min" : (s / 3600).toFixed(1) + " h"; }
function L() { return state.theme === "eva" ? LABELS.eva : LABELS.neutral; }
function isEvaFull() { return state.theme === "eva"; }
/* Image slots: drop files into docs/NERV/assets/ (see ASSETS below). Until then an original pixel placeholder is drawn. */
const ASSETS = {
  misato:{ file:"assets/avatars/misato.png", color:"#e0457b", glyph:"M", eva:"Misato", plain:"Planner" },
  ritsuko:{ file:"assets/avatars/ritsuko.png", color:"#f2c14e", glyph:"R", eva:"Ritsuko", plain:"Reviewer" },
  maya:{ file:"assets/avatars/maya.png", color:"#4ec9f2", glyph:"Y", eva:"Maya", plain:"Trace" },
  aoba:{ file:"assets/avatars/aoba.png", color:"#8be04e", glyph:"A", eva:"Aoba", plain:"Channel" },
  hyuga:{ file:"assets/avatars/hyuga.png", color:"#4e7bf2", glyph:"H", eva:"Hyuga", plain:"Trigger" },
  gendo:{ file:"assets/avatars/gendo.png", color:"#ff6600", glyph:"G", eva:"Gendo", plain:"Router" },
  naoko:{ file:"assets/avatars/naoko.png", color:"#b38cff", glyph:"N", eva:"Naoko", plain:"Intake" },
  kaji:{ file:"assets/avatars/kaji.png", color:"#2fbf71", glyph:"K", eva:"Kaji", plain:"Trust" },
  penpen:{ file:"assets/avatars/penpen.png", color:"#9ad0ff", glyph:"P", eva:"Pen Pen", plain:"Notifier" },
  magi:{ file:"assets/avatars/magi.png", color:"#ff6600", glyph:"M", eva:"MAGI", plain:"Review" },
  you:{ file:"assets/avatars/you.png", color:"#ffffff", glyph:"Y", eva:"You", plain:"You" },
  "eva-00":{ file:"assets/eva/eva-00.png", color:"#2a7fff", glyph:"0", eva:"EVA-00", plain:"Sandbox 0", unit:true },
  "eva-01":{ file:"assets/eva/eva-01.png", color:"#9b5cff", glyph:"1", eva:"EVA-01", plain:"Sandbox 1", unit:true },
  "eva-02":{ file:"assets/eva/eva-02.png", color:"#ff3b30", glyph:"2", eva:"EVA-02", plain:"Sandbox 2", unit:true },
  "eva-03":{ file:"assets/eva/eva-03.png", color:"#8a8a8a", glyph:"3", eva:"EVA-03", plain:"Sandbox 3", unit:true }
};
const GLYPHS = { M:"101111111101101", R:"110101110101101", A:"010101111101101", H:"101101111101101", G:"011100101101011", N:"110101101101101", K:"101101110101101", P:"110101110100100", Y:"101101010010010", "0":"111101101101111", "1":"010110010010111", "2":"111001111100111", "3":"111001111001111" };
const placeholders = {};
function placeholder(key) {
  if (placeholders[key]) return placeholders[key];
  const a = ASSETS[key]; const W = a.unit ? 24 : 16, H = 16; const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d");
  x.fillStyle = "#07070a"; x.fillRect(0, 0, W, H);
  let h = 0; for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  x.fillStyle = a.color; x.globalAlpha = 0.28; // mirrored pattern, original and abstract
  for (let yy = 1; yy < H - 1; yy++) for (let xx = 1; xx < W / 2; xx++) { h = (h * 1103515245 + 12345) >>> 0; if ((h >> 16) & 1) { x.fillRect(xx, yy, 1, 1); x.fillRect(W - 1 - xx, yy, 1, 1); } }
  x.globalAlpha = 1; const g = GLYPHS[a.glyph]; const ox = Math.floor(W / 2) - 3, oy = 3;
  for (let i = 0; i < 15; i++) if (g[i] === "1") x.fillRect(ox + (i % 3) * 2, oy + Math.floor(i / 3) * 2, 2, 2);
  x.strokeStyle = a.color; x.lineWidth = 1; x.strokeRect(0.5, 0.5, W - 1, H - 1);
  return (placeholders[key] = c.toDataURL());
}
function fillAvatars(root) {
  (root || document).querySelectorAll("img[data-av]").forEach(img => {
    const a = ASSETS[img.dataset.av]; if (!a || img.dataset.done === img.dataset.av) return;
    img.dataset.done = img.dataset.av; img.onerror = () => { img.onerror = null; img.src = placeholder(img.dataset.av); }; img.src = a.file;
  });
}
function speakerOf(msg) {
  const m = [[/^Detection: Hyuga/, "hyuga"], [/^Detection/, "aoba"], [/^Naoko/, "naoko"], [/^Gendo/, "gendo"], [/^MAGI/, "magi"], [/^Approval card/, "penpen"], [/^Owner/, "you"], [/^(EVA-0\d)/, null], [/^Watermelons|^Promotion/, "kaji"], [/^Debrief|^Misato/, "misato"], [/^SPEAR|^Spear/, "gendo"]];
  for (const [re, who] of m) { const r = re.exec(msg); if (r) return who || r[1].toLowerCase(); }
  return "maya";
}
function speakerName(who) { const a = ASSETS[who] || ASSETS.maya; return state.theme === "eva" ? a.eva : a.plain; }
function log(msg, cls, sortie, who) {
  state.log.push({ t:Date.now(), msg, cls:cls || "", s:sortie ? sortie.id : null, who:who || speakerOf(msg) });
  if (state.log.length > 300) state.log.shift();
  renderLog();
}
function newId() { state.seq += 1; return "S-" + String(400 + state.seq); }
function pilotStage(p) { const x = PILOTS.find(q => q.id === p); return x ? x.stage : "prototype"; }

/* ================= SORTIE ENGINE ================= */
function makeSortie(preset, title, opts) {
  const p = PRESETS[preset];
  const s = { id:newId(), title:title || p.title, preset, pilot:p.pilot, source:p.source, proactive:!!p.proactive, consult:p.consult,
    trust:"trusted", battery:0.05, spent:0, started:(opts && opts.at) || Date.now(), ended:null, status:"active", phase:"detect",
    done:{}, actions:p.plan.map(a => Object.assign({ status:"planned", rejects:0 }, JSON.parse(JSON.stringify(a)))), current:0, ballot:null, route:"s2", outcome:null, happened:[] };
  return s;
}
function setPhase(s, phase, note) {
  if (s.phase && s.phase !== phase) s.done[s.phase] = true;
  // Back to the plan (a reject, an edit, the next action): the pass after the plan starts over.
  if (phase === "plan" && s.done.magi) STEP_IDS.slice(STEP_IDS.indexOf("plan") + 1).forEach(id => { delete s.done[id]; });
  s.phase = phase; s.note = note || "";
  if (state.selected === s.id) renderFlow();
  renderSorties();
}
const wait = ms => new Promise(r => setTimeout(r, ms));
async function runSortie(s) {
  const fast = 420;
  log("Detection: " + (s.source === "hyuga" ? "Hyuga trigger" : "Aoba message") + " → " + s.title, "", s);
  setPhase(s, "detect", s.source === "hyuga" ? "Hyuga watch fired (proactive sortie)" : "Aoba received your message"); await wait(fast);
  setPhase(s, "intake", "Naoko opens " + s.id + " in Central Dogma · provenance: trusted (you)"); await wait(fast);
  if (state.dummy) { s.status = "waiting-route"; setPhase(s, "route", "No model route reachable: sortie waits (Dummy Plug)"); log("Gendo: no route; " + s.id + " waits", "warn", s); renderAll(); return; }
  s.route = "s2";
  setPhase(s, "route", "Gendo: pilot " + s.pilot + " (" + pilotStage(s.pilot) + ") · S² local · battery $" + s.battery.toFixed(2)); await wait(fast);
  for (; s.current < s.actions.length; s.current++) {
    if (s.status === "stood-down") return;
    const a = s.actions[s.current];
    if (s.consult && s.current === 0) { setPhase(s, "consult", "Misato asks a consultant: 'are these branches merged?' → advice into the LCL, no vote"); await wait(fast); }
    a.status = "proposed";
    setPhase(s, "plan", "Misato proposes action " + (s.current + 1) + "/" + s.actions.length + ": " + a.tool); await wait(fast);
    const casper = TOOLS[a.tool] && isLocal(TOOLS[a.tool].effect) && s.trust !== "tainted" ? null : { vote:"approve", confidence:a.casper || 0.9, reason:"Matches the request." };
    const extras = a.tool === "git.branch.delete" ? [{ seat:"semgrep", vote:"approve", reason:"no findings" }, { seat:"nerv01-copy", vote:"approve", reason:"agrees", shadow:true }] : [];
    s.ballot = null; setPhase(s, "magi", "MAGI ballot on " + a.tool); renderMagiPending(s, a); await wait(fast * 1.6);
    const b = ballot({ tool:a.tool, args:a.args, trust:s.trust, stage:pilotStage(s.pilot), cost:a.cost, battery:s.battery, proactive:s.proactive }, s.spent, casper, extras);
    a.ballot = b; s.ballot = b;
    log("MAGI " + a.tool + " → Pattern " + b.pattern.toUpperCase() + " · " + b.outcome + " · " + b.reason, b.outcome === "reject" ? "danger" : b.outcome === "approval" ? "warn" : "ok", s);
    setPhase(s, "sync", "Sync Ratio " + b.sync.value + "% = " + syncFormula(b)); await wait(fast);
    if (b.outcome === "reject") {
      a.rejects += 1; a.status = "rejected";
      if (a.rejects >= SCROLLS.maxRejects) { await askOwner(s, a, b, "Rejected " + a.rejects + " times; the owner decides."); if (s.status === "stood-down") return; }
      else { setPhase(s, "plan", "Rejected → back to Misato (" + a.rejects + "/" + SCROLLS.maxRejects + ")"); s.status = "stood-down"; s.outcome = "rejected by MAGI"; finish(s); return; }
    } else if (b.outcome === "approval") {
      const decision = await askOwner(s, a, b, b.reason);
      if (decision !== "approve") return;
    }
    await execute(s, a, b);
    if (a.taintAfter) { s.trust = "tainted"; log("Naoko: result contains third-party content → Ireul taint on the LCL", "warn", s); }
  }
  finish(s);
}
function syncFormula(b) { const i = b.sync.inputs; return "effect " + i.effect + " × stage " + i.stage + (i.casper != null ? " × Casper " + i.casper : ""); }
function askOwner(s, a, b, reason) {
  return new Promise(resolve => {
    a.status = "waiting"; s.status = "waiting";
    const ap = { id:"AP-" + s.id.slice(2) + "-" + (s.current + 1), sortie:s.id, action:a, ballot:b, reason, created:Date.now(), expires:Date.now() + SCROLLS.approvalTtlMin * MIN, resolve };
    state.approvals.push(ap);
    setPhase(s, "apt", "Pen Pen delivered the card to Misato's apartment · TTL " + SCROLLS.approvalTtlMin + " min");
    log("Approval card " + ap.id + ": " + a.tool + " · " + reason, "warn", s);
    renderAll();
  });
}
function decide(apId, decision) {
  const ap = state.approvals.find(x => x.id === apId); if (!ap) return;
  state.approvals = state.approvals.filter(x => x.id !== apId);
  const s = state.sorties.find(x => x.id === ap.sortie);
  log("Owner " + decision + " " + ap.id + " (" + ap.action.tool + ")", decision === "approve" ? "ok" : "danger", s);
  if (decision === "approve") { s.status = "active"; ap.resolve("approve"); }
  else if (decision === "edit") {
    ap.action.status = "planned"; s.status = "active";
    setPhase(s, "plan", "Edit → back to Misato: the plan is replanned with your change");
    if (ap.action.tool === "mail.send") ap.action.args.body = "Hi Luca, running 15 min late, see you soon.";
    s.current -= 0; ap.resolve("edit"); setTimeout(() => continueAfterEdit(s), 300);
  } else { ap.action.status = "stood-down"; s.status = "stood-down"; s.outcome = decision === "expired" ? "approval expired" : "rejected by you"; finish(s); ap.resolve(decision); }
  renderAll();
}
async function continueAfterEdit(s) { await runFrom(s); }
async function runFrom(s) { // resume the loop at the current action after an edit
  const saved = s.current; s.actions[saved].status = "planned";
  await (async () => {
    for (; s.current < s.actions.length; s.current++) {
      const a = s.actions[s.current];
      setPhase(s, "plan", "Misato re-proposes " + a.tool + " with your edit"); await wait(420);
      const casper = { vote:"approve", confidence:Math.min(0.99, (a.casper || 0.9) + 0.05), reason:"Matches the edited request." };
      setPhase(s, "magi", "MAGI ballot on the edited action"); renderMagiPending(s, a); await wait(600);
      const b = ballot({ tool:a.tool, args:a.args, trust:s.trust, stage:pilotStage(s.pilot), cost:a.cost, battery:s.battery }, s.spent, casper, []);
      a.ballot = b; s.ballot = b; setPhase(s, "sync", "Sync Ratio " + b.sync.value + "% = " + syncFormula(b)); await wait(420);
      if (b.outcome !== "grant") { const d = await askOwner(s, a, b, b.reason); if (d !== "approve") return; }
      await execute(s, a, b);
    }
    finish(s);
  })();
}
async function execute(s, a, b) {
  if (s.status === "stood-down") return;
  setPhase(s, "plug", "Ritsuko signs the A.T. Field: " + a.tool + " · single use · 60 s · args hash bound"); await wait(380);
  const cage = CAGES.find(c => c.id === b.executor) || CAGES.find(c => c.id === "EVA-02");
  const base = BASES.find(x => x.id === cage.base);
  if (base.id !== "tokyo3") sendPacket("tokyo3", base.id, "plug");
  activeCage[cage.id] = Date.now() + 1600;
  setPhase(s, "eva", b.executor + " @ " + base.name + " executes " + a.tool + " · field checked at the executor"); await wait(700);
  if (base.id !== "tokyo3") sendPacket(base.id, "tokyo3", "result");
  a.status = "done"; s.spent += a.cost; state.spentToday += a.cost;
  if (a.casper) { state.routeSpend.umbilical += 0.004; state.spentToday += 0.004; }
  if (!isLocal(TOOLS[a.tool].effect)) s.happened.push({ tool:a.tool, inverse:TOOLS[a.tool].inverse || null });
  log(b.executor + " done: " + a.tool + " → result back to Misato", "ok", s);
  renderAll();
}
function finish(s) {
  if (!s.ended) s.ended = Date.now();
  if (s.status !== "stood-down" && s.status !== "failed") { s.status = "done"; s.outcome = s.outcome || "completed"; }
  s.done[s.phase] = true; s.phase = "debrief";
  if (state.selected === s.id) renderFlow();
  log("Debrief " + s.id + ": " + s.outcome, s.status === "done" ? "ok" : "warn", s);
  renderAll();
}
function launch(preset, title) {
  const s = makeSortie(preset, title);
  state.sorties.unshift(s); state.selected = s.id; renderAll(); runSortie(s);
}
function spearAll() {
  let revoked = 0, stood = 0; const happened = [];
  state.approvals.slice().forEach(ap => { decide(ap.id, "reject"); stood += 1; });
  state.sorties.forEach(s => { if (s.status === "active" || s.status === "waiting-route") { s.status = "stood-down"; s.outcome = "Spear"; revoked += 1; finish(s); } s.happened.forEach(h => happened.push(h)); });
  log("SPEAR: " + revoked + " sorties cancelled, " + stood + " approvals stood down. Effects that happened: " + (happened.map(h => h.tool + (h.inverse ? " (inverse " + h.inverse + ")" : " (no inverse: needs attention)")).join(", ") || "none"), "danger");
  renderAll();
}

/* ================= SEEDED HISTORY ("while you were away") ================= */
function seed() {
  state = freshState();
  const mk = (preset, minutesAgo, status, outcome, extra) => {
    const s = makeSortie(preset, null, { at:T0 - minutesAgo * MIN });
    s.status = status; s.outcome = outcome; s.phase = "debrief"; s.ended = s.started + 2 * MIN;
    STEP_IDS.forEach(k => s.done[k] = true); if (!s.consult) delete s.done.consult;
    s.actions.forEach(a => { a.status = status === "done" ? "done" : a.status; });
    Object.assign(s, extra || {}); state.sorties.push(s); return s;
  };
  mk("brief", 410, "done", "completed · brief saved to notes", { spent:0.006 });
  const exp = mk("reply", 300, "stood-down", "approval expired (TTL 60 min) · nothing sent");
  exp.actions[1].status = "stood-down"; exp.actions[0].status = "done";
  mk("note", 180, "done", "completed · clip saved (content tainted, kept in EVA-03)", { spent:0.003 });
  mk("charger", 95, "done", "Hyuga dry run in EVA-00: plan checked, nothing switched on (proactive, test-stage pilot)", { spent:0.001, source:"hyuga", proactive:true, title:"Charge FPV battery (proactive)" });
  const failed = mk("brief", 40, "failed", "failed · S² timed out twice, retry at next heartbeat");
  failed.actions.forEach(a => a.status = "failed");
  state.retries.push({ sortie:failed.id, what:"S² timeout · mail.read", attempts:2, next:T0 + 4 * MIN });
  state.spentToday = 0.13; state.routeSpend = { s2:0, umbilical:0.13 };
  state.deliveries = [
    { title:"Pay the electricity bill", at:T0 - 6 * HOUR, status:"delivered" },
    { title:"Call the dentist", at:T0 - 3 * HOUR, status:"delivered" },
    { title:"Water the plants", at:T0 - 70 * MIN, status:"delivered" }
  ];
  state.upcoming = [
    { kind:"reminder", title:"Stand-up with the team", at:T0 + 25 * MIN },
    { kind:"hyuga", title:"Charge FPV battery (proactive, EVA-00 dry run)", at:T0 + 2.4 * HOUR },
    { kind:"reminder", title:"Pick up parcel", at:T0 + 5 * HOUR },
    { kind:"hyuga", title:"Morning brief · mail + calendar", at:T0 + 14 * HOUR },
    { kind:"reminder", title:"Renew passport form", at:T0 + 20 * HOUR }
  ];
  state.sorties.sort((a, b) => b.started - a.started);
  // two live sorties waiting for you
  const b = makeSortie("branches"); state.sorties.unshift(b); runSortie(b);
  const r = makeSortie("reply"); state.sorties.unshift(r); runSortie(r);
  state.selected = r.id;
  log("NERV Agency online · shadow UI · " + state.sorties.length + " sorties in Central Dogma", "ok");
}

/* ================= RENDER: questions ================= */
function renderQuestions() {
  const n = state.approvals.length;
  const qn = document.getElementById("q-needs");
  document.getElementById("qv-needs").textContent = n;
  document.getElementById("qd-needs").textContent = n ? state.approvals.map(a => a.action.tool).join(" · ") : "nothing waits for you";
  qn.classList.toggle("alert", n > 0);
  const away = awaySummary();
  document.getElementById("qv-away").textContent = away.done + " done";
  document.getElementById("qd-away").textContent = away.expired + " expired · " + away.failed + " failed · " + away.delivered + " reminders";
  document.getElementById("q-away").classList.toggle("attn", away.expired + away.failed > 0);
  const next = state.upcoming.filter(u => u.at > Date.now()).sort((a, b) => a.at - b.at)[0];
  document.getElementById("qv-next").textContent = next ? hhmm(next.at) : "—";
  document.getElementById("qd-next").textContent = next ? next.title + " · in " + ago(Date.now() - (next.at - Date.now())) : "nothing scheduled";
  const h = healthIssues();
  document.getElementById("qv-health").textContent = h.length ? h.length + " issue" + (h.length > 1 ? "s" : "") : "OK";
  document.getElementById("qd-health").textContent = h.length ? h.map(x => x.short).join(" · ") : "all checks pass";
  document.getElementById("q-health").classList.toggle("alert", h.some(x => x.sev === "danger"));
  document.getElementById("q-health").classList.toggle("attn", h.length > 0 && !h.some(x => x.sev === "danger"));
  const fc = forecast();
  document.getElementById("qv-budget").textContent = "$" + state.spentToday.toFixed(2);
  document.getElementById("qd-budget").textContent = "of $" + SCROLLS.dailyBudget.toFixed(2) + " · forecast $" + fc.toFixed(2);
  document.getElementById("q-budget").classList.toggle("attn", fc > SCROLLS.dailyBudget * 0.8);
}
function awaySummary() {
  const since = state.lastVisit;
  const ss = state.sorties.filter(s => s.ended && s.ended >= since && s.started < T0);
  return { since, list:ss, done:ss.filter(s => s.status === "done").length, expired:ss.filter(s => /expired/.test(s.outcome || "")).length,
    failed:ss.filter(s => s.status === "failed").length, delivered:state.deliveries.filter(d => d.at >= since).length,
    spent:ss.reduce((x, s) => x + s.spent, 0) };
}
function forecast() { const d = new Date(); const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); const frac = Math.max(0.05, (Date.now() - start) / (24 * HOUR)); return state.spentToday / frac; }
function healthIssues() {
  const out = [];
  if (state.dummy) out.push({ sev:"danger", short:"no model route", text:"S² and Umbilical unreachable · Dummy Plug" });
  state.retries.forEach(r => out.push({ sev:"warn", short:"retrying " + r.sortie, text:r.sortie + " · " + r.what + " · attempt " + r.attempts + "/3 · next " + hhmm(r.next) }));
  state.sorties.filter(s => s.status === "waiting-route").forEach(s => out.push({ sev:"warn", short:s.id + " waits", text:s.id + " waits for a model route" }));
  const soon = state.approvals.filter(a => a.expires - Date.now() < 15 * MIN);
  soon.forEach(a => out.push({ sev:"warn", short:a.id + " expiring", text:a.id + " expires in " + Math.max(0, Math.round((a.expires - Date.now()) / MIN)) + " min" }));
  BASES.filter(b => b.status === "offline").forEach(b => out.push({ sev:"warn", short:b.name + " offline", text:b.name + " offline · its plugs wait or expire" }));
  return out;
}

/* ================= RENDER: needs you ================= */
function renderNeeds() {
  const box = document.getElementById("needs-list");
  document.getElementById("needs-count").textContent = state.approvals.length;
  if (!state.approvals.length) { box.innerHTML = "<div class='muted small'>Nothing needs you. When an action needs your yes, its card appears here with the exact action, why it stopped and when it expires: answer here, with the keys a and r, or on Telegram.</div>"; return; }
  if (armed && !state.approvals.some(ap => ap.id === armed.id)) armed = null;
  box.innerHTML = state.approvals.map(ap => {
    const a = ap.action, b = ap.ballot, s = state.sorties.find(x => x.id === ap.sortie);
    const left = Math.max(0, ap.expires - Date.now()); const mm = Math.floor(left / MIN), ss = Math.floor(left % MIN / 1000);
    return "<article class='apcard " + b.pattern + (armed && armed.id === ap.id ? " armed" : "") + "' data-card='" + ap.id + "'>" +
      "<div class='row'><span class='what'>" + esc(humanAction(a)) + "</span><span class='badge b-" + b.pattern + "'>PATTERN " + b.pattern.toUpperCase() + "</span></div>" +
      "<div class='small muted'>" + esc(s.id) + " · " + esc(s.title) + (LIVE ? "" : " · pilot " + esc(s.pilot) + " (" + pilotStage(s.pilot) + ")") + "</div>" +
      "<code style='margin-top:4px'>" + esc(a.tool) + " " + esc(JSON.stringify(a.args, null, 1)) + "</code>" +
      "<div class='kv' style='margin-top:4px'><span>effect</span><span>" + b.effect + (TOOLS[a.tool].inverse ? " · undo: " + TOOLS[a.tool].inverse : " · <span class='danger'>no undo</span>") + "</span>" +
      "<span>executor</span><span>" + b.executor + "</span>" +
      "<span>sync</span><span><b class='" + (b.sync.value >= SCROLLS.syncThreshold ? "ok" : "warn") + "'>" + b.sync.value + "%</b> = " + esc(syncFormula(b)) + "</span></div>" +
      "<div class='verdicts'>" + b.verdicts.map(v => "<span class='vchip " + v.vote + (v.shadow ? " shadow" : "") + "' title='" + esc(v.reason) + "'>" + esc(seatName(v.seat)) + " " + (v.vote === "approve" ? "✓" : v.vote === "reject" ? "✗" : "·") + (v.confidence ? " " + v.confidence : "") + (v.shadow ? " (shadow)" : "") + "</span>").join("") + "</div>" +
      "<div class='why'><b>Why it stopped:</b> " + esc(ap.reason) + "</div>" +
      "<div class='row small' style='margin-top:4px'><span class='muted'>asked " + ago(ap.created) + " ago</span><span class='" + (left < 15 * MIN ? "warn b" : "muted") + "'>expires in " + mm + ":" + String(ss).padStart(2, "0") + " · expiry never approves</span></div>" +
      "<div class='acts'><button class='btn primary' data-ap='" + ap.id + "' data-d='approve' aria-keyshortcuts='a'>Approve once</button><button class='btn' data-ap='" + ap.id + "' data-d='edit'>Edit → Misato</button><button class='btn danger' data-ap='" + ap.id + "' data-d='reject' aria-keyshortcuts='r'>Reject</button></div>" +
      "</article>";
  }).join("") + "<div class='tiny muted keyhint'>Keys: <kbd>a</kbd> approve · <kbd>r</kbd> reject (press twice to confirm; the focused card, else the first) · <kbd>/</kbd> search sorties</div>";
}
function humanAction(a) {
  const x = a.args;
  switch (a.tool) {
    case "mail.send": return "Send email to " + x.to + ": “" + x.subject + "”";
    case "git.branch.delete": return "Delete " + x.branches.length + " branches in " + x.repo + " (cannot be undone)";
    case "charger.start": return "Start " + x.device + " for pack " + x.pack + " (physical device)";
    default: return a.tool;
  }
}
/** Another base's seat by its name (Tabgha), not its ID, when the base is known. */
function baseName(id) { const b = BASES.find(x => x.id === String(id).toLowerCase()); return b ? b.name.charAt(0) + b.name.slice(1).toLowerCase() : id; }
function seatName(seat) { const n = L().seats; if (seat.startsWith("extra:")) return baseName(seat.slice(6)); return n[seat] || seat; }

/* ================= RENDER: sorties ================= */
function sortieBadge(s) {
  if (s.status === "waiting") return "<span class='badge b-warn'>NEEDS YOU</span>";
  if (s.status === "waiting-route") return "<span class='badge b-warn'>WAITING ROUTE</span>";
  if (s.status === "active") return "<span class='badge b-info blink'>" + (L().steps[s.phase] || s.phase).toUpperCase() + "</span>";
  if (s.status === "done") return "<span class='badge b-ok'>DONE</span>";
  if (s.status === "failed") return "<span class='badge b-danger'>FAILED</span>";
  return "<span class='badge b-muted'>STOOD DOWN</span>";
}
/** The search box keeps sorties whose ID, title, reply or why contains every word typed (case-insensitive). */
function matchesSearch(s, q) {
  if (!q) return true; const text = [s.id, s.title, s.outcome, s.why].filter(Boolean).join(" ").toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(w => text.includes(w));
}
const FILTER_NAMES = { active:"active", waiting:"waiting", done:"done", problem:"failed or stopped" };
function renderSorties() {
  const f = state.filter; const q = (state.search || "").trim();
  const list = state.sorties.filter(s => f === "all" || (f === "active" && s.status === "active") || (f === "waiting" && /waiting/.test(s.status)) || (f === "done" && s.status === "done") || (f === "problem" && (s.status === "failed" || s.status === "stood-down"))).filter(s => matchesSearch(s, q));
  const active = state.sorties.filter(s => s.status === "active" || /waiting/.test(s.status)).length;
  document.getElementById("sorties-sub").textContent = active + " in flight · " + (q ? list.length + " match" + (list.length === 1 ? "" : "es") : state.sorties.length + " shown");
  document.getElementById("sortie-list").innerHTML = list.map(s => {
    const meaning = { green:"ran without a card", orange:"asked the MAGI", blue:"needed you" };
    const pats = s.actions.map(a => a.ballot ? "<span class='badge b-" + a.ballot.pattern + "' title='Pattern " + a.ballot.pattern + ": " + (meaning[a.ballot.pattern] || "") + "' aria-label='Pattern " + a.ballot.pattern + "'>" + a.ballot.pattern[0].toUpperCase() + "</span>" : "<span class='badge b-muted' title='not voted yet' aria-label='not voted yet'>·</span>").join(" ");
    return "<div class='card sortie" + (s.id === state.selected ? " sel" : "") + "' tabindex='0' role='button' aria-pressed='" + (s.id === state.selected) + "' data-s='" + s.id + "'>" +
      "<div class='row'><span class='b'>" + esc(s.id) + " · " + highlight(s.title, state.search) + "</span>" + sortieBadge(s) + "</div>" +
      "<div class='row small muted'><span>" + (s.forwarded ? "→ " + esc(s.forwarded) : s.origin ? "from " + esc(s.origin) : s.source === "hyuga" ? "Hyuga" : "Aoba") + " · " + dayTime(s.started) + " · " + s.actions.length + " action" + (s.actions.length > 1 ? "s" : "") + " " + pats + "</span><span>$" + s.spent.toFixed(3) + "</span></div>" +
      (s.why ? "<div class='tiny whyline'>" + esc(s.why) + "</div>" : "") +
      (s.outcome ? "<div class='tiny muted'>" + esc(s.outcome) + "</div>" : "") + "</div>";
  }).join("") || "<div class='muted small'>" + sortiesEmpty(f, q) + "</div>";
  const more = document.getElementById("sorties-more");
  if (more) { more.hidden = !LIVE || !!q || !state.sorties.length || !!state.noOlder; more.disabled = !!state.loadingOlder; more.textContent = state.loadingOlder ? "Loading…" : "Load older sorties"; }
}
/** What the empty Sorties list says: why it is empty and what to do next. */
function sortiesEmpty(f, q) {
  if (!state.sorties.length) return "No sorties yet. Ask Misato below, or message Aoba on Telegram: each request becomes a sortie here.";
  if (q) return "No sortie matches “" + esc(q) + "”" + (LIVE ? " in all history" : "") + (f !== "all" ? " among the " + FILTER_NAMES[f] + " ones" : "") + ". Try another word, or press Esc in the box to clear it.";
  return "No " + FILTER_NAMES[f] + " sorties right now. <button class='btn sm' data-f='all'>Show all</button>";
}

/* ================= RENDER: flow ================= */
function stepState(s, id) {
  if (!s) return "";
  // F-051: forwarded to the main base: the steps between ran there.
  if (s.forwarded && id !== "detect" && id !== "debrief") return "skip";
  // B-020: while the consultant works the sortie is not yet marked consulted, but its step is the one running.
  if (id === "consult" && !s.consult && s.phase !== "consult") return "skip";
  if (s.phase === id) return s.status === "waiting" || s.status === "waiting-route" ? "wait" : s.status === "active" ? "on" : "done";
  if (id === "apt" && !s.actions.some(a => a.ballot && a.ballot.outcome !== "grant")) return s.done.apt ? "done" : (s.status === "done" ? "skip" : "");
  return s.done[id] ? "done" : "";
}
/* Replay: a sortie picked in the list redraws its flow step by step (one step every REPLAY_MS), then shows it as it is.
   Each frame is the sortie with only its first k passed steps done and the next one on. No replay with reduced motion. */
const REPLAY_MS = 450;
let replayTimer = null;
function replayOrder(s) { return STEP_IDS.filter(id => ["done", "on", "wait"].includes(stepState(s, id))); }
function replayFrame(s, k) {
  const order = replayOrder(s); const done = {}; order.slice(0, k).forEach(id => { done[id] = true; });
  return Object.assign({}, s, { done, phase:order[k], status:"active", note:"", ballot:k > order.indexOf("magi") ? s.ballot : null });
}
function startReplay(id) {
  clearInterval(replayTimer); state.replay = null;
  const s = state.sorties.find(x => x.id === id); if (!s) return;
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || replayOrder(s).length < 2) return;
  state.replay = { id, k:0 };
  replayTimer = setInterval(() => {
    const cur = state.sorties.find(x => x.id === id);
    if (!state.replay || state.replay.id !== id || !cur || ++state.replay.k >= replayOrder(cur).length) { clearInterval(replayTimer); state.replay = null; }
    renderFlow();
  }, REPLAY_MS);
}
function renderFlow() {
  const real = state.sorties.find(x => x.id === state.selected);
  const s = real && state.replay && state.replay.id === real.id && state.replay.k < replayOrder(real).length ? replayFrame(real, state.replay.k) : real;
  document.getElementById("flow-sub").textContent = s ? s.id + " · " + s.title : "no sortie selected";
  document.getElementById("flow-note").textContent = s ? (s.note || s.outcome || "") : "Select a sortie, or launch one.";
  // sephirot nodes
  // Misato's apartment passed means the owner decided: it takes the decision colour, like its lines (owner, 2026-11-05).
  { const sd = document.querySelector(".snode[data-n='detect'] .sd"); if (sd) sd.textContent = s && s.forwarded ? "forwarded to " + s.forwarded : s && s.origin ? "from " + s.origin : "Aoba comms · Hyuga watch"; }
  { const sd = document.getElementById("sd-consult"); if (sd) sd.textContent = !s ? "no vote · advice into the LCL" : s.advisor ? "advised by " + s.advisor : s.phase === "consult" && s.status === "active" ? "advising · no vote" : "no advice"; }
  document.querySelectorAll(".snode[data-n]").forEach(el => { el.classList.remove("on", "done", "wait", "skip", "owner"); const st = stepState(s, el.dataset.n); if (st) el.classList.add(st); if (st === "done" && el.dataset.n === "apt") el.classList.add("owner"); });
  // timeline
  const steps = L().steps; const b = s && s.ballot;
  document.getElementById("timeline").innerHTML = STEP_IDS.map((id, i) => {
    let inner = "<span class='n'>" + (i + 1) + "</span>" + esc(steps[id]);
    if (id === "magi") inner += "<div class='tmagi'>" + ["melchior", "balthasar", "casper"].map(seat => { const v = b ? (b.verdicts.find(x => x.seat === seat) || { vote:"none" }).vote : (s && s.phase === "magi" ? "pending" : "none"); return "<span class='tseat " + v + "' title='" + seat + "'>" + L().short[seat] + "</span>"; }).join("") + "</div>";
    if (id === "sync" && b) inner += "<div class='tiny'>" + b.sync.value + "%</div>";
    return (i ? "<span class='tarrow'>→</span>" : "") + "<div class='tstep " + stepState(s, id) + (id === "apt" && stepState(s, id) === "done" ? " owner" : "") + "'>" + inner + "</div>";
  }).join("");
  // magi big
  const a = s && s.actions[Math.min(s.current, s.actions.length - 1)];
  document.getElementById("mt-action").textContent = a ? a.tool : "no action";
  ["melchior", "balthasar", "casper"].forEach(seat => {
    const el = document.querySelector(".mseat[data-seat='" + seat + "']");
    let v = "none", label = "—", metric = seatMetric(seat, s, a);
    if (b) { const vv = b.verdicts.find(x => x.seat === seat); if (vv) { v = vv.vote; label = vv.vote === "approve" ? "承認 APPROVE" : vv.vote === "reject" ? "否決 REJECT" : "ABSTAIN"; } else { v = "none"; label = seat === "casper" ? "NOT NEEDED" : "—"; } }
    else if (s && s.phase === "magi") { v = "pending"; label = "審議中 VOTING"; }
    if (state.theme !== "eva") label = label.replace(/^[^\x00-\x7F]+ /, "");
    el.dataset.v = v; el.querySelector(".mv").textContent = label; el.querySelector("[data-m]").textContent = metric;
  });
  document.getElementById("magi-extras").innerHTML = b ? b.verdicts.filter(v => v.seat.startsWith("extra:")).map(v => "<span class='vchip " + v.vote + (v.shadow ? " shadow" : "") + "'>+ " + esc(baseName(v.seat.slice(6))) + (v.shadow ? " · shadow, not counted" : " · veto-only") + "</span>").join("") : "";
  document.getElementById("mres-out").textContent = b ? b.outcome.toUpperCase() : "—";
  document.getElementById("mres-out").className = b ? (b.outcome === "grant" ? "ok" : b.outcome === "reject" ? "danger" : "warn") : "";
  document.getElementById("mres-pattern").innerHTML = b ? "<span class='badge b-" + b.pattern + "'>PATTERN " + b.pattern.toUpperCase() + "</span>" : "—";
  document.getElementById("mres-reason").textContent = b ? b.reason : "—";
  document.getElementById("sd-sync").textContent = b ? b.sync.value + "% · " + (b.outcome === "grant" ? "field signed" : "to owner") : "≥ 80 % · not Blue";
  document.getElementById("sd-plan").textContent = s ? "action " + Math.min(s.current + 1, s.actions.length) + "/" + s.actions.length : "next action";
  document.getElementById("sd-route").textContent = s ? (s.status === "waiting-route" ? "no route · waits" : "S² local · $" + s.battery.toFixed(2) + " battery") : "route · battery";
  document.getElementById("sd-intake").textContent = s ? "provenance: " + s.trust : "intake · provenance";
  document.getElementById("sd-eva").textContent = b ? b.executor + " · field enforced" : "sandbox · field enforced";
  { const img = document.getElementById("av-eva-node"); const k = b ? b.executor.toLowerCase() : "eva-01"; if (img.dataset.av !== k) { img.dataset.av = k; fillAvatars(img.parentNode); } }
  drawEdges(s);
  renderDetail(s);
}
function seatMetric(seat, s, a) {
  // Owner, 2026-11-05: each seat's role; Casper says whether it was asked. The details are on hover (index.html).
  if (seat === "melchior") return "rules";
  if (seat === "balthasar") return "protection";
  if (!s || !a) return "intent · idle";
  const needs = a.ballot && a.ballot.pattern ? a.ballot.pattern !== "green" : !isLocal((TOOLS[a.tool] || {}).effect || "irreversible");
  return needs ? "intent · read by a local model" : "intent · not needed (Green)";
}
function renderMagiPending(s) { if (state.selected === s.id) renderFlow(); }
const EDGES = [
  ["detect","intake"],["detect","route"],["intake","route"],["route","plan"],["consult","plan","loop"],["plan","magi"],
  ["magi","sync"],["magi","apt"],["sync","apt"],["sync","plug"],["apt","plug"],["plug","eva"],["eva","debrief"],
  ["magi","plan","loop"],["apt","plan","loop"],["eva","plan","loop"],
  // Misato answered without an action: straight to Debrief (drawn only for such a sortie).
  ["plan","debrief","answer"],
  // F-051: forwarded to the main base: Detection straight to Debrief over the Kaji line (drawn only then).
  ["detect","debrief","relay"]
];
function nodeEl(id) { return id === "magi" ? document.getElementById("magi-big") : document.querySelector(".snode[data-n='" + id + "']"); }
function drawEdges(s) {
  if (!isEvaFull()) return;
  const svg = document.getElementById("edges"); const host = document.getElementById("sephirot").getBoundingClientRect();
  if (!host.width) return;
  const c = el => { const r = el.getBoundingClientRect(); return { x:r.left - host.left + r.width / 2, y:r.top - host.top + r.height / 2, w:r.width, h:r.height, l:r.left - host.left, r:r.right - host.left, t:r.top - host.top, b:r.bottom - host.top }; };
  const live = liveEdges(s);
  svg.setAttribute("viewBox", "0 0 " + host.width + " " + host.height);
  // Orthogonal routing: every line leaves and enters a node only at the middle of its N, S, E or W side, with 90° turns
  // in the gaps between nodes; the loops back to Misato run in their own lanes in the right padding, never behind a node.
  // One shared turning height per fan-out (edges leaving the same node downwards) and per merge (edges entering the
  // same node from above), so branches turn on one line.
  const edges = EDGES.filter(e => e[2] === "relay" ? !!(s && s.forwarded) : e[2] !== "answer" || (s && !s.actions.length && !s.forwarded));
  const box = {}; edges.forEach(e => { box[e[0]] = box[e[0]] || c(nodeEl(e[0])); box[e[1]] = box[e[1]] || c(nodeEl(e[1])); });
  const down = edges.filter(e => !e[2] && box[e[1]].t >= box[e[0]].b - 2);
  const fan = {}, merge = {};
  down.forEach(e => { fan[e[0]] = Math.min(fan[e[0]] ?? Infinity, box[e[1]].t); merge[e[1]] = Math.max(merge[e[1]] ?? -Infinity, box[e[0]].b); });
  const bar = e => { const outs = down.filter(x => x[0] === e[0]).length, ins = down.filter(x => x[1] === e[1]).length;
    return outs > 1 || ins < 2 ? (box[e[0]].b + fan[e[0]]) / 2 : (merge[e[1]] + box[e[1]].t) / 2; };
  let lane = 0;
  const paths = edges.map(e => {
    const A = c(nodeEl(e[0])), B = c(nodeEl(e[1])); let d;
    // The answer route runs in its own lane on the right, then under Debrief, entering it from below.
    // The relay runs in the left padding: out of Detection's side, down, into Debrief's side.
    if (e[2] === "relay") { const x = 6; d = "M" + A.l + "," + A.y + " H" + x + " V" + B.y + " H" + B.l; }
    else if (e[2] === "answer") { const x = host.width - 14 - 8 * lane++, yb = B.b + 6; d = "M" + A.r + "," + A.y + " H" + x + " V" + yb + " H" + B.x + " V" + B.b; }
    else if (e[2] === "loop" && e[0] !== "consult") { const x = host.width - 14 - 8 * lane++; d = "M" + A.r + "," + A.y + " H" + x + " V" + B.y + " H" + B.r; }
    else if (B.t >= A.b - 2) { const my = bar(e); d = "M" + A.x + "," + A.b + " V" + my + " H" + B.x + " V" + B.t; }
    else if (B.b <= A.t + 2) { const my = (B.b + A.t) / 2; d = "M" + A.x + "," + A.t + " V" + my + " H" + B.x + " V" + B.b; }
    else if (B.l >= A.r) { const mx = (A.r + B.l) / 2; d = "M" + A.r + "," + A.y + " H" + mx + " V" + B.y + " H" + B.l; }
    else { const mx = (B.r + A.l) / 2; d = "M" + A.l + "," + A.y + " H" + mx + " V" + B.y + " H" + B.r; }
    const key = e[0] + ">" + e[1]; const cls = (e[2] === "loop" ? "loop " : "") + (live[key] || passedEdge(s, e) || "");
    return "<path d='" + d + "' class='" + cls + "' marker-end='url(#edge-arrow)'/>";
  }).join("");
  svg.innerHTML = "<defs><marker id='edge-arrow' viewBox='0 0 6 6' refX='5' refY='3' markerWidth='8' markerHeight='8' markerUnits='userSpaceOnUse' orient='auto-start-reverse'><path d='M0,0 L6,3 L0,6 z' fill='context-stroke'/></marker></defs>" + paths;
}
/** The route already taken: green when the step passed on its own, yellow when it went through the owner's decision
    (Misato's apartment), faded into a skipped step. Live, waiting and rejected edges are drawn by liveEdges instead. */
function passedEdge(s, e) {
  if (!s || e[2] === "loop") return "";
  if (e[2] === "answer") return stepState(s, "plan") === "done" && stepState(s, "debrief") === "done" ? "passed" : "";
  if (e[2] === "relay") return stepState(s, "debrief") === "done" ? "passed" : "";
  const from = stepState(s, e[0]), to = stepState(s, e[1]);
  if (from === "skip" || to === "skip") return "skip";
  if (from !== "done" || !(to === "done" || to === "on" || to === "wait")) return "";
  return e[0] === "apt" || e[1] === "apt" ? "passed owner" : "passed";
}
function liveEdges(s) {
  const m = {}; if (!s || !(s.status === "active" || /waiting/.test(s.status))) return m;
  const prevOf = { intake:"detect", route:"intake", consult:"route", plan:s.consult && s.current === 0 ? "consult" : "route", magi:"plan", sync:"magi", apt:"sync", plug:s.done.apt && s.phase === "plug" ? "apt" : "sync", eva:"plug", debrief:s.actions.length ? "eva" : "plan" };
  if (s.phase === "plan" && s.current > 0) m["eva>plan"] = "live";
  else if (s.phase === "plan" && /Rejected|Edit/.test(s.note)) m[/Edit/.test(s.note) ? "apt>plan" : "magi>plan"] = "reject";
  else if (prevOf[s.phase]) m[prevOf[s.phase] + ">" + s.phase] = s.status === "waiting" ? "wait" : "live";
  if (s.phase === "consult") m["consult>plan"] = "live";
  return m;
}

/* ================= RENDER: detail (plan + action) ================= */
function renderDetail(s) {
  const box = document.getElementById("detail");
  if (!s) { box.innerHTML = "<div class='muted'>No sortie selected. Pick one in Sorties, or ask Misato below to start one.</div>"; document.getElementById("detail-sub").textContent = ""; return; }
  document.getElementById("detail-sub").textContent = "pilot " + s.pilot + " · " + pilotStage(s.pilot) + " stage · editable by you";
  const plan = "<div class='plan'><div class='small muted' style='margin-bottom:4px'>PLAN (Misato proposes one action at a time)</div><ol>" + s.actions.map((a, i) =>
    "<li><span class='ix'>" + (i + 1) + "</span><span><b>" + esc(a.tool) + "</b><br/><span class='tiny muted'>" + esc(JSON.stringify(a.args)) + "</span></span><span>" + actionBadge(a) + "</span></li>").join("") + "</ol>" +
    "<div class='row' style='margin-top:6px'><button class='btn sm danger' data-spear='" + s.id + "'>Spear this sortie</button><span class='tiny muted'>battery $" + s.spent.toFixed(3) + " / $" + s.battery.toFixed(2) + "</span></div></div>";
  const a = s.actions[Math.min(s.current, s.actions.length - 1)]; const b = a && a.ballot;
  const advice = s.advisor ? "<div class='tiny muted' style='margin-bottom:4px'>Advised by " + esc(s.advisor) + " before Misato planned (advice only, no vote)</div>" : "";
  const act = !b ? "<div class='muted small'>Ballot not run yet for the current action.</div>" :
    "<div><div class='small muted' style='margin-bottom:4px'>CURRENT ACTION · BALLOT</div>" +
    "<div class='kv'><span>tool</span><span>" + esc(a.tool) + "</span><span>effect</span><span>" + b.effect + "</span><span>pattern</span><span><span class='badge b-" + b.pattern + "'>" + b.pattern.toUpperCase() + "</span> <span class='tiny muted'>from the effect class, never chosen by you</span></span>" +
    "<span>executor</span><span>" + b.executor + "</span><span>outcome</span><span class='" + (b.outcome === "grant" ? "ok" : b.outcome === "reject" ? "danger" : "warn") + "'>" + b.outcome + " · " + esc(b.reason) + "</span></div>" +
    "<div class='small' style='margin-top:6px'>Sync Ratio <b>" + b.sync.value + "%</b> <span class='muted'>(threshold " + SCROLLS.syncThreshold + "%)</span></div>" +
    "<div class='meter " + (b.sync.value >= SCROLLS.syncThreshold ? "" : "warn") + "' style='margin-top:3px'><i style='width:" + b.sync.value + "%'></i><span class='mark' style='left:" + SCROLLS.syncThreshold + "%'></span></div>" +
    "<div class='tiny muted' style='margin-top:2px'>" + esc(syncFormula(b)) + "</div>" +
    "<div class='verdicts'>" + b.verdicts.map(v => "<span class='vchip " + v.vote + (v.shadow ? " shadow" : "") + "'>" + esc(seatName(v.seat)) + ": " + esc(v.reason) + "</span>").join("") + "</div></div>";
  box.innerHTML = advice + plan + act;
}
function actionBadge(a) {
  const m = { planned:"b-muted", proposed:"b-info", waiting:"b-warn", done:"b-ok", rejected:"b-danger", "stood-down":"b-muted", failed:"b-danger" };
  return "<span class='badge " + (m[a.status] || "b-muted") + "'>" + a.status.toUpperCase() + "</span>";
}

/* ================= RENDER: right column ================= */
function renderAway() {
  const a = awaySummary();
  document.getElementById("away-since").textContent = "since " + dayTime(a.since);
  const items = a.list.map(s => "<div class='row small'><span><span class='" + (s.status === "done" ? "ok" : s.status === "failed" ? "danger" : "warn") + "'>■</span> " + dayTime(s.ended) + " · " + esc(s.title) + "</span><a href='#' data-s='" + s.id + "' class='muted tiny'>open</a></div><div class='tiny muted' style='margin:0 0 4px 14px'>" + esc(s.outcome) + "</div>").join("");
  document.getElementById("away").innerHTML =
    "<div class='small' style='margin-bottom:6px'>While you were away I finished <b class='ok'>" + a.done + "</b> sorties, <b class='warn'>" + a.expired + "</b> approval expired without acting, <b class='danger'>" + a.failed + "</b> failed and is retrying, and Pen Pen delivered <b>" + a.delivered + "</b> reminders. Cost <b>$" + state.routeSpend.umbilical.toFixed(2) + "</b> on Umbilical, S² free.</div>" +
    items + "<button class='btn sm' id='btn-seen' style='margin-top:4px'>Mark as read</button>";
}
function renderNext() {
  const up = state.upcoming.filter(u => u.at > Date.now()).sort((a, b) => a.at - b.at);
  document.getElementById("next-list").innerHTML = up.map(u => "<div class='up " + u.kind + "'><div class='row small'><b>" + hhmm(u.at) + "</b><span class='badge " + (u.kind === "hyuga" ? "b-info" : "b-muted") + "'>" + (u.kind === "hyuga" ? "HYUGA TRIGGER" : "REMINDER") + "</span></div><div class='small'>" + esc(u.title) + "</div><div class='tiny muted'>in " + ago(Date.now() - (u.at - Date.now())) + "</div></div>").join("") || "<div class='muted small'>Nothing coming up. Ask Misato “remind me tomorrow at 9 to call Ada” below, or on Telegram.</div>";
}
function renderHealth() {
  const issues = healthIssues();
  const checks = [
    ["Scheduler (nervous)", "ok", "pid 4182 · reminders firing"],
    ["Brain process", "ok", "pid 4183 · alive"],
    ["S² local route", state.dummy ? "danger" : "ok", state.dummy ? "unreachable" : "gemma · 140 ms"],
    ["Umbilical cloud", state.dummy ? "danger" : "ok", state.dummy ? "unreachable" : "enabled · key private"],
    ["Central Dogma (SQLite)", "ok", "schema 2 · integrity ok"],
    ["Pen Pen delivery", "ok", "inbox 0 pending · Telegram not configured"]
  ];
  document.getElementById("health").innerHTML =
    checks.map(c => "<div class='row small'><span>" + c[0] + "</span><span class='" + c[1] + "'>" + (c[1] === "ok" ? "✓ " : "✗ ") + esc(c[2]) + "</span></div>").join("") +
    "<div class='small muted' style='margin:6px 0 2px'>STUCK · FAILED · RETRYING</div>" +
    (issues.length ? issues.map(i => "<div class='small " + i.sev + "'>▲ " + esc(i.text) + "</div>").join("") : "<div class='small ok'>Nothing stuck.</div>");
}
function renderBudget() {
  const fc = forecast(), pct = Math.min(100, state.spentToday / SCROLLS.dailyBudget * 100), fpct = Math.min(100, fc / SCROLLS.dailyBudget * 100);
  const active = state.sorties.filter(s => s.status === "active" || /waiting/.test(s.status));
  document.getElementById("budget").innerHTML =
    "<div class='row'><span class='b' style='font-size:16px'>$" + state.spentToday.toFixed(2) + "</span><span class='muted small'>of $" + SCROLLS.dailyBudget.toFixed(2) + " today · forecast <b class='" + (fc > SCROLLS.dailyBudget ? "danger" : fc > SCROLLS.dailyBudget * 0.8 ? "warn" : "ok") + "'>$" + fc.toFixed(2) + "</b></span></div>" +
    "<div class='meter " + (pct > 80 ? "danger" : pct > 50 ? "warn" : "") + "' style='margin-top:4px'><i style='width:" + pct + "%'></i><span class='mark' style='left:" + fpct + "%' title='forecast'></span></div>" +
    "<div class='kv' style='margin-top:6px'><span>Umbilical (cloud)</span><span>$" + state.routeSpend.umbilical.toFixed(3) + " · Casper seats</span><span>S² (local)</span><span>$0 · no per-token cost</span><span>when flat</span><span>Gendo falls back to S²; local-only never uses Umbilical</span></div>" +
    "<div class='small muted' style='margin:6px 0 2px'>BATTERY PER LIVE SORTIE</div>" +
    (active.map(s => "<div class='row tiny'><span>" + s.id + "</span><span>$" + s.spent.toFixed(3) + " / $" + s.battery.toFixed(2) + "</span></div><div class='meter'><i style='width:" + Math.min(100, s.spent / s.battery * 100) + "%'></i></div>").join("") || "<div class='tiny muted'>none</div>");
}
/* F-051: stage tabs with counts, one row per section (owner, 2026-11-05): pilots Proto | Test | Prod | Retired,
   skills Seed | Sprout | Ripe | Dropped (Simple: Create | Try | Use | Dropped). Each section remembers its tab. */
function stageTabs(section, tabs, counts) {
  const cur = state.tabs && state.tabs[section] || tabs[0][0];
  return "<div class='tabs' role='group' aria-label='" + section + " by stage'>" + tabs.map(([k, label]) => "<button class='btn sm" + (k === cur ? " sel" : "") + "' aria-pressed='" + (k === cur) + "' data-stagetab='" + section + ":" + k + "'>" + label + " " + (counts[k] || 0) + "</button>").join("") + "</div>";
}
function currentTab(section, first) { return state.tabs && state.tabs[section] || first; }
function renderSkills() {
  const eva = state.theme === "eva"; const tabs = eva ? [["seed","Seed"],["sprout","Sprout"],["ripe","Ripe"],["dropped","Dropped"]] : [["seed","Create"],["sprout","Try"],["ripe","Use"],["dropped","Dropped"]];
  document.getElementById("skills").innerHTML = stageTabs("skills", tabs, {}) + "<div class='muted small'>Planned · not connected yet. Skills are the procedures a pilot uses: each is versioned, approved by you and grows through its own stages (F-045).</div>";
}
function renderMelons() {
  const m = { prototype:"b-info", test:"b-orange", production:"b-ok" };
  const short = { prototype:"PROTO", test:"TEST", production:"PROD" };
  const PTABS = [["prototype","Proto"],["test","Test"],["production","Prod"],["retired","Retired"]];
  const counts = {}; PILOTS.forEach(p => { counts[p.stage] = (counts[p.stage] || 0) + 1; }); const tab = currentTab("pilots", "prototype");
  document.getElementById("melons").innerHTML = stageTabs("pilots", PTABS, counts) + (PILOTS.filter(p => p.stage === tab).map(p => "<div class='card'><div class='row'><span class='b'>" + p.id + "</span><span class='badge " + m[p.stage] + "'>" + short[p.stage] + "</span></div>" +
    "<div class='row tiny muted'><span>" + p.runs + " runs · " + p.rejects + " MAGI rejects · " + p.overrides + " your edits</span><span>" + (p.stage === "prototype" ? "EVA-00" : p.stage === "test" ? "EVA-01" : "EVA-02") + "</span></div>" +
    "<div class='row' style='margin-top:4px'>" + (p.stage !== "production" ? "<button class='btn sm' data-promote='" + p.id + "'>" + (p.stage === "test" ? "Ask to promote (needs you)" : "Promote to test") + "</button>" : "<span class='tiny muted'>production: demoted automatically on failure or Spear</span>") +
    (p.stage !== "prototype" ? "<button class='btn sm danger' data-demote='" + p.id + "'>Demote</button>" : "") + "</div></div>").join("") || "<div class='muted small'>No pilot at this stage.</div>");
}
function renderBases() {
  document.getElementById("bases-sub").textContent = BASES.filter(b => b.status === "online").length + "/" + BASES.length + " online";
  document.getElementById("bases").innerHTML = BASES.map(b => "<div class='card'><div class='row'><span class='b'>" + b.name + "</span><span class='badge " + (b.status === "online" ? "b-ok" : b.status === "standby" ? "b-warn" : "b-muted") + "'>" + b.status.toUpperCase() + "</span></div>" +
    "<div class='tiny muted'>" + b.role + " · " + b.lat.toFixed(2) + ", " + b.lon.toFixed(2) + "</div>" +
    "<div class='row tiny'><span>CPU <b>" + (b.status === "offline" ? "—" : b.cpu + "%") + "</b> · RAM <b>" + b.ram + "%</b>" + (b.gpu != null ? " · GPU <b>" + b.gpu + "%</b>" : "") + "</span><span class='muted'>" + (b.rtt == null ? "rtt —" : b.rtt === 0 ? "local" : "rtt " + b.rtt + " ms") + "</span></div>" +
    "<div class='tiny muted'>" + b.models + "</div>" +
    "<div style='margin-top:3px'><button class='btn sm' data-toggle='" + b.id + "'>" + (b.status === "online" ? "Simulate offline" : "Bring online") + "</button></div></div>").join("");
}
function renderCages() {
  const box = document.getElementById("cages");
  if (!box.children.length) box.innerHTML = CAGES.map(c => "<div class='cage" + (c.planned ? " planned" : "") + "'><div class='ch'><span style='color:var(--eva" + c.id.slice(4) + ")'>" + c.id + "</span><span class='tiny' id='cs-" + c.id + "'>IDLE</span></div><img class='eva-img' data-av='" + c.id.toLowerCase() + "' alt='" + c.id + "'/><canvas id='cv-" + c.id + "' height='30'></canvas><div class='cd' title='" + esc(c.label + " · @" + BASES.find(b => b.id === c.base).name) + "'>" + c.label + " · @" + BASES.find(b => b.id === c.base).name + "</div></div>").join("");
}
function renderLog() {
  const el = document.getElementById("log"); if (!el) return;
  const f = state.logFilter || "all";
  const rows = state.log.filter(e => f === "all" || (f === "sortie" && (e.s === state.selected || e.who === "you" || e.chat)) || (f === "chat" && (e.who === "you" || e.chat))).slice(-150);
  el.innerHTML = rows.map(e => "<div class='msg " + (e.who === "you" ? "you " : "") + e.cls + "'><img class='av' data-av='" + e.who + "' alt=''/><div><span class='ts'>" + new Date(e.t).toTimeString().slice(0, 8) + "</span><b class='who'>" + esc(speakerName(e.who)) + "</b>" + (e.s ? "<span class='muted'>" + e.s + " · </span>" : "") + esc(e.msg) + "</div></div>").join("") || "<div class='muted'>" + (f === "all" ? "No messages yet. Ask Misato something below: its steps, the MAGI's votes and its reply show here." : f === "sortie" ? "Nothing for this sortie yet. Pick another one in Sorties, or show all." : "No chat yet. Type below to talk to Misato.") + "</div>";
  fillAvatars(el); el.scrollTop = el.scrollHeight;
}
function applyLabels() { const p = L(); document.querySelectorAll("[data-l]").forEach(el => { const k = el.dataset.l; if (p[k]) el.textContent = p[k]; }); }
/* Lilith (memory): in the simulation, invented facts; live.js replaces this with the owner's real facts. */
const DEMO_FACTS = [
  { id:"f1", text:"Prefers reminders in the morning", source:"misato", shareable:false },
  { id:"f2", text:"Coffee at 8", source:"owner", shareable:true },
  { id:"f3", text:"Ada is a sister; birthday in May", source:"misato", shareable:false }
];
function renderLilith() {
  document.getElementById("lilith-sub").textContent = DEMO_FACTS.length + " facts · simulation";
  document.getElementById("lilith").innerHTML = DEMO_FACTS.map(f => "<div class='row small'><span>" + esc(f.text) + " <span class='tiny muted'>" + f.source + (f.shareable ? " · shareable" : " · local-only") + "</span></span></div>").join("") +
    "<div class='tiny muted' style='margin-top:4px'>Facts are stored only after the owner approves them; Instrumentality proposes new ones each night.</div>";
}
/* Models (F-038): in the simulation a fixed picture; live.js shows the real routes and lets the admin pick. */
function renderModels() {
  const box = document.getElementById("models"); if (!box) return;
  box.innerHTML = "<div class='small'>Misato · qwen2.5-coder:14b (local)</div><div class='small'>Casper · gemma4:12b (local)</div><div class='tiny muted' style='margin-top:4px'>Simulation: live, pick each role's model from what Ollama has.</div>";
}
function renderAll() { renderSkills(); fillAvatars(); renderQuestions(); renderNeeds(); renderSorties(); renderFlow(); renderAway(); renderNext(); renderHealth(); renderBudget(); renderMelons(); renderBases(); renderCages(); renderLilith(); renderModels(); }

/* ================= MAP: zoomed regional topography (procedural hills and valleys) ================= */
const map = { ready:false, w:540, h:250, proj:null, contours:[], base:null, linkPaths:{} };
const activeCage = {};
function sendPacket(from, to, kind) { state.packets.push({ from, to, kind, t0:performance.now(), dur:1400 }); }
function noise(x, y) { // smooth deterministic pseudo-terrain
  return Math.sin(x * 0.021 + 1.3) * Math.cos(y * 0.027) + 0.6 * Math.sin(x * 0.051 + y * 0.034) + 0.35 * Math.cos(x * 0.093 - y * 0.071 + 2) + 0.2 * Math.sin(x * 0.17 + y * 0.13);
}
/** Marching squares: one Path2D of isoline segments per threshold, in canvas units (no library, so the page needs no CDN). */
function isolines(vals, gw, gh, cell, thresholds) {
  return thresholds.map(th => {
    const p = new Path2D(); const t = (u, v) => (th - u) / (v - u); const seg = (P, Q) => { p.moveTo(P[0], P[1]); p.lineTo(Q[0], Q[1]); };
    for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) {
      const a = vals[j * gw + i], b = vals[j * gw + i + 1], c = vals[(j + 1) * gw + i + 1], d = vals[(j + 1) * gw + i];
      const k = (a > th ? 8 : 0) | (b > th ? 4 : 0) | (c > th ? 2 : 0) | (d > th ? 1 : 0); if (k === 0 || k === 15) continue;
      const x = i * cell, y = j * cell;
      const top = [x + cell * t(a, b), y], right = [x + cell, y + cell * t(b, c)], bottom = [x + cell * t(d, c), y + cell], left = [x, y + cell * t(a, d)];
      switch (k) {
        case 1: case 14: seg(left, bottom); break; case 2: case 13: seg(bottom, right); break; case 3: case 12: seg(left, right); break;
        case 4: case 11: seg(top, right); break; case 6: case 9: seg(top, bottom); break; case 7: case 8: seg(left, top); break;
        case 5: seg(top, right); seg(left, bottom); break; case 10: seg(left, top); seg(bottom, right); break;
      }
    }
    return { v:th, p };
  });
}
async function initMap() {
  const cv = document.getElementById("topo"); const W = map.w, H = map.h; const dpr = window.devicePixelRatio || 1; cv.width = W * dpr; cv.height = H * dpr; map.dpr = dpr;
  // Local projection: a window around the bases, shaped to the canvas, east-west scaled by cos(latitude).
  const lats = BASES.map(b => b.lat), lons = BASES.map(b => b.lon);
  const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2, lon0 = (Math.min(...lons) + Math.max(...lons)) / 2, k = Math.cos(lat0 * Math.PI / 180);
  const latSpan = Math.max(0.12, (Math.max(...lats) - Math.min(...lats)) * 1.7), lonSpan = Math.max(latSpan * W / H / k, (Math.max(...lons) - Math.min(...lons)) * 1.6);
  map.proj = p => [W / 2 + (p[0] - lon0) / lonSpan * W, H / 2 - (p[1] - lat0) / latSpan * H];
  // Terrain: rolling noise, a ridge of hills between the bases and a winding valley floor they share.
  const peaks = [[0.18, 0.22, 0.13], [0.42, 0.18, 0.11], [0.63, 0.30, 0.12], [0.86, 0.20, 0.10], [0.30, 0.78, 0.10], [0.74, 0.82, 0.12], [0.95, 0.62, 0.09]];
  const height = (x, y) => {
    const u = x / W, v = y / H; let h = 0.28 * (noise(x * 1.6, y * 1.6) + 2.2) / 4.4;
    for (const [px, py, r] of peaks) h += 0.55 * Math.exp(-((u - px) ** 2 + ((v - py) * H / W) ** 2) / (2 * r * r));
    const valley = 0.52 + 0.12 * Math.sin(u * 7.5 + 0.8); h -= 0.32 * Math.exp(-((v - valley) ** 2) / 0.012);
    return h;
  };
  const cell = 3, gw = Math.ceil(W / cell) + 1, gh = Math.ceil(H / cell) + 1; const vals = new Float64Array(gw * gh);
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { const h = height(i * cell, j * cell); vals[j * gw + i] = h; lo = Math.min(lo, h); hi = Math.max(hi, h); }
  for (let q = 0; q < vals.length; q++) vals[q] = (vals[q] - lo) / (hi - lo);
  const thresholds = []; for (let th = 0.06; th < 1; th += 0.055) thresholds.push(th);
  map.contours = isolines(vals, gw, gh, cell, thresholds);
  // Kaji line: straight links between every pair of bases; the bases form a triangle, so no link runs through another base.
  LINKS.forEach(([a, b]) => {
    const A = BASES.find(x => x.id === a), B = BASES.find(x => x.id === b); const pts = [];
    const [ax, ay] = map.proj([A.lon, A.lat]), [bx, by] = map.proj([B.lon, B.lat]);
    for (let t = 0; t <= 64; t++) pts.push([ax + (bx - ax) * t / 64, ay + (by - ay) * t / 64]);
    map.linkPaths[a + "|" + b] = pts;
  });
  map.ready = true;
}
/** The running version beside the clock (owner, 2026-11-06): the commit on hover, copied on click. Hidden without a live base. */
function showBuild(b, el = document.getElementById("build")) {
  if (!el) return;
  if (!b || !b.version) { el.hidden = true; return; }
  el.hidden = false; el.textContent = "v" + b.version; el.dataset.commit = b.commit || "";
  const about = b.commit ? "Commit " + b.commit + " · click to copy" : "Not a git checkout: no commit to copy";
  el.title = about; el.setAttribute("aria-label", "Version " + b.version + ". " + about);
}
async function copyBuild(el, clip = navigator.clipboard) {
  const c = el.dataset.commit; if (!c) return "none";
  const label = el.textContent;
  try { await clip.writeText(c); el.textContent = "copied"; } catch (e) { el.textContent = "copy failed"; }
  setTimeout(() => { el.textContent = label; }, 1200);
  return el.textContent;
}
document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("#build"); if (b) void copyBuild(b); });
function cssVar(n) { return getComputedStyle(document.body).getPropertyValue(n).trim(); }
function statusColor(st) { return st === "online" ? cssVar("--ok") : st === "standby" ? cssVar("--warn") : "#666"; }
function drawMap(now) {
  if (!map.ready) return;
  const cv = document.getElementById("topo"); const ctx = cv.getContext("2d"); const W = map.w, H = map.h; ctx.setTransform(map.dpr, 0, 0, map.dpr, 0, 0);
  ctx.fillStyle = cssVar("--sea"); ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = cssVar("--land"); ctx.fillRect(0, 0, W, H);
  ctx.lineWidth = 0.7; ctx.strokeStyle = cssVar("--topo");
  // every fourth contour is an index line, drawn heavier, as on a printed topographic sheet
  map.contours.forEach((c, i) => { const index = i % 4 === 3; ctx.lineWidth = index ? 1.3 : 0.7; ctx.globalAlpha = index ? 1 : 0.75; ctx.stroke(c.p); }); ctx.globalAlpha = 1; ctx.lineWidth = 0.7;
  // pulse waves through the contour lines, coloured by base state; offline bases stay static
  BASES.forEach((b, i) => {
    if (b.status === "offline") return;
    const [x, y] = map.proj([b.lon, b.lat]); const col = statusColor(b.status);
    const period = b.status === "online" ? 2600 : 4200; const ph = ((now + i * 700) % period) / period; const r = 6 + ph * 70;
    const g = ctx.createRadialGradient(x, y, Math.max(0, r - 7), x, y, r + 7);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(0.5, col); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.strokeStyle = g; ctx.lineWidth = 1.6; ctx.globalAlpha = 1 - ph;
    map.contours.forEach(c => ctx.stroke(c.p));
    const glow = ctx.createRadialGradient(x, y, 0, x, y, 26); glow.addColorStop(0, col); glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = 0.35; ctx.strokeStyle = glow; ctx.lineWidth = 1; map.contours.forEach(c => ctx.stroke(c.p));
    ctx.globalAlpha = 1;
  });
  // Kaji line: dashed great circles; moving dash when both ends are up
  LINKS.forEach(([a, b]) => {
    const A = BASES.find(x => x.id === a), B = BASES.find(x => x.id === b); const up = A.status !== "offline" && B.status !== "offline" && (A.status === "online" || B.status === "online");
    const pts = map.linkPaths[a + "|" + b];
    ctx.setLineDash([4, 4]); ctx.lineDashOffset = up ? -(now / 60) % 8 : 0; ctx.strokeStyle = up ? cssVar("--accent") : "#555"; ctx.globalAlpha = up ? 0.85 : 0.4; ctx.lineWidth = 1.1;
    ctx.beginPath(); pts.forEach((p, k) => { if (k && Math.abs(p[0] - pts[k - 1][0]) > W / 2) ctx.moveTo(p[0], p[1]); else if (k) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  });
  // messages travelling the Kaji line
  state.packets = state.packets.filter(pk => now - pk.t0 < pk.dur + 900);
  state.packets.forEach(pk => {
    const key = LINKS.some(l => l[0] === pk.from && l[1] === pk.to) ? pk.from + "|" + pk.to : pk.to + "|" + pk.from;
    const pts = map.linkPaths[key]; if (!pts) return; const fwd = key.startsWith(pk.from);
    const t = Math.max(0, Math.min(1, (now - pk.t0) / pk.dur)); const idx = Math.round((fwd ? t : 1 - t) * (pts.length - 1)); const [x, y] = pts[idx];
    ctx.fillStyle = pk.kind === "plug" ? cssVar("--accent") : pk.kind === "sync" ? cssVar("--info") : cssVar("--ok"); ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    if (t >= 1) { const k = Math.max(0, Math.min(1, (now - pk.t0 - pk.dur) / 900)); ctx.strokeStyle = ctx.fillStyle; ctx.globalAlpha = 1 - k; ctx.beginPath(); ctx.arc(x, y, 4 + k * 18, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
  });
  // base markers: square dots
  // The canvas is drawn at a fixed size and shown smaller: text and markers are scaled up by that ratio, so they read at
  // about 12 px whatever the panel's width (owner, 2026-11-05). This base (the one showing the page) is bigger, ringed and bold.
  const z = Math.max(1, W / ((cv.clientWidth || W))); const face = cssVar("--font") || "monospace"; const anySelf = BASES.some(x => x.self);
  BASES.forEach(b => {
    const [x, y] = map.proj([b.lon, b.lat]); const col = statusColor(b.status); // This base (owner, 2026-11-05), not the main one. B-022: this comment once sat before `const s`, so no base was drawn.
    const main = !!b.self || (!anySelf && b === BASES[0]); const s = (main ? 11 : 7) * z;
    ctx.fillStyle = col; ctx.fillRect(x - s / 2, y - s / 2, s, s); ctx.strokeStyle = "#000"; ctx.lineWidth = z; ctx.strokeRect(x - s / 2, y - s / 2, s, s);
    if (main) { ctx.strokeStyle = col; ctx.lineWidth = 1.5 * z; ctx.beginPath(); ctx.arc(x, y, s * 1.1, 0, Math.PI * 2); ctx.stroke(); }
    ctx.font = (main ? "bold " : "") + Math.round((main ? 13 : 12) * z) + "px " + face;
    ctx.fillStyle = cssVar("--text"); const label = b.name; const tw = ctx.measureText(label).width;
    const lx = x + tw + 12 * z > W ? x - tw - 8 * z : x + 8 * z; ctx.fillText(label, lx, y - 6 * z);
  });
  ctx.fillStyle = cssVar("--muted"); ctx.font = Math.round(10 * z) + "px " + face;
  ctx.fillText("UMBILICAL ↗ cloud · off (all models local)", 8, H - 8 * z);
}

/* ================= EVA heartbeats ================= */
function drawHeartbeats(now) {
  CAGES.forEach((c, i) => {
    const cv = document.getElementById("cv-" + c.id); if (!cv) return;
    const base = BASES.find(b => b.id === c.base); const off = base.status === "offline" || !!c.planned; const busy = (activeCage[c.id] || 0) > Date.now();
    const st = document.getElementById("cs-" + c.id); st.textContent = c.planned ? "PLANNED" : off ? "OFFLINE" : busy ? "ACTIVE" : base.status === "standby" ? "STANDBY" : "IDLE"; st.className = "tiny " + (off ? "muted" : busy ? "ok" : base.status === "standby" ? "warn" : "muted");
    const dpr = window.devicePixelRatio || 1; const w = cv.clientWidth || 120, h = 30;
    if (cv.width !== Math.floor(w * dpr)) { cv.width = Math.floor(w * dpr); cv.height = Math.floor(h * dpr); }
    const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(255,102,0,.12)"; ctx.lineWidth = 1; for (let gx = 0; gx < w; gx += 10) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke(); }
    ctx.strokeStyle = off ? "#555" : busy ? cssVar("--ok") : base.status === "standby" ? cssVar("--warn") : c.color; ctx.lineWidth = 1.3; ctx.beginPath();
    const period = busy ? 34 : base.status === "standby" ? 110 : 70; const shift = off ? 0 : (now / (busy ? 9 : 16)) % period;
    for (let x = 0; x <= w; x++) {
      let y = h / 2;
      if (!off) { const p = ((x + shift + i * 13) % period) / period; const amp = busy ? 12 : 8;
        if (p > 0.40 && p < 0.44) y -= amp * 0.3; else if (p >= 0.46 && p < 0.49) y += amp * 0.35; else if (p >= 0.49 && p < 0.52) y -= amp; else if (p >= 0.52 && p < 0.55) y += amp * 0.6; else if (p > 0.62 && p < 0.7) y -= amp * 0.22 * Math.sin((p - 0.62) / 0.08 * Math.PI); }
      x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  });
}

/* ================= LOOP + EVENTS ================= */
let lastFrame = 0;
function frame(now) {
  if (now - lastFrame > 33) { drawMap(now); drawHeartbeats(now); lastFrame = now; }
  requestAnimationFrame(frame);
}
setInterval(() => {
  const d = new Date(); document.getElementById("clock").textContent = d.toTimeString().slice(0, 8);
  document.getElementById("clock-date").textContent = d.toISOString().slice(0, 10) + " · " + Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!LIVE) state.approvals.filter(a => a.expires <= Date.now()).forEach(a => decide(a.id, "expired"));
  renderNeeds(); renderQuestions();
}, 1000);
// Mesh traffic: every pair of bases talks (heartbeats, memory sync), not only through Tokyo-3.
setInterval(() => {
  const up = LINKS.filter(([a, b]) => [a, b].every(id => BASES.find(x => x.id === id).status !== "offline"));
  if (!up.length) return; const [a, b] = up[Math.floor(Math.random() * up.length)];
  if (Math.random() < 0.5) sendPacket(a, b, "sync"); else sendPacket(b, a, "sync");
}, 2200);
setInterval(() => { if (LIVE) return; BASES.forEach(b => { if (b.status === "online") { b.cpu = Math.max(3, Math.min(95, b.cpu + Math.round((Math.random() - 0.5) * 4))); if (b.gpu != null) b.gpu = Math.max(3, Math.min(98, b.gpu + Math.round((Math.random() - 0.5) * 5))); } }); renderBases(); if (Math.random() < 0.5) sendPacket("tokyo3", Math.random() < 0.5 ? "nerv01" : "nerv02", "heartbeat"); }, 5000);

document.addEventListener("click", e => {
  const t = e.target.closest("button,[data-s],a"); if (!t) return;
  if (t.dataset.ap) { decide(t.dataset.ap, t.dataset.d); return; }
  if (t.dataset.s) {
    e.preventDefault();
    // A second click on the selected sortie's card deselects it (links elsewhere, such as Debrief's "open", always select).
    if (t.classList.contains("sortie") && state.selected === t.dataset.s) { state.selected = null; state.deselected = true; clearInterval(replayTimer); state.replay = null; renderSorties(); renderFlow(); renderLog(); return; }
    state.selected = t.dataset.s; state.deselected = false; state.autoSelected = false; startReplay(t.dataset.s); renderSorties(); renderFlow(); renderLog(); document.getElementById("p-flow").scrollIntoView({ behavior:"smooth", block:"nearest" }); return;
  }
  if (t.dataset.lf) { state.logFilter = t.dataset.lf; t.parentNode.querySelectorAll(".btn").forEach(b => b.classList.toggle("on", b === t)); renderLog(); return; }
  if (t.dataset.f) { state.filter = t.dataset.f; document.querySelectorAll("#p-sorties .filters .btn").forEach(b => { b.classList.toggle("on", b.dataset.f === state.filter); b.setAttribute("aria-pressed", String(b.dataset.f === state.filter)); }); renderSorties(); return; }
  if (t.id === "sorties-more" && LIVE) { window.liveOlder(); return; }
  if (t.dataset.go) { document.getElementById(t.dataset.go).scrollIntoView({ behavior:"smooth", block:"start" }); return; }
  if (t.dataset.spear && LIVE) { window.liveSpear(t.dataset.spear); return; }
  if (t.dataset.spear) { const s = state.sorties.find(x => x.id === t.dataset.spear); state.approvals.filter(a => a.sortie === s.id).forEach(a => decide(a.id, "reject")); if (s.status === "active") { s.status = "stood-down"; s.outcome = "Spear"; finish(s); } log("Spear " + s.id + ": grants revoked · happened: " + (s.happened.map(h => h.tool).join(", ") || "none"), "danger", s); renderAll(); return; }
  if (t.dataset.stagetab) { const [sec, k] = t.dataset.stagetab.split(":"); state.tabs = Object.assign({}, state.tabs, { [sec]:k }); renderMelons(); renderSkills(); return; }
  if (t.dataset.promote) { const p = PILOTS.find(x => x.id === t.dataset.promote); if (p.stage === "prototype") { p.stage = "test"; log("Watermelons: " + p.id + " → test", "ok"); } else { log("Promotion of " + p.id + " to production needs you (card in Misato's apartment)", "warn"); p.stage = "production"; } renderAll(); return; }
  if (t.dataset.demote) { const p = PILOTS.find(x => x.id === t.dataset.demote); p.stage = p.stage === "production" ? "test" : "prototype"; log("Watermelons: " + p.id + " demoted → " + p.stage, "danger"); renderAll(); return; }
  if (t.dataset.toggle) { const b = BASES.find(x => x.id === t.dataset.toggle); b.status = b.status === "online" ? "offline" : "online"; if (b.status === "online") b.rtt = b.id === "tokyo3" ? 0 : 120; log(b.name + " → " + b.status, b.status === "online" ? "ok" : "warn"); renderAll(); return; }
  if (t.id === "btn-seen") { state.lastVisit = Date.now(); if (LIVE) window.liveSeen(); renderAll(); return; }
  if (t.id === "btn-reload" && LIVE) { window.liveReload(); return; }
  if (t.id === "btn-doctor") { log("Doctor: scheduler ok · brain ok · routes " + (state.dummy ? "unreachable" : "ok") + " · SQLite integrity ok", state.dummy ? "warn" : "ok"); renderHealth(); return; }
});
document.addEventListener("keydown", e => { const t = e.target.closest && e.target.closest("[data-s]"); if (t && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); t.click(); } });
/* Keyboard: / searches sorties; a and r approve or reject a card, always in two presses (the first arms the card and says
   what the second will do), so a stray key never decides anything. The card is the one holding the focus, else the first. */
var armed = null, armTimer = null; // var: renderNeeds may run before this line
function keyNote(text) { const el = document.getElementById("key-note"); if (el) el.textContent = text; }
function disarm(note) { armed = null; clearTimeout(armTimer); keyNote(note || ""); renderNeeds(); }
document.addEventListener("keydown", e => {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  const el = e.target; const tag = (el.tagName || "").toLowerCase();
  if (el.id === "sortie-q" && e.key === "Escape") { el.value = ""; state.search = ""; if (LIVE) window.liveSearch(""); renderSorties(); el.blur(); return; }
  if (tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable) return;
  if (e.key === "/") { const q = document.getElementById("sortie-q"); if (q) { e.preventDefault(); q.focus(); q.select(); } return; }
  if (e.key === "Escape" && armed) { disarm("Cancelled."); return; }
  if (e.key !== "a" && e.key !== "r") return;
  const d = e.key === "a" ? "approve" : "reject"; const inCard = el.closest && el.closest("[data-card]");
  const ap = state.approvals.find(x => x.id === (inCard ? inCard.dataset.card : armed && armed.id)) || state.approvals[0];
  if (!ap) { keyNote("Nothing waits for you."); return; }
  e.preventDefault();
  if (armed && armed.id === ap.id && armed.d === d) { disarm((d === "approve" ? "Approving once: " : "Rejecting: ") + humanAction(ap.action) + "."); decide(ap.id, d); return; }
  armed = { id:ap.id, d }; clearTimeout(armTimer); armTimer = setTimeout(() => disarm(), 5000); renderNeeds();
  keyNote("Press " + e.key + " again within 5 s to " + (d === "approve" ? "approve once" : "reject") + ": " + humanAction(ap.action) + ". Esc cancels.");
});
document.addEventListener("input", e => {
  if (e.target.id !== "sortie-q") return; state.search = e.target.value; renderSorties(); if (LIVE) window.liveSearch(e.target.value.trim());
});
function say(text) { log(text, "ok", null, "misato"); state.log[state.log.length - 1].chat = true; renderLog(); }
function cardFor(text) { const id = (text.match(/AP-[\w-]+/i) || [])[0]; const sid = (text.match(/S-\d+/i) || [])[0];
  if (id) return state.approvals.find(a => a.id.toLowerCase() === id.toLowerCase());
  if (sid) return state.approvals.find(a => a.sortie.toLowerCase() === sid.toLowerCase());
  return state.approvals.length === 1 ? state.approvals[0] : null; }
function chat(text) {
  log(text, "", null, "you"); state.log[state.log.length - 1].chat = true;
  const t = text.toLowerCase().trim();
  setTimeout(() => {
    if (/^(help|\?)$/.test(t)) return say("I understand: status · why [AP-… or S-…] · approve / reject [AP-…] · spear · or any request, which becomes a sortie.");
    if (/^status/.test(t)) { const act = state.sorties.filter(s => s.status === "active").length; return say(state.approvals.length + " card(s) wait for you, " + act + " sortie(s) in flight, $" + state.spentToday.toFixed(2) + " of $" + SCROLLS.dailyBudget.toFixed(2) + " spent today, forecast $" + forecast().toFixed(2) + "."); }
    if (/^why/.test(t)) { const ap = cardFor(text) || state.approvals[0]; if (!ap) return say("Nothing is waiting for you."); return say(ap.id + " (" + ap.action.tool + "): " + ap.reason + " Sync " + ap.ballot.sync.value + "% = " + syncFormula(ap.ballot) + ". Pattern " + ap.ballot.pattern.toUpperCase() + " comes from the effect class " + ap.ballot.effect + "."); }
    if (/^(approve|reject)/.test(t)) { const ap = cardFor(text); if (!ap) return say(state.approvals.length ? "Which one? " + state.approvals.map(a => a.id + " " + a.action.tool).join(" · ") : "Nothing is waiting for you."); const d = t.startsWith("approve") ? "approve" : "reject"; decide(ap.id, d); return say((d === "approve" ? "Approved once: " : "Rejected: ") + humanAction(ap.action) + "."); }
    if (/^spear/.test(t)) { spearAll(); return say("Spear thrown: every grant revoked, approvals stood down. Check the trace for effects that already happened."); }
    const key = guessPreset(text); if (!key) return say("I can't plan that in this demo. Try: summarise mail · reply to Luca · delete merged branches · charge the FPV battery · save this page.");
    launch(key, text); say("On it: opened " + state.sorties[0].id + ". The MAGI decide each action's Pattern; anything that needs you comes to the apartment.");
  }, 250);
}
document.getElementById("chat-form").addEventListener("submit", e => { e.preventDefault(); const i = document.getElementById("chat-in"); const v = i.value.trim(); if (v) { chat(v); i.value = ""; } });
function guessPreset(t) { t = t.toLowerCase(); if (/mail|inbox|summar/.test(t)) return "brief"; if (/reply|tell|write to|email/.test(t)) return "reply"; if (/branch|repo/.test(t)) return "branches"; if (/charg|battery|fpv/.test(t)) return "charger"; if (/note|clip|page|web/.test(t)) return "note"; return null; }
/* palette:start · F-047: Theme (eva | simple) × Mode (dark | light) × Accent. Every colour a text sits on reaches WCAG AA
   (test/dashboard.test.ts checks all 20); Eva · Dark · Orange is the original EVA Full, also the stylesheet's :root. */
const ACCENTS = {
  orange:{ base:"#ff6600", tint:"#ffaa66", soft:"#a67c52", deep:"#b34700" },
  blue:{ base:"#2a7fff", tint:"#9cc4ff", soft:"#7d97bd", deep:"#1d5fd1" },
  green:{ base:"#22c55e", tint:"#8ef0b0", soft:"#74a888", deep:"#166534" },
  violet:{ base:"#a855f7", tint:"#d5b0ff", soft:"#9d88bf", deep:"#7e3fc4" },
  ochre:{ base:"#d4a017", tint:"#f0cf7a", soft:"#a8925f", deep:"#7a5d00" }
};
function palette(theme, mode, accent) {
  const a = ACCENTS[accent] || ACCENTS.orange, eva = theme !== "simple", dark = mode !== "light";
  const rgba = (hex, al) => "rgba(" + [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(",") + "," + String(al).replace(/^0\./, ".") + ")";
  const mix = (hex, to, t) => "#" + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - t) + parseInt(to.slice(i, i + 2), 16) * t).toString(16).padStart(2, "0")).join("");
  const status = dark ? { ok:"#22c55e", warn:eva ? "#ffcc00" : "#f59e0b", danger:eva ? "#ff0033" : "#ef4444", info:eva ? "#00aaff" : "#38bdf8", green:"#22c55e", orange:eva ? "#ff8800" : "#f59e0b", blue:eva ? "#2a7fff" : "#3b82f6" }
    : { ok:"#166534", warn:"#a15c07", danger:"#b91c1c", info:"#0369a1", green:"#166534", orange:"#9a4708", blue:"#1d4ed8" };
  // The four EVA cages keep their own colours (prototype, test, production, quarantine), deeper on light panels.
  const base = dark ? { "on-danger":"#000", kanji:eva ? "#ff0033" : "#ef4444", eva00:"#2a7fff", eva01:"#9b5cff", eva02:"#ff3b30", eva03:"#8a8a8a" } : { "on-danger":"#fff", kanji:"#b91c1c", eva00:"#1d5fd1", eva01:"#7e3fc4", eva02:"#c0261c", eva03:"#5f5f5f" };
  if (eva && dark) return Object.assign({ bg:"#050508", panel:"#0d0d12", panel2:"#09090d", border:rgba(a.base, .4), text:a.tint, muted:a.soft, accent:a.base, "hdr-bg":a.base, "hdr-fg":"#000", "brand-bg":a.base, "brand-fg":"#000", title:a.tint, topo:rgba(a.base, .42), land:"#0c0a0a", sea:"#050508", glow:rgba(a.base, .35) }, status, base);
  if (eva) return Object.assign({ bg:"#f3f1ec", panel:"#ffffff", panel2:"#f8f7f3", border:rgba(a.deep, .45), text:mix(a.deep, "#000000", .5), muted:a.deep, accent:a.deep, "hdr-bg":a.base, "hdr-fg":"#000", "brand-bg":a.base, "brand-fg":"#000", title:mix(a.deep, "#000000", .5), topo:rgba(a.deep, .35), land:"#e8e5de", sea:"#f3f1ec", glow:rgba(a.deep, .25) }, status, base);
  if (dark) return Object.assign({ bg:"#0b0c10", panel:"#12141a", panel2:"#0e1015", border:"#2a2e3a", text:"#e6e8ee", muted:"#8b93a7", accent:a.base, "hdr-bg":"transparent", "hdr-fg":"#8b93a7", "brand-bg":a.base, "brand-fg":"#000", title:"#e6e8ee", topo:"#2f3646", land:"#151922", sea:"#0b0c10", glow:rgba(a.base, .3) }, status, base);
  return Object.assign({ bg:"#f4f5f7", panel:"#ffffff", panel2:"#f7f8fa", border:"#d8dde8", text:"#1a1d26", muted:"#5c657a", accent:a.deep, "hdr-bg":"transparent", "hdr-fg":"#5c657a", "brand-bg":a.deep, "brand-fg":"#fff", title:"#1a1d26", topo:"#c3cad8", land:"#e9ecf2", sea:"#f4f5f7", glow:rgba(a.deep, .25) }, status, base);
}
/* A theme chosen before F-047 (one name) maps to its nearest Theme · Mode · Accent. */
function migrateTheme(name) { return { "eva-full":["eva", "dark", "orange"], "eva-basic":["eva", "dark", "orange"], dark:["simple", "dark", "blue"], light:["simple", "light", "blue"], terminal:["simple", "dark", "green"] }[name]; }
/* palette:end */
/* The chosen theme and CRT effect are remembered in this browser only (a per-viewer preference); without storage the
   page simply starts on the default. */
const PREFS = "nerv.dashboard.prefs";
function readPrefs() { try { const p = JSON.parse(localStorage.getItem(PREFS) || "{}"); return p && typeof p === "object" ? p : {}; } catch { return {}; } }
function savePrefs() { try { localStorage.setItem(PREFS, JSON.stringify({ theme:state.theme, mode:state.mode, accent:state.accent, crt:!!state.crt })); } catch { /* storage blocked: not remembered */ } }
function setCrt(on) { state.crt = on; document.body.classList.toggle("crt-on", on && state.theme === "eva"); const b = document.getElementById("btn-crt"); if (b) b.setAttribute("aria-pressed", String(on)); }
for (const id of ["theme", "mode", "accent"]) document.getElementById(id).addEventListener("change", () => { setTheme(document.getElementById("theme").value, document.getElementById("mode").value, document.getElementById("accent").value); savePrefs(); });
document.getElementById("btn-crt").addEventListener("click", () => { setCrt(!state.crt); savePrefs(); });
document.getElementById("btn-spear").addEventListener("click", spearAll);
document.getElementById("btn-dummy").addEventListener("click", () => { state.dummy = true; document.getElementById("dummy-banner").classList.remove("hidden"); log("Dummy Plug: S² and Umbilical unreachable", "danger"); renderAll(); });
document.getElementById("btn-undummy").addEventListener("click", () => { state.dummy = false; document.getElementById("dummy-banner").classList.add("hidden"); log("Routes restored · waiting sorties resume", "ok"); state.sorties.filter(s => s.status === "waiting-route").forEach(s => { s.status = "active"; runSortie(s); }); renderAll(); });
document.getElementById("btn-reset").addEventListener("click", () => { const th = [state.theme, state.mode, state.accent]; seed(); setTheme(...th); });
window.addEventListener("resize", () => drawEdges(state.sorties.find(x => x.id === state.selected)));
function setTheme(theme, mode, accent) {
  state.theme = theme === "simple" ? "simple" : "eva"; state.mode = mode === "light" ? "light" : "dark"; state.accent = ACCENTS[accent] ? accent : "orange";
  document.body.className = "theme-" + state.theme + " mode-" + state.mode + " accent-" + state.accent + (state.crt && state.theme === "eva" ? " crt-on" : "");
  for (const [k, v] of Object.entries(palette(state.theme, state.mode, state.accent))) document.body.style.setProperty("--" + k, v);
  for (const id of ["theme", "mode", "accent"]) document.getElementById(id).value = state[id];
  applyLabels(); renderAll(); renderLog(); requestAnimationFrame(() => drawEdges(state.sorties.find(x => x.id === state.selected)));
}

// Live: only this machine is a base; simulated cages and pilots would point at bases that do not exist.
if (LIVE) { state = freshState(); state.upcoming = []; BASES.splice(1); LINKS.length = 0; CAGES.forEach(c => { c.base = "tokyo3"; c.planned = c.id !== "EVA-02"; if (c.id === "EVA-02") c.label = "PRODUCTION · in-process executor, not sandboxed yet"; else c.label = c.label.split(" · ")[0] + " · planned"; }); PILOTS.length = 0; PILOTS.push({ id:"owner", stage:"production" }, { id:"misato", stage:"production" }); } else seed();
// ?theme= (and ?mode=, ?accent=) in the address win; otherwise what this browser last chose; an older single theme name
// is mapped to its nearest Theme · Mode · Accent.
{ const prefs = readPrefs(), q = new URLSearchParams(location.search); const t = q.get("theme") || prefs.theme; const old = migrateTheme(t);
  if (prefs.crt === true) setCrt(true);
  setTheme(old ? old[0] : t, q.get("mode") || (old ? old[1] : prefs.mode), q.get("accent") || (old ? old[2] : prefs.accent)); }
initMap(); requestAnimationFrame(frame);
