/* Live adapter for the dashboard (F-019). Runs only in LIVE mode (dashboard.js): swaps the login code for the token,
   which stays in this tab's memory, then polls this NERV Agency service and maps its sorties, events and approvals onto
   the dashboard's panels. Panels without real data yet say so instead of showing invented numbers. */
(() => {
  if (!LIVE) return;
  const match = /^#code=([a-f0-9]{32})$/.exec(location.hash); const code = match ? match[1] : null;
  if (match) history.replaceState(null, "", location.pathname + location.search);
  let token = ""; let polling = false; let lastRan = null; const detailCache = {}; const known = new Map(); let chatBusy = false;
  const PLANNED = "<div class='muted small'>Planned · not connected yet.</div>";
  const api = async (path, init = {}) => {
    const res = await fetch("/api/" + path, { ...init, headers:{ "Content-Type":"application/json", Authorization:"Bearer " + token } });
    const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || ("HTTP " + res.status)); return data;
  };
  const short = id => "S-" + id.slice(0, 4).toUpperCase();
  const banner = document.querySelector(".banner.shadow");
  const setBanner = (html, kind) => { banner.classList.toggle("shadow", kind !== "live"); banner.querySelector("div").innerHTML = html; };
  // Simulation-only controls have no live meaning.
  document.head.insertAdjacentHTML("beforeend", "<style>[data-toggle],[data-promote],[data-demote],[data-d=edit]{display:none}</style>");
  ["btn-dummy", "btn-reset", "btn-spear"].forEach(id => { const el = document.getElementById(id); if (el) el.hidden = true; });
  BASES[0] = Object.assign(BASES[0], { name:"TOKYO-3", role:"HQ · this machine", status:"online", cpu:null, ram:null, gpu:null, rtt:0, models:"—" });

  function mapStatus(s) { return s.status === "open" ? (s.waiting ? "waiting" : "active") : s.status === "done" ? "done" : s.status === "failed" ? "failed" : "stood-down"; }
  function toSortie(s) {
    const d = detailCache[s.id]; const actions = d ? d.detail.map(a => {
      TOOLS[a.tool] = TOOLS[a.tool] || { effect:a.ballot.effect };
      return { tool:a.tool, args:a.args, status:a.status, ballot:a.ballot, rejects:0 };
    }) : s.patterns.map(p => ({ tool:"", args:{}, status:"proposed", ballot:{ pattern:p } }));
    const status = mapStatus(s);
    // One pass through the flow is one action: after the plan, only the latest action counts, so a step an earlier
    // action passed but this one bypassed is not shown as passed.
    const latest = actions[actions.length - 1]; const latestIs = (...st) => !!latest && st.includes(latest.status);
    const done = { detect:true, intake:true, route:true, plan:actions.length > 0, magi:!!latest, sync:!!latest,
      apt:!!latest && !!latest.ballot && latest.ballot.outcome === "approval", plug:latestIs("done", "failed", "proposed"), eva:latestIs("done", "failed"), debrief:status !== "active" && status !== "waiting" };
    const phase = status === "waiting" ? "apt" : status === "active" ? "magi" : "debrief";
    const last = actions[actions.length - 1];
    return { id:short(s.id), realId:s.id, title:s.title, preset:null, pilot:s.source === "misato" ? "misato" : "owner", source:"aoba", proactive:false, consult:false,
      trust:s.trust, battery:0, spent:0, started:Date.parse(s.created), ended:s.closed ? Date.parse(s.closed) : null, status, phase, done,
      actions, current:Math.max(0, actions.length - 1), ballot:last && last.ballot && last.ballot.verdicts ? last.ballot : null, outcome:known.get(s.id) || null, happened:[], note:"" };
  }
  function toApproval(a) {
    const c = a.card; TOOLS[c.tool] = TOOLS[c.tool] || { effect:c.effect };
    return { id:a.id, sortie:short(c.sortieId), action:{ tool:c.tool, args:c.args, status:"waiting" },
      ballot:{ pattern:c.pattern, effect:c.effect, executor:"—", verdicts:c.verdicts, sync:c.sync, outcome:"approval", reason:c.reason },
      reason:c.reason, created:Date.now(), expires:Date.parse(c.expires) };
  }
  async function poll() {
    if (polling || !token) return; polling = true;
    try {
      const [list, cards, doctor, pending, inbox, facts, episodes, kajiBases] = await Promise.all([api("sorties?limit=20"), api("approvals"), api("doctor"), api("reminders/pending"), api("inbox"), api("memory"), api("memory/episodes"), api("bases").catch(() => [])]);
      applyBases(kajiBases, healthOf(doctor));
      state.lilith = Object.assign(state.lilith || { history:{} }, { facts, episodes });
      state.delivered = inbox.map(d => Date.parse(d.created));
      const selected = state.sorties.find(x => x.id === state.selected);
      const want = list.filter(s => (selected && s.id === selected.realId) || s.waiting || !detailCache[s.id] || s.status === "open").slice(0, 8);
      await Promise.all(want.map(async s => { detailCache[s.id] = await api("sorties/" + s.id); }));
      // The one live "cage": the in-process executor beats when an action newly ran.
      const ran = Object.values(detailCache).flatMap(d => d.detail).filter(a => a.status === "done" || a.status === "failed").map(a => a.created).sort().pop();
      if (ran && lastRan && ran > lastRan) activeCage["EVA-02"] = Date.now() + 4000; if (ran) lastRan = ran;
      if (selected) await loadEvents(selected.realId);
      state.sorties = list.map(toSortie);
      state.approvals = cards.map(toApproval).filter(ap => state.sorties.some(s => s.id === ap.sortie));
      state.upcoming = pending.map(r => ({ at:Date.parse(r.due), title:r.title, kind:"reminder" }));
      state.doctor = doctor;
      if (doctor.base && BASES[0].name !== doctor.base.name.toUpperCase()) { BASES[0].name = doctor.base.name.toUpperCase(); BASES[0].role = doctor.base.id + " · this machine"; document.getElementById("cages").innerHTML = ""; }
      if (!state.selected && state.sorties[0]) state.selected = state.sorties[0].id;
      renderAll();
      setBanner("<b>LIVE</b> <span class='muted'>— this NERV Agency service · " + list.length + " recent sorties · refreshed " + new Date().toTimeString().slice(0, 8) + "</span>", "live");
    } catch (e) { setBanner("<b>LIVE · CONNECTION LOST</b> <span class='muted'>— " + esc(e.message) + ". Run npm start -- open dashboard again if the service restarted.</span>"); }
    finally { polling = false; }
  }
  // Comms: the selected sortie's own trace (requests, steps, ballots, decisions, replies) plus what you typed here.
  const seen = new Set();
  async function loadEvents(id) {
    let after = 0; const all = [];
    for (;;) { const page = await api("sorties/" + id + "/events?after=" + after); if (!page.length) break; all.push(...page); after = page[page.length - 1].sequence; if (page.length < 50) break; }
    for (const e of all) {
      const key = id + ":" + e.sequence; if (seen.has(key)) continue; seen.add(key);
      const s = { id:short(id) }; const t = Date.parse(e.created); const p = e.payload || {};
      const line = e.kind === "misato.request" ? ["Owner: " + p.text, "", "you"] : e.kind === "misato.reply" ? ["Misato: " + p.text, "ok", "misato"]
        : e.kind === "ballot" ? ["MAGI: Pattern " + p.pattern.toUpperCase() + " · " + p.outcome + " · " + p.reason, p.outcome === "grant" ? "ok" : p.outcome === "reject" ? "danger" : "warn", "magi"]
        : e.kind === "approval.requested" ? ["Approval card: " + p.reason, "warn", "penpen"]
        : e.kind.startsWith("approval.") ? ["Owner " + e.kind.slice(9) + " (" + (p.source || "") + ")", e.kind === "approval.approve" ? "ok" : "danger", "you"]
        : e.kind === "action.done" ? ["EVA-02: " + p.tool + " done", "ok", "eva-02"] : e.kind === "action.failed" ? ["EVA-02: " + p.tool + " failed · " + p.error, "danger", "eva-02"]
        : e.kind === "misato.resumed" ? ["Misato: resuming after your decision", "", "misato"] : e.kind === "sortie.done" || e.kind === "sortie.failed" ? ["Debrief: " + e.kind.slice(7), e.kind === "sortie.done" ? "ok" : "danger", "misato"] : null;
      if (e.kind === "misato.reply") known.set(id, p.text);
      if (line) state.log.push({ t, msg:line[0], cls:line[1], s:s.id, who:line[2], chat:e.kind.startsWith("misato.") });
    }
    state.log.sort((a, b) => a.t - b.t); if (state.log.length > 300) state.log.splice(0, state.log.length - 300);
  }

  // Real actions instead of simulated ones.
  window.decide = async function (apId, decision) {
    try { const r = await api("approvals/" + apId, { method:"POST", body:JSON.stringify({ decision }) }); log("Owner " + decision + " · " + r.decision + (r.error ? " · " + r.error : ""), decision === "approve" ? "ok" : "danger", null, "you"); }
    catch (e) { log("Decision failed: " + e.message, "danger"); }
    poll();
  };
  window.chat = async function (text) {
    log(text, "", null, "you"); state.log[state.log.length - 1].chat = true;
    if (chatBusy) { log("Misato is still working on the previous request.", "warn", null, "misato"); return; }
    chatBusy = true; log("Misato is planning… (local models take 10–30 s per step)", "", null, "misato");
    try { const r = await api("chat", { method:"POST", body:JSON.stringify({ message:text, conversation:"dashboard" }) }); state.selected = short(r.sortieId); }
    catch (e) { log("Misato could not answer: " + e.message, "danger", null, "misato"); }
    finally { chatBusy = false; poll(); }
  };
  window.seatMetric = function (seat, s, a) {
    if (seat === "melchior") return "rules · Scrolls · deterministic";
    if (seat === "balthasar") return "reversibility · budget · taint" + (s ? " · " + s.trust : "");
    return a && a.ballot && a.ballot.pattern && a.ballot.pattern !== "green" ? "Casper · local model (S²)" : "Green: not consulted";
  };
  window.renderHealth = function () {
    const d = state.doctor; if (!d) { document.getElementById("health").innerHTML = "<div class='muted small'>Waiting for doctor…</div>"; return; }
    const p = d.processes || {}; const m = d.models || {}; const roles = m.roles || {};
    const rows = [["Scheduler (nervous)", p.nervous ? "ok" : "danger", p.nervous ? "pid " + p.nervous : "not running"],
      ["Brain process", p.brainAlive === false ? "danger" : "ok", p.brain ? "pid " + p.brain + (p.brainAlive === false ? " · not alive" : " · alive") : "unknown"],
      ["Misato", roles.misato && !/not set/.test(roles.misato) ? "ok" : "warn", roles.misato || "—"], ["Casper", roles.casper && /^local \(/.test(roles.casper) ? "ok" : "warn", roles.casper || "—"],
      ["Central Dogma (SQLite)", d.database && d.database.quick_check === "ok" ? "ok" : "danger", "schema " + ((d.schema || {}).user_version ?? "?") + " · " + ((d.database || {}).quick_check || "?")],
      ["Pending reminders", "ok", String(((d.pending || {}).count) ?? 0)]];
    document.getElementById("health").innerHTML = rows.map(c => "<div class='row small'><span>" + c[0] + "</span><span class='" + c[1] + "'>" + (c[1] === "ok" ? "✓ " : "✗ ") + esc(c[2]) + "</span></div>").join("") +
      "<div class='row small' style='margin-top:6px'><span class='muted'>Edited config.json? Apply it without a restart.</span><button class='btn sm' id='btn-reload'>Reload models</button></div>";
  };
  // Kaji bases (F-036): every enrolled base with its real status; positions are a fixed layout around this base
  // (no real coordinates exist), redrawn when the set of bases or their status changes.
  let basesKey = "";
  /** This base's health from doctor: online (all well), standby (degraded: brain down or no model route for Misato), offline (scheduler down). */
  function healthOf(d) {
    const p = (d && d.processes) || {}; const roles = ((d && d.models) || {}).roles || {};
    if (!p.nervous) return "offline";
    return p.brainAlive === false || !roles.misato || /not set|not configured/.test(roles.misato) ? "standby" : "online";
  }
  // Real heartbeats on the Kaji line: when a peer's last-seen time moves, a pulse travels from it to this base.
  const heard = {};
  function pulseHeartbeats(list) {
    const self = list.find(b => b.self);
    for (const b of list) {
      if (b.self || !b.lastSeen) continue;
      if (heard[b.baseId] && heard[b.baseId] !== b.lastSeen && self && b.online) sendPacket(b.baseId.toLowerCase(), self.baseId.toLowerCase(), "sync");
      heard[b.baseId] = b.lastSeen;
    }
  }
  function applyBases(list, health) {
    state.kajiBases = list;
    if (!list.length) { BASES[0].status = health; return; }
    pulseHeartbeats(list);
    const key = list.map(b => b.baseId + ":" + b.status + ":" + b.online).join("|") + "|" + health; if (key === basesKey) return; basesKey = key;
    const self = list.find(b => b.self) || list[0]; const others = list.filter(b => b !== self);
    const place = (b, i) => { const a = 2 * Math.PI * i / Math.max(3, others.length) - Math.PI / 2; return b === self ? [35.236, 138.985] : [35.236 + 0.09 * Math.sin(a), 138.985 + 0.2 * Math.cos(a)]; };
    const toBase = (b, i) => { const [lat, lon] = place(b, i); return { id:b.baseId.toLowerCase(), name:b.name.toUpperCase(), role:b.baseId + (b.self ? " · this machine" : " · " + b.address), lat, lon, status:b.status === "revoked" ? "offline" : b.online ? "online" : "offline", cpu:null, ram:null, gpu:null, rtt:null, models:"—" }; };
    BASES.splice(0, BASES.length, toBase(self, 0), ...others.map((b, i) => toBase(b, i)));
    // This base's pulse and its EVA cage follow its real health; peers show online/offline (their health travels with phase 2).
    BASES[0].status = health;
    LINKS.length = 0; const up = list.filter(b => b.status === "enrolled");
    for (let i = 0; i < up.length; i++) for (let j = i + 1; j < up.length; j++) LINKS.push([up[i].baseId.toLowerCase(), up[j].baseId.toLowerCase()]);
    CAGES.forEach(c => { c.base = BASES[0].id; }); document.getElementById("cages").innerHTML = "";
    initMap();
  }
  const sinceText = t => { if (!t) return "never heard"; const s = Math.round((Date.now() - Date.parse(t)) / 1000); return s < 90 ? "seen " + s + " s ago" : s < 5400 ? "last seen " + Math.round(s / 60) + " min ago" : "last seen " + new Date(t).toLocaleString(); };
  window.renderBases = function () {
    const list = state.kajiBases || []; const roles = ((state.doctor || {}).models || {}).roles || {};
    if (!list.length) {
      const base = (state.doctor || {}).base || { id:"NERV-01", name:"Neo Tokyo-3" };
      document.getElementById("bases-sub").textContent = "1/1 online";
      document.getElementById("bases").innerHTML = "<div class='card'><div class='row'><span class='b'>" + esc(base.name) + " · " + esc(base.id) + "</span><span class='badge b-ok'>ONLINE</span></div><div class='tiny muted'>this machine · coordinator, scheduler, brain</div><div class='tiny muted'>Misato " + esc(roles.misato || "—") + " · Casper " + esc(roles.casper || "—") + "</div></div>" +
        "<div class='muted small' style='margin-top:4px'>No Kaji line yet: enrol your bases (INSTALL, Kaji line) to see them here.</div>";
      return;
    }
    document.getElementById("bases-sub").textContent = list.filter(b => b.online).length + "/" + list.filter(b => b.status === "enrolled").length + " online";
    document.getElementById("bases").innerHTML = list.map(b => "<div class='card'><div class='row'><span class='b'>" + esc(b.name) + " · " + esc(b.baseId) + "</span><span class='badge " + (b.status === "revoked" ? "b-muted'>REVOKED" : b.self && BASES[0].status === "standby" ? "b-warn'>DEGRADED" : b.self && BASES[0].status === "offline" ? "b-danger'>DOWN" : b.online ? "b-ok'>ONLINE" : "b-warn'>OFFLINE") + "</span></div>" +
      "<div class='tiny muted'>" + (b.self ? "this machine" : esc(b.address)) + " · key " + esc(b.fingerprint.slice(0, 9)) + " · " + (b.self ? "local" : esc(sinceText(b.lastSeen))) + "</div>" +
      (b.self ? "<div class='tiny muted'>Misato " + esc(roles.misato || "—") + " · Casper " + esc(roles.casper || "—") + "</div>" : "") + "</div>").join("");
  };
  // Lilith: the owner's facts, editable here; every change is the owner's and stays in the fact's history.
  window.renderLilith = function () {
    const l = state.lilith || { facts:[], episodes:[], history:{} }; const open = state.lilithOpen;
    // The panel redraws on every poll: keep what the owner is typing and where the focus is.
    const draftEl = document.getElementById("lilith-new"); const draft = draftEl ? draftEl.value : ""; const typing = document.activeElement === draftEl;
    document.getElementById("lilith-sub").textContent = l.facts.length + " facts";
    const facts = l.facts.map(f => "<div class='card'><div class='row small'><span>" + esc(f.text) + "</span><span class='tiny muted'>" + esc(f.source) + (f.tainted ? " · tainted" : "") + "</span></div>" +
      "<div class='row tiny' style='margin-top:3px'><span><button class='btn sm' data-mem-edit='" + f.id + "'>Edit</button> <button class='btn sm danger' data-mem-forget='" + f.id + "'>Forget</button> " +
      "<button class='btn sm' data-mem-share='" + f.id + "' data-shareable='" + (!f.shareable) + "' aria-pressed='" + f.shareable + "'>" + (f.shareable ? "Shareable" : "Local-only") + "</button></span>" +
      "<a href='#' class='muted' data-mem-hist='" + f.id + "'>" + (open === f.id ? "hide history" : "history") + "</a></div>" +
      (open === f.id && l.history[f.id] ? "<div class='tiny muted' style='margin-top:3px'>" + l.history[f.id].map(h => esc(h.created.slice(0, 16).replace("T", " ") + " · " + h.kind + " · " + h.source + " · " + h.text)).join("<br/>") + "</div>" : "") + "</div>").join("");
    const eps = l.episodes.filter(e => e.summary).slice(0, 3).map(e => "<div class='tiny muted' style='margin-top:3px'>" + esc(e.until.slice(0, 10)) + " · " + esc(e.summary) + "</div>").join("");
    document.getElementById("lilith").innerHTML = (facts || "<div class='muted small'>No facts yet. Tell Misato something to remember, or add one here.</div>") +
      "<form id='lilith-form' class='row' style='margin-top:6px;gap:4px'><label class='sr-only' for='lilith-new'>New fact</label><input id='lilith-new' maxlength='500' placeholder='Add a fact about you' style='flex:1'/><button class='btn sm' type='submit'>Remember</button></form>" +
      (eps ? "<div class='small muted' style='margin-top:6px'>INSTRUMENTALITY · RECENT SUMMARIES</div>" + eps : "") +
      "<div class='tiny muted' style='margin-top:4px'>Local-only facts never reach a cloud model; shareable ones may.</div>";
    const input = document.getElementById("lilith-new"); input.value = draft; if (typing) { input.focus(); input.setSelectionRange(draft.length, draft.length); }
  };
  const memoryAction = async (path, init, done) => { try { await api(path, init); if (done) log(done, "ok", null, "maya"); } catch (e) { log("Memory: " + e.message, "danger", null, "maya"); } poll(); };
  document.addEventListener("click", e => {
    const t = e.target.closest("[data-mem-edit],[data-mem-forget],[data-mem-share],[data-mem-hist]"); if (!t) return; e.preventDefault();
    const facts = (state.lilith || { facts:[] }).facts;
    if (t.dataset.memEdit) { const f = facts.find(x => x.id === t.dataset.memEdit); const text = f && prompt("Edit this fact", f.text); if (text && text.trim() && text !== f.text) memoryAction("memory/" + f.id, { method:"PUT", body:JSON.stringify({ text }) }, "Fact updated."); }
    else if (t.dataset.memForget) { const f = facts.find(x => x.id === t.dataset.memForget); if (f && confirm("Forget: " + f.text + "? Its history is kept.")) memoryAction("memory/" + f.id + "/forget", { method:"POST", body:"{}" }, "Fact forgotten."); }
    else if (t.dataset.memShare) memoryAction("memory/" + t.dataset.memShare + "/share", { method:"POST", body:JSON.stringify({ shareable:t.dataset.shareable === "true" }) });
    else if (t.dataset.memHist) { const id = t.dataset.memHist; if (state.lilithOpen === id) { state.lilithOpen = null; renderLilith(); return; }
      api("memory/" + id + "/history").then(h => { state.lilith.history[id] = h; state.lilithOpen = id; renderLilith(); }).catch(err => log("Memory: " + err.message, "danger", null, "maya")); }
  });
  document.addEventListener("submit", e => {
    if (e.target.id !== "lilith-form") return; e.preventDefault(); const input = document.getElementById("lilith-new"); const text = input.value.trim();
    if (text) { input.value = ""; memoryAction("memory", { method:"POST", body:JSON.stringify({ text }) }, "Remembered: " + text); }
  });
  // The sortie detail, live: who started it and its status (pilots are skills, Misato is the planner), the plan when there
  // is one, and the Spear only while the sortie is open; no battery line while every route is local and free.
  const baseDetail = window.renderDetail;
  window.renderDetail = function (s) {
    const box = document.getElementById("detail"); const sub = document.getElementById("detail-sub");
    if (!s) { box.innerHTML = "<div class='muted'>No sortie selected.</div>"; sub.textContent = ""; return; }
    const who = s.pilot === "misato" ? "Misato, from a chat" : "you, as a direct action";
    const status = { active:"running", waiting:"waiting for you", done:"done", failed:"failed", "stood-down":"stopped" }[s.status] || s.status;
    if (!s.actions.length) { box.innerHTML = "<div class='muted small'>No actions: Misato answered without using a tool.</div>" + (s.outcome ? "<div class='small' style='margin-top:4px'>Reply: " + esc(s.outcome) + "</div>" : ""); sub.textContent = "started by " + who + " · " + status; return; }
    if (s.actions.some(a => !a.ballot || !a.ballot.verdicts)) { box.innerHTML = "<div class='muted small'>Loading this sortie…</div>"; sub.textContent = "started by " + who + " · " + status; return; }
    baseDetail(s); sub.textContent = "started by " + who + " · " + status;
    box.querySelectorAll(".plan .row .tiny.muted").forEach(el => { if (/battery/.test(el.textContent)) el.remove(); });
    if (s.status !== "active" && s.status !== "waiting") box.querySelectorAll("[data-spear]").forEach(el => el.remove());
  };
  window.renderBudget = function () { document.getElementById("budget").innerHTML = PLANNED; };
  window.renderMelons = function () { document.getElementById("melons").innerHTML = PLANNED; };
  // While you were away: from real sorties and deliveries since your last visit, remembered in this browser only.
  const VISIT = "nerv.dashboard.lastVisit";
  try { const v = Number(localStorage.getItem(VISIT)); state.lastVisit = Number.isFinite(v) && v > 0 ? v : Date.now() - 12 * HOUR; } catch { state.lastVisit = Date.now() - 12 * HOUR; }
  window.liveSeen = function () { try { localStorage.setItem(VISIT, String(state.lastVisit)); } catch { /* private window: forget on reload */ } };
  window.renderAway = function () {
    const since = state.lastVisit; const ended = state.sorties.filter(s => s.ended && s.ended > since);
    const count = st => ended.filter(s => s.status === st).length; const delivered = (state.delivered || []).filter(t => t > since).length;
    document.getElementById("away-since").textContent = "since " + hhmm(since);
    document.getElementById("away").innerHTML = "<div class='small' style='margin-bottom:6px'>Since your last visit: <b class='ok'>" + count("done") + "</b> done, <b class='danger'>" + count("failed") + "</b> failed, <b class='warn'>" + count("stood-down") + "</b> stopped, and Pen Pen delivered <b>" + delivered + "</b> reminders.</div>" +
      ended.slice(0, 8).map(s => "<div class='row small'><span><span class='" + (s.status === "done" ? "ok" : s.status === "failed" ? "danger" : "warn") + "'>■</span> " + hhmm(s.ended) + " · " + esc(s.title) + "</span><a href='#' data-s='" + s.id + "' class='muted tiny'>open</a></div>" + (s.outcome ? "<div class='tiny muted' style='margin:0 0 4px 12px'>" + esc(s.outcome) + "</div>" : "")).join("") +
      "<button class='btn sm' id='btn-seen' style='margin-top:4px'>Mark as read</button>";
  };
  window.liveReload = async function () {
    try { const r = await api("models/reload", { method:"POST" }); const roles = (r.models || {}).roles || {}; log("Models reloaded · Misato " + (roles.misato || "—") + " · Casper " + (roles.casper || "—"), "ok", null, "maya"); }
    catch (e) { log("Reload refused: " + e.message + " (the previous settings stay in use)", "danger", null, "maya"); }
    poll();
  };
  window.liveSpear = async function (shortId) {
    const s = state.sorties.find(x => x.id === shortId); if (!s) return;
    if (!confirm("Spear " + s.id + "? Unused grants are revoked and waiting cards stood down. Actions that already ran are not undone.")) return;
    try { const r = await api("sorties/" + s.realId + "/spear", { method:"POST", body:JSON.stringify({ reason:"Spear from the dashboard" }) });
      log("SPEAR " + s.id + ": " + r.revoked + " grants revoked, " + r.stoodDown + " cards stood down; already happened: " + (r.happened.map(h => h.tool + (h.inverse ? " (undo with " + h.inverse + ")" : " (no undo)")).join(", ") || "nothing"), "danger", null, "gendo"); }
    catch (e) { log("Spear failed: " + e.message, "danger", null, "gendo"); }
    poll();
  };
  window.renderQuestions = function () {
    const n = state.approvals.length; document.getElementById("qv-needs").textContent = n;
    document.getElementById("qd-needs").textContent = n ? state.approvals.map(a => a.action.tool).join(" · ") : "nothing waits for you"; document.getElementById("q-needs").classList.toggle("alert", n > 0);
    { const ended = state.sorties.filter(s => s.ended && s.ended > state.lastVisit); const c = st => ended.filter(s => s.status === st).length; const delivered = (state.delivered || []).filter(t => t > state.lastVisit).length;
      document.getElementById("qv-away").textContent = c("done") + " done"; document.getElementById("qd-away").textContent = c("failed") + " failed · " + c("stood-down") + " stopped · " + delivered + " reminders";
      document.getElementById("q-away").classList.toggle("attn", c("failed") + c("stood-down") > 0); }
    const next = state.upcoming.filter(u => u.at > Date.now()).sort((a, b) => a.at - b.at)[0];
    document.getElementById("qv-next").textContent = next ? hhmm(next.at) : "—"; document.getElementById("qd-next").textContent = next ? next.title : "nothing scheduled";
    const p = (state.doctor || {}).processes || {}; const bad = !p.nervous || p.brainAlive === false;
    document.getElementById("qv-health").textContent = bad ? "issue" : "OK"; document.getElementById("qd-health").textContent = bad ? "a process is down" : "all checks pass"; document.getElementById("q-health").classList.toggle("alert", bad);
    document.getElementById("qv-budget").textContent = "$0.00"; document.getElementById("qd-budget").textContent = "local models · no per-token cost";
  };
  state.upcoming = []; state.selected = null; renderAll();
  let started = false; const begin = () => { if (started) return; started = true; poll(); setInterval(poll, 3000); };
  // Not signed in (a reload drops the one-use code): a clear bar with a token field, never the simulation's invented data.
  const signIn = reason => {
    setBanner("<b>LIVE · NOT SIGNED IN</b> <span class='muted'>— " + esc(reason) + " Run <code>nerv open dashboard</code>, or paste the access token (kept in this tab's memory only):</span> " +
      "<form id='live-signin' style='display:inline-flex;gap:4px'><label class='sr-only' for='live-token'>Access token</label><input id='live-token' type='password' autocomplete='off' style='width:16em'/><button class='btn sm' type='submit'>Sign in</button></form>");
  };
  document.addEventListener("submit", e => {
    if (e.target.id !== "live-signin") return; e.preventDefault(); const input = document.getElementById("live-token"); const value = input.value.trim(); input.value = "";
    if (!value) return; token = value; api("status").then(begin).catch(err => { token = ""; signIn("That token was refused (" + err.message + ")."); });
  });
  if (code) {
    setBanner("<b>LIVE · SIGNING IN</b> <span class='muted'>— exchanging the one-use login code…</span>");
    fetch("/api/session/exchange", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ code }) })
      .then(r => r.json().then(d => { if (!r.ok || !d.token) throw new Error(d.error || "Login failed"); token = d.token; begin(); }))
      .catch(e => signIn(e.message + "."));
  } else signIn("This page was reloaded or opened without a login code.");
  // A click on a sortie loads its trace at once instead of waiting for the next poll.
  document.addEventListener("click", e => { const t = e.target.closest("[data-s]"); if (t) setTimeout(poll, 0); });
})();
