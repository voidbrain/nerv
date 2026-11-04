/* Live adapter for the dashboard (F-019). Runs only in LIVE mode (dashboard.js): swaps the login code for the token,
   which stays in this tab's memory, then polls this NERV Agency service and maps its sorties, events and approvals onto
   the dashboard's panels. Panels without real data yet say so instead of showing invented numbers. */
(() => {
  if (!LIVE) return;
  const code = location.hash.slice(6); history.replaceState(null, "", location.pathname + location.search);
  let token = ""; let polling = false; const detailCache = {}; const known = new Map(); let chatBusy = false;
  const PLANNED = "<div class='muted small'>Planned · not connected yet.</div>";
  const api = async (path, init = {}) => {
    const res = await fetch("/api/" + path, { ...init, headers:{ "Content-Type":"application/json", Authorization:"Bearer " + token } });
    const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || ("HTTP " + res.status)); return data;
  };
  const short = id => "S-" + id.slice(0, 4).toUpperCase();
  const banner = document.querySelector(".banner.shadow");
  const setBanner = (html, kind) => { banner.classList.toggle("shadow", kind !== "live"); banner.querySelector("div").innerHTML = html; };
  // Simulation-only controls have no live meaning (the Spear has no live endpoint yet).
  document.head.insertAdjacentHTML("beforeend", "<style>[data-spear],[data-toggle],[data-promote],[data-demote],[data-d=edit]{display:none}</style>");
  ["btn-dummy", "btn-reset", "btn-spear"].forEach(id => { const el = document.getElementById(id); if (el) el.hidden = true; });
  const preset = document.getElementById("new-preset"); if (preset) preset.hidden = true;
  document.getElementById("new-text").placeholder = "Tell Misato what to do — it plans, the gate decides each action's Pattern";
  BASES[0] = Object.assign(BASES[0], { name:"TOKYO-3", role:"HQ · this machine", status:"online", cpu:null, ram:null, gpu:null, rtt:0, models:"—" });

  function mapStatus(s) { return s.status === "open" ? (s.waiting ? "waiting" : "active") : s.status === "done" ? "done" : s.status === "failed" ? "failed" : "stood-down"; }
  function toSortie(s) {
    const d = detailCache[s.id]; const actions = d ? d.detail.map(a => {
      TOOLS[a.tool] = TOOLS[a.tool] || { effect:a.ballot.effect };
      return { tool:a.tool, args:a.args, status:a.status, ballot:a.ballot, rejects:0 };
    }) : s.patterns.map(p => ({ tool:"", args:{}, status:"proposed", ballot:{ pattern:p } }));
    const status = mapStatus(s); const any = st => actions.some(a => a.status === st);
    const done = { detect:true, intake:true, route:true, plan:actions.length > 0, magi:actions.length > 0, sync:actions.length > 0,
      apt:actions.some(a => a.ballot && a.ballot.outcome === "approval"), plug:any("done") || any("failed") || any("proposed"), eva:any("done") || any("failed"), debrief:status !== "active" && status !== "waiting" };
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
      const [list, cards, doctor, pending] = await Promise.all([api("sorties?limit=20"), api("approvals"), api("doctor"), api("reminders/pending")]);
      const selected = state.sorties.find(x => x.id === state.selected);
      const want = list.filter(s => (selected && s.id === selected.realId) || s.waiting || !detailCache[s.id] || s.status === "open").slice(0, 8);
      await Promise.all(want.map(async s => { detailCache[s.id] = await api("sorties/" + s.id); }));
      if (selected) await loadEvents(selected.realId);
      state.sorties = list.map(toSortie);
      state.approvals = cards.map(toApproval).filter(ap => state.sorties.some(s => s.id === ap.sortie));
      state.upcoming = pending.map(r => ({ at:Date.parse(r.due), title:r.title, kind:"reminder" }));
      state.doctor = doctor;
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
    document.getElementById("health").innerHTML = rows.map(c => "<div class='row small'><span>" + c[0] + "</span><span class='" + c[1] + "'>" + (c[1] === "ok" ? "✓ " : "✗ ") + esc(c[2]) + "</span></div>").join("");
  };
  window.renderBases = function () {
    document.getElementById("bases-sub").textContent = "1/1 online";
    const roles = ((state.doctor || {}).models || {}).roles || {};
    document.getElementById("bases").innerHTML = "<div class='card'><div class='row'><span class='b'>TOKYO-3</span><span class='badge b-ok'>ONLINE</span></div><div class='tiny muted'>HQ · this machine · coordinator, scheduler, brain</div><div class='tiny muted'>Misato " + esc(roles.misato || "—") + " · Casper " + esc(roles.casper || "—") + "</div></div>" +
      "<div class='muted small' style='margin-top:4px'>Other bases (Kaji line) are planned · not connected yet.</div>";
  };
  window.renderBudget = function () { document.getElementById("budget").innerHTML = PLANNED; };
  window.renderMelons = function () { document.getElementById("melons").innerHTML = PLANNED; };
  window.renderCages = function () { document.getElementById("cages").innerHTML = "<div class='muted small'>Executors run inside this service; sandboxed cages are planned · not connected yet.</div>"; };
  window.renderAway = function () { document.getElementById("away").innerHTML = PLANNED; document.getElementById("away-since").textContent = ""; };
  window.renderQuestions = function () {
    const n = state.approvals.length; document.getElementById("qv-needs").textContent = n;
    document.getElementById("qd-needs").textContent = n ? state.approvals.map(a => a.action.tool).join(" · ") : "nothing waits for you"; document.getElementById("q-needs").classList.toggle("alert", n > 0);
    document.getElementById("qv-away").textContent = "—"; document.getElementById("qd-away").textContent = "planned · not connected yet";
    const next = state.upcoming.filter(u => u.at > Date.now()).sort((a, b) => a.at - b.at)[0];
    document.getElementById("qv-next").textContent = next ? hhmm(next.at) : "—"; document.getElementById("qd-next").textContent = next ? next.title : "nothing scheduled";
    const p = (state.doctor || {}).processes || {}; const bad = !p.nervous || p.brainAlive === false;
    document.getElementById("qv-health").textContent = bad ? "issue" : "OK"; document.getElementById("qd-health").textContent = bad ? "a process is down" : "all checks pass"; document.getElementById("q-health").classList.toggle("alert", bad);
    document.getElementById("qv-budget").textContent = "$0.00"; document.getElementById("qd-budget").textContent = "local models · no per-token cost";
  };
  state.upcoming = []; state.selected = null; renderAll();
  setBanner("<b>LIVE · SIGNING IN</b> <span class='muted'>— exchanging the one-use login code…</span>");
  fetch("/api/session/exchange", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ code }) })
    .then(r => r.json().then(d => { if (!r.ok || !d.token) throw new Error(d.error || "Login failed"); token = d.token; poll(); setInterval(poll, 3000); }))
    .catch(e => setBanner("<b>LIVE · NOT SIGNED IN</b> <span class='muted'>— " + esc(e.message) + "</span>"));
  // A click on a sortie loads its trace at once instead of waiting for the next poll.
  document.addEventListener("click", e => { const t = e.target.closest("[data-s]"); if (t) setTimeout(poll, 0); });
})();
