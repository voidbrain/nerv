/* Live adapter for the dashboard (F-019). Runs only in LIVE mode (dashboard.js): swaps the login code for the token,
   which stays in this tab's memory, then polls this NERV Agency service and maps its sorties, events and approvals onto
   the dashboard's panels. Panels without real data yet say so instead of showing invented numbers. */
(() => {
  if (!LIVE) return;
  const match = /^#code=([a-f0-9]{32})$/.exec(location.hash); const code = match ? match[1] : null;
  if (match) history.replaceState(null, "", location.pathname + location.search);
  const consulted = new Set();
  let older = [], matches = [], shown = [], searchSeq = 0, searchTimer = null; let editing = null;
  let token = ""; let polling = false; let pollFailures = 0; let lastRan = null; let firstTrace = true; const detailCache = {}; const known = new Map(); let chatBusy = false; let followNew = null;
  const PLANNED = "<div class='muted small'>Planned · not connected yet.</div>";
  const api = async (path, init = {}) => {
    const method = init.method || "GET";
    try {
      const res = await fetch("/api/" + path, { ...(method === "GET" ? { signal:AbortSignal.timeout(10000) } : {}), ...init, headers:{ "Content-Type":"application/json", Authorization:"Bearer " + token } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(data.error || ("HTTP " + res.status)), { status:res.status });
      return data;
    } catch (e) {
      throw Object.assign(new Error(method + " /api/" + path + ": " + (e.name === "TimeoutError" ? "read timed out" : e.message)), { status:e.status });
    }
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
    // The consultant's advice is a passed step when it was given (owner, 2026-11-05: ADVISE stayed unlit after it advised).
    const done = { detect:true, intake:true, route:true, consult:consulted.has(s.id), plan:actions.length > 0 || known.has(s.id), magi:!!latest, sync:!!latest,
      apt:!!latest && !!latest.ballot && latest.ballot.outcome === "approval", plug:latestIs("done", "failed", "proposed"), eva:latestIs("done", "failed"), debrief:status !== "active" && status !== "waiting" };
    const phase = status === "waiting" ? "apt" : status === "active" ? (phaseOf.get(s.id) || "plan") : "debrief";
    const last = actions[actions.length - 1];
    return { id:short(s.id), realId:s.id, title:s.title, preset:null, pilot:s.source === "misato" ? "misato" : "owner", source:"aoba", proactive:false, consult:consulted.has(s.id), advisor:advisedBy.get(s.id) || null, forwarded:forwardedTo.get(s.id) || null, origin:originOf.get(s.id) || null, remoteSortie:remoteSorties.get(s.id) || null, // F-025: lit when a consultant advised Misato (its advice is in Comms)
     
      why:s.why || "", created:s.created, trust:s.trust, battery:0, spent:0, started:Date.parse(s.created), ended:s.closed ? Date.parse(s.closed) : null, status, phase, done,
      actions, current:Math.max(0, actions.length - 1), ballot:last && last.ballot && last.ballot.verdicts ? last.ballot : null, outcome:known.get(s.id) || null, happened:[], note:"" };
  }
  function toApproval(a) {
    const c = a.card; TOOLS[c.tool] = TOOLS[c.tool] || { effect:c.effect };
    return { id:a.id, sortie:short(c.sortieId), action:{ tool:c.tool, args:c.args, status:"waiting" },
      ballot:{ pattern:c.pattern, effect:c.effect, executor:"—", verdicts:c.verdicts, sync:c.sync, outcome:"approval", reason:c.reason },
      reason:c.reason, created:Date.now(), expires:Date.parse(c.expires) };
  }
  // The banner names the base this page shows, and the other bases on the Kaji line with their state.
  const liveBaseName = d => d && d.base ? d.base.id + " · " + d.base.name : "this base";
  function kajiSummary() {
    const peers = (state.kajiBases || []).filter(b => !b.self && b.status === "enrolled");
    if (!peers.length) return "no other base on the Kaji line";
    return "Kaji line: " + peers.map(b => b.name + " " + (!b.online ? "offline" : b.health && b.health.state === "degraded" ? "degraded" : "online")).join(", ");
  }
  async function poll() {
    if (polling || !token) return; polling = true;
    try {
      const [latest20, cards, doctor, reminders, inbox, facts, episodes, kajiBases, pilots] = await Promise.all([api("sorties?limit=20"), api("approvals?limit=20"), api("doctor"), api("reminders"), api("inbox"), api("memory"), api("memory/episodes"), api("bases").catch(() => []), api("pilots").catch(() => null)]);
      // The newest sorties, plus older pages the owner loaded and every match of the current search, newest first.
      const byId = new Map(); for (const x of [...latest20, ...older, ...matches]) if (!byId.has(x.id)) byId.set(x.id, x);
      const list = [...byId.values()].sort((a, b) => b.created.localeCompare(a.created)); shown = list;
      applyBases(kajiBases, healthOf(doctor)); void loadModels();
      state.pilots = pilots && Array.isArray(pilots.pilots) ? pilots.pilots : null;
      state.lilith = Object.assign(state.lilith || { history:{} }, { facts, episodes });
      // Reminders delivered (briefs live in the inbox too since F-028, and are shown on their own in Debrief).
      state.delivered = inbox.filter(d => (d.kind || "reminder") === "reminder").map(d => Date.parse(d.created));
      state.brief = inbox.find(d => d.kind === "brief") || null;
      const selected = state.sorties.find(x => x.id === state.selected);
      const want = list.filter(s => (selected && s.id === selected.realId) || s.waiting || !detailCache[s.id] || s.status === "open").slice(0, 8);
      await Promise.all(want.map(async s => { detailCache[s.id] = await api("sorties/" + s.id); }));
      // The one live "cage": the in-process executor beats when an action newly ran.
      const ran = Object.values(detailCache).flatMap(d => d.detail).filter(a => a.status === "done" || a.status === "failed").map(a => a.created).sort().pop();
      if (ran && lastRan && ran > lastRan) activeCage["EVA-02"] = Date.now() + 4000; if (ran) lastRan = ran;
      // Comms: the first refresh loads the five most recent sorties' traces (so the panel is not empty at start); later
      // ones keep the selected sortie and every running or waiting one up to date.
      const traced = new Set([...(firstTrace ? latest20.slice(0, 5) : latest20.filter(s => s.status === "open")).map(s => s.id), ...(selected ? [selected.realId] : [])]);
      const first = firstTrace; firstTrace = false;
      let added = 0; for (const id of traced) added += await loadEvents(id);
      // renderAll does not redraw Comms: redraw it when new trace lines arrived (not on every poll, so scrolling back stays put).
      // The first refresh always draws Comms, so a base with no sorties yet shows its empty state, never a blank panel.
      if (added || first) renderLog();
      state.sorties = list.map(toSortie);
      state.approvals = cards.map(toApproval).filter(ap => state.sorties.some(s => s.id === ap.sortie));
      state.reminders = reminders.filter(r => !r.delivered && !r.cancelled && Date.parse(r.due) > Date.now()).sort((a, b) => a.due.localeCompare(b.due));
      state.upcoming = state.reminders.map(r => ({ at:Date.parse(r.due), title:r.title, kind:"reminder" }));
      state.doctor = doctor; showBuild(doctor.build);
      if (!kajiBases.length && doctor.base) observeTelegram([{baseId:doctor.base.id,status:"enrolled",online:true,channel:doctor.channel,channelFresh:doctor.channelFresh}]);
      if (doctor.base && BASES[0].name !== doctor.base.name.toUpperCase()) { BASES[0].name = doctor.base.name.toUpperCase(); BASES[0].role = doctor.base.id + " · this machine"; document.getElementById("cages").innerHTML = ""; }
      // The newest sortie is selected at first; after the owner deselects one, nothing is selected again by itself.
      // Owner, 2026-11-05: by default the dashboard shows the real state. Nothing chosen: a running sortie is selected (F-019),
      // otherwise none; one it picked by itself is let go when it finishes. A sortie the owner clicked stays.
      // A request the owner just sent: its new sortie is selected as soon as it appears, whatever was selected before.
      if (followNew) { const fresh = state.sorties.find(x => !followNew.has(x.realId)); if (fresh) { state.selected = fresh.id; state.autoSelected = false; state.deselected = false; followNew = null; } }
      const running = state.sorties.find(x => x.status === "active");
      if (!state.selected && !state.deselected && running) { state.selected = running.id; state.autoSelected = true; }
      else if (state.autoSelected && state.selected && !(state.sorties.find(x => x.id === state.selected && x.status === "active"))) { state.selected = null; state.autoSelected = false; }
      renderAll();
      pollFailures = 0;
      setBanner("<b>LIVE · " + esc(liveBaseName(doctor)) + "</b> <span class='muted'>— " + esc(kajiSummary()) + " · " + latest20.length + " recent sorties · refreshed " + new Date().toTimeString().slice(0, 8) + "</span>", "live");
    } catch (e) {
      if (e.status === 401) { token = ""; forgetSession(); signIn(SESSION_ENDED); return; }
      // Keep the last successful view through one failed poll; the regular interval retries reads only.
      if (++pollFailures < 2) return;
      let statusFailure = null;
      try { await api("status"); }
      catch (statusError) {
        if (statusError.status === 401) { token = ""; forgetSession(); signIn(SESSION_ENDED); return; }
        statusFailure = statusError;
      }
      const clean = message => message.replace(/[.!\s]+$/, "");
      const detail = clean(e.message) + (statusFailure ? ". Status check: " + clean(statusFailure.message) : "");
      const heading = !statusFailure ? "REFRESH DELAYED" : statusFailure.status ? "STATUS UNAVAILABLE" : "SERVICE UNREACHABLE";
      setBanner("<b>LIVE · " + heading + "</b> <span class='muted'>— " + esc(detail) + ". Showing the last available data; retrying automatically.</span>");
    }
    finally { polling = false; }
  }
  // Comms: the selected sortie's own trace (requests, steps, ballots, decisions, replies) plus what you typed here.
  const seen = new Set();
  const phaseOf = new Map(), advisedBy = new Map(), forwardedTo = new Map(), originOf = new Map(), remoteSorties = new Map();
  const generic = () => { const r = modelsData && modelsData.models && modelsData.models.roles; return !!(r && r.consultant && r.consultant.model); };
  async function loadEvents(id) {
    let after = 0; const all = []; let added = 0;
    for (;;) { const page = await api("sorties/" + id + "/events?after=" + after); if (!page.length) break; all.push(...page); after = page[page.length - 1].sequence; if (page.length < 50) break; }
    for (const e of all) {
      const key = id + ":" + e.sequence; if (seen.has(key)) continue; seen.add(key);
      const s = { id:short(id) }; const t = Date.parse(e.created); const p = e.payload || {};
      const line = e.kind === "misato.request" ? ["Owner: " + p.text, "", "you"] : e.kind === "misato.reply" ? ["Misato: " + p.text, "ok", "misato"]
        : e.kind === "ballot" ? ["MAGI: Pattern " + p.pattern.toUpperCase() + " · " + p.outcome + " · " + p.reason, p.outcome === "grant" ? "ok" : p.outcome === "reject" ? "danger" : "warn", "magi"]
        : e.kind === "approval.requested" ? ["Approval card: " + p.reason, "warn", "penpen"]
        : e.kind.startsWith("approval.") ? ["Owner " + e.kind.slice(9) + " (" + (p.source || "") + ")", e.kind === "approval.approve" ? "ok" : "danger", "you"]
        : e.kind === "action.done" ? ["EVA-02: " + p.tool + " done", "ok", "eva-02"] : e.kind === "action.failed" ? ["EVA-02: " + p.tool + " failed · " + p.error, "danger", "eva-02"]
        : e.kind === "ballot.shadow" ? ["MAGI · " + p.seat + " (shadow, after the decision): " + p.vote + (p.reason ? " — " + p.reason : ""), p.vote === "reject" ? "warn" : "", "magi"]
        : e.kind === "kaji.forwarded" ? ["Kaji line · forwarded to " + (p.base && p.base.name || "the main base"), "", "maya"]
        : e.kind === "kaji.answered" ? ["Kaji line · answered by " + (p.base && p.base.name || "the main base") + (p.sortieId ? " (its S-" + String(p.sortieId).slice(0, 4).toUpperCase() + ")" : ""), "ok", "maya"]
        : e.kind === "kaji.result" ? ["Kaji line · " + p.text, p.outcome === "grant" ? "ok" : p.outcome === "refused" || p.outcome === "reject" ? "danger" : "", "maya"]
        : e.kind === "misato.consult" ? [(p.pilot && p.pilot.name ? "Pilot " + p.pilot.name : "Consultant") + (p.model ? " (" + p.model + ")" : "") + ": " + p.advice, "", "maya"]
        : e.kind === "misato.resumed" ? ["Misato: resuming after your decision", "", "misato"] : e.kind === "sortie.done" || e.kind === "sortie.failed" ? ["Debrief: " + e.kind.slice(7), e.kind === "sortie.done" ? "ok" : "danger", "misato"] : null;
      if (e.kind === "misato.reply") known.set(id, p.text);
      if (e.kind === "kaji.forwarded") forwardedTo.set(id, p.base && p.base.name || "the main base");
      if (e.kind === "kaji.answered" && p.sortieId) remoteSorties.set(id, String(p.sortieId));
      // The main base dropped out and this base answered in the same sortie: local work means it is not shown as forwarded.
      if (e.kind === "misato.consult" || e.kind === "ballot" || e.kind === "misato.step") { forwardedTo.delete(id); remoteSorties.delete(id); }
      if (e.kind === "misato.request" && /^kaji:/.test(p.conversation || "")) originOf.set(id, baseName(String(p.conversation).slice(5).split("-").slice(0, 2).join("-")));
      if (e.kind === "misato.consult") { consulted.add(id); advisedBy.set(id, (p.pilot && p.pilot.name ? p.pilot.name : "Generic pilot") + (p.model ? " · " + p.model : "")); }
      // F-051: the step a running sortie is on, from its latest event (not always MAGI).
      const step = { "misato.request":generic() ? "consult" : "plan", "misato.consult":"plan", "misato.resumed":"plan", "action.done":"plan", "action.failed":"plan", "approval.requested":"apt", "approval.approve":"plug", "misato.reply":"debrief" }[e.kind] || (e.kind === "ballot" ? (p.outcome === "grant" ? "plug" : p.outcome === "approval" ? "apt" : "plan") : null);
      if (step) phaseOf.set(id, step);
      if (line) { state.log.push({ t, msg:line[0], cls:line[1], s:s.id, who:line[2], chat:e.kind.startsWith("misato.") }); added++; }
    }
    state.log.sort((a, b) => a.t - b.t); if (state.log.length > 300) state.log.splice(0, state.log.length - 300);
    return added;
  }

  // Longer history: older pages, 50 at a time, kept until the page reloads.
  window.liveOlder = async function () {
    const oldest = shown[shown.length - 1]; if (!oldest || state.loadingOlder) return;
    state.loadingOlder = true; renderSorties();
    try { const page = await api("sorties?limit=50&before=" + encodeURIComponent(oldest.created)); older.push(...page); if (page.length < 50) state.noOlder = true; }
    catch (e) { log("Could not load older sorties: " + e.message, "danger", null, "maya"); }
    finally { state.loadingOlder = false; poll(); }
  };
  // Search: the box filters what is loaded at once; the service then finds matching titles in all history.
  window.liveSearch = function (q) {
    clearTimeout(searchTimer); const seq = ++searchSeq;
    if (!q) { matches = []; poll(); return; }
    searchTimer = setTimeout(async () => {
      try { const found = await api("sorties?limit=50&q=" + encodeURIComponent(q.slice(0, 200))); if (seq === searchSeq) { matches = found; poll(); } }
      catch (e) { log("Search failed: " + e.message, "danger", null, "maya"); }
    }, 250);
  };
  // Coming up: pending reminders, each with Edit (title and time, inline) and Cancel reminder.
  const pad = n => String(n).padStart(2, "0");
  const localInput = iso => { const d = new Date(iso); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()); };
  const when = t => { const d = new Date(t); const today = new Date().toDateString() === d.toDateString(); return (today ? "" : d.toLocaleDateString(undefined, { weekday:"short", day:"numeric", month:"short" }) + " ") + pad(d.getHours()) + ":" + pad(d.getMinutes()); };
  const until = t => { const m = Math.max(0, Math.round((t - Date.now()) / 60000)); return m < 60 ? "in " + m + " min" : m < 48 * 60 ? "in " + Math.round(m / 60) + " h" : "in " + Math.round(m / 1440) + " days"; };
  window.renderNext = function () {
    const box = document.getElementById("next-list"); const list = state.reminders || [];
    document.getElementById("next-sub").textContent = list.length + " reminder" + (list.length === 1 ? "" : "s");
    // While a reminder is being edited the list stays as it is, so a refresh never wipes what you are typing.
    if (editing && list.some(r => r.id === editing) && box.querySelector("[data-rem-form]")) return;
    if (!list.some(r => r.id === editing)) editing = null;
    if (!list.length) { box.innerHTML = "<div class='muted small'>No reminders. Ask Misato “remind me tomorrow at 9 to call Ada” below, or on Telegram; it appears here, where you can edit or cancel it.</div>"; return; }
    box.innerHTML = list.map(r => editing === r.id
      ? "<form class='rem-edit' data-rem-form='" + r.id + "'><label class='sr-only' for='rem-t-" + r.id + "'>Reminder</label><input type='text' id='rem-t-" + r.id + "' maxlength='500' required value='" + esc(r.title) + "'/>" +
        "<label class='sr-only' for='rem-d-" + r.id + "'>When</label><input type='datetime-local' id='rem-d-" + r.id + "' required value='" + localInput(r.due) + "'/>" +
        "<button class='btn sm primary' type='submit'>Save</button><button class='btn sm' type='button' data-rem-keep>Keep as is</button></form>"
      : "<div class='rem'><span class='small'><b>" + when(r.due) + "</b> " + esc(r.title) + "</span><span class='acts'><button class='btn sm' data-rem-edit='" + r.id + "' aria-label='Edit reminder: " + esc(r.title) + "'>Edit</button>" +
        "<button class='btn sm danger' data-rem-cancel='" + r.id + "' aria-label='Cancel reminder: " + esc(r.title) + "'>Cancel</button></span><span class='tiny muted'>" + until(Date.parse(r.due)) + "</span></div>").join("");
    const input = editing && document.getElementById("rem-t-" + editing); if (input) input.focus();
  };
  const reminderAction = async (path, init, done) => { try { await api(path, init); log(done, "ok", null, "penpen"); } catch (e) { log("Reminder: " + e.message, "danger", null, "penpen"); } poll(); };
  document.addEventListener("click", e => {
    const t = e.target.closest("[data-rem-edit],[data-rem-cancel],[data-rem-keep]"); if (!t) return; e.preventDefault();
    if (t.dataset.remEdit) { editing = t.dataset.remEdit; renderNext(); return; }
    if (t.hasAttribute("data-rem-keep")) { const id = editing; editing = null; renderNext(); const b = document.querySelector("[data-rem-edit='" + id + "']"); if (b) b.focus(); return; }
    const r = (state.reminders || []).find(x => x.id === t.dataset.remCancel);
    if (r && confirm("Cancel the reminder “" + r.title + "” at " + when(r.due) + "?")) reminderAction("reminders/" + r.id, { method:"DELETE" }, "Reminder cancelled: " + r.title);
  });
  document.addEventListener("submit", e => {
    const form = e.target.closest("[data-rem-form]"); if (!form) return; e.preventDefault();
    const id = form.dataset.remForm; const r = (state.reminders || []).find(x => x.id === id); if (!r) { editing = null; renderNext(); return; }
    const title = document.getElementById("rem-t-" + id).value.trim(); const at = new Date(document.getElementById("rem-d-" + id).value);
    if (!title || !Number.isFinite(at.getTime())) { log("Reminder: give a title and a time.", "danger", null, "penpen"); return; }
    if (at.getTime() <= Date.now()) { log("Reminder: pick a time in the future.", "danger", null, "penpen"); return; }
    const patch = {}; if (title !== r.title) patch.title = title; if (at.toISOString() !== new Date(r.due).toISOString()) patch.due = at.toISOString();
    editing = null; if (!Object.keys(patch).length) { renderNext(); return; }
    reminderAction("reminders/" + id, { method:"PATCH", body:JSON.stringify(patch) }, "Reminder updated: " + title + " · " + when(at));
  });
  // Models (F-038): each role's model, picked from what Ollama has; the cloud route on or off. The key is never asked here:
  // it is typed in a terminal (models key). The list is re-read every 30 s, and never while the owner is choosing.
  let modelsData = null, modelsAt = 0, modelsBusy = false, modelsDraft = false;
  const loadModels = async (force) => { if (!force && Date.now() - modelsAt < 30000) return; modelsAt = Date.now(); try { modelsData = await api("models"); } catch (e) { modelsData = { error:e.message }; } renderModels(); renderMelons(); };
  window.renderModels = function () {
    const box = document.getElementById("models"); const sub = document.getElementById("models-sub"); const d = modelsData;
    // A choice not applied yet is kept: no refresh redraws the panel under it.
    if (modelsDraft && box.querySelector("#models-form") || box.contains(document.activeElement) && document.activeElement.tagName === "SELECT") return;
    if (!d) { box.innerHTML = "<div class='muted small'>Reading the model routes…</div>"; return; }
    if (d.error) { box.innerHTML = "<div class='small danger'>" + esc(d.error) + "</div>"; return; }
    const m = d.models || {}; const roles = m.roles || {}; const local = (d.ollama.models || []).map(x => x.name);
    const misatoRoute = roles.misato ? roles.misato.route : m.local ? "local" : m.cloud && m.cloud.enabled ? "cloud" : "";
    const misatoModel = roles.misato && roles.misato.model || (misatoRoute === "cloud" ? (m.cloud || {}).model : (m.local || {}).model) || "";
    const casperModel = m.local ? (roles.casper && roles.casper.model) || m.local.model : "";
    const cloudOn = !!(m.cloud && m.cloud.enabled); const cloudModel = (m.cloud && m.cloud.model) || "claude-opus-5-5";
    const opt = (value, label, sel, dis) => "<option value='" + esc(value) + "'" + (sel ? " selected" : "") + (dis ? " disabled" : "") + ">" + esc(label) + "</option>";
    const known = name => local.includes(name);
    const misatoOpts = (misatoRoute ? "" : opt("", "not set", true)) + local.map(n => opt("local:" + n, n + " (local)", misatoRoute === "local" && misatoModel === n)).join("") +
      (misatoRoute === "local" && misatoModel && !known(misatoModel) ? opt("local:" + misatoModel, misatoModel + " (not in Ollama)", true, true) : "") +
      opt("cloud:" + cloudModel, cloudModel + " (cloud)" + (cloudOn ? "" : d.cloudKey ? " · turn the cloud route on" : " · key missing"), misatoRoute === "cloud", !cloudOn);
    const casperOpts = (casperModel ? "" : opt("", "not set", true)) + local.map(n => opt(n, n + " (local)", casperModel === n)).join("") + (casperModel && !known(casperModel) ? opt(casperModel, casperModel + " (not in Ollama)", true, true) : "");
    sub.textContent = d.ollama.reachable ? local.length + " local model" + (local.length === 1 ? "" : "s") : "Ollama not found";
    box.innerHTML = (local.length || cloudOn ? "<form id='models-form' class='models-form'><label for='m-misato' class='small'>Misato</label><select id='m-misato'>" + misatoOpts + "</select>" +
      "<label for='m-casper' class='small'>Casper</label><select id='m-casper'" + (local.length ? "" : " disabled") + ">" + casperOpts + "</select>" +
      "<span></span><span><button class='btn sm primary' type='submit'" + (modelsBusy ? " disabled" : "") + ">" + (modelsBusy ? "Applying…" : "Apply") + "</button></span></form>" : "") +
      "<div class='tiny muted' style='margin-top:6px'>" + (d.ollama.reachable ? "Ollama at " + esc(d.ollama.url) + (local.length ? "" : ": no models yet. Pull one: <code>ollama pull gemma4:12b</code>") : esc(d.ollama.error || "Ollama not found.")) + "</div>" +
      "<div class='row tiny' style='margin-top:4px'><span class='muted'>Cloud (Claude): " + (cloudOn ? "on" : "off") + " · key " + (d.cloudKey ? "saved" : "missing: type it in a terminal with <code>nerv models key</code>") + "</span>" +
      (d.cloudKey || cloudOn ? "<button class='btn sm' id='m-cloud' data-on='" + (!cloudOn) + "'>" + (cloudOn ? "Turn off" : "Turn on") + "</button>" : "") + "</div>";
  };
  const applyModels = async (change, done) => {
    modelsBusy = true; modelsDraft = false; renderModels();
    try { const r = await api("models", { method:"PUT", body:JSON.stringify(change) }); const roles = (r.models || {}).roles || {}; log(done + " · Misato " + (roles.misato || "—") + " · Casper " + (roles.casper || "—"), "ok", null, "maya"); }
    catch (e) { log("Models: " + e.message, "danger", null, "maya"); }
    finally { modelsBusy = false; modelsDraft = false; await loadModels(true); poll(); }
  };
  document.addEventListener("submit", e => {
    if (e.target.id !== "models-form") return; e.preventDefault(); const d = modelsData; if (!d || d.error) return;
    const change = {}; const mv = document.getElementById("m-misato").value; const cv = document.getElementById("m-casper").value;
    const m = d.models || {}; const roles = m.roles || {};
    if (mv) { const [route, ...rest] = mv.split(":"); const model = rest.join(":"); const cur = roles.misato ? roles.misato.route + ":" + (roles.misato.model || "") : "";
      if (cur !== mv) change.misato = route === "cloud" ? { route:"cloud" } : { route:"local", model }; }
    if (cv && cv !== ((roles.casper && roles.casper.model) || (m.local || {}).model)) change.casper = { model:cv };
    if (!Object.keys(change).length) { modelsDraft = false; log("Models: nothing changed.", "", null, "maya"); return; }
    applyModels(change, "Models applied");
  });
  document.addEventListener("change", e => { if (e.target.closest && e.target.closest("#models-form")) modelsDraft = true; });
  document.addEventListener("click", e => { const t = e.target.closest("#m-cloud"); if (!t) return; e.preventDefault(); applyModels({ cloud:{ enabled:t.dataset.on === "true" } }, t.dataset.on === "true" ? "Cloud route on" : "Cloud route off"); });
  // Real actions instead of simulated ones.
  window.decide = async function (apId, decision) {
    try { const r = await api("approvals/" + apId, { method:"POST", body:JSON.stringify({ decision }) }); log("Owner " + decision + " · " + r.decision + (r.error ? " · " + r.error : ""), decision === "approve" ? "ok" : "danger", null, "you"); }
    catch (e) { log("Decision failed: " + e.message, "danger"); }
    poll();
  };
  window.chat = async function (text) {
    log(text, "", null, "you"); state.log[state.log.length - 1].chat = true;
    if (chatBusy) { log("Misato is still working on the previous request.", "warn", null, "misato"); return; }
    // F-051: where the request goes, said before it goes: another online main base gets it over the Kaji line.
    const main = (state.kajiBases || []).find(b => b.main && !b.self && b.online);
    const command = /^\/|^ask .*\/status[.!?]?$/i.test(text.trim());
    followNew = command ? null : new Set(state.sorties.map(x => x.realId));
    chatBusy = true; log(command ? "Checking command…" : main ? "Forwarded to " + main.name + " · Misato there is planning" : "Misato is planning", "", null, "misato");
    try { const r = await api("chat", { method:"POST", body:JSON.stringify({ message:text, conversation:"dashboard" }) });
      // Dispatched (F-036): the main base answered; its sortie and cards are there, so only the reply is shown here.
      if (r.command) { followNew = null; log(r.reply || r.error || "No command result", r.error ? "danger" : "ok", null, "maya"); }
      else if (r.base) log((r.reply || ("Could not finish: " + (r.error || "no reply"))) + " · answered by " + r.base.name + (r.waiting && r.waiting.length ? "; decide its card on Aoba or on " + r.base.name + "'s dashboard" : ""), r.reply ? "ok" : "danger", null, "misato");
      else state.selected = short(r.sortieId); }
    catch (e) { log("Misato could not answer: " + e.message, "danger", null, "misato"); }
    finally { chatBusy = false; poll(); }
  };
  window.seatMetric = function (seat, s, a) {
    // Owner, 2026-11-05: each seat's role; Casper says whether it was asked. The details are on hover (index.html).
    if (seat === "melchior") return "rules";
    if (seat === "balthasar") return "protection";
    if (!s || !a) return "intent · idle";
    return a.ballot && a.ballot.pattern ? (a.ballot.pattern !== "green" ? "intent · read by a local model" : "intent · not needed (Green)") : "intent · waiting";
  };

  // Dummy Plug (F-030): each configured model route, its state and since when; reminders never depend on it.
  const ROUTE_NAMES = { local:"S² local route", cloud:"Umbilical cloud" };
  function routeRows(d) {
    const r = d.routes || {}; return ["local", "cloud"].filter(k => r[k] && r[k].state !== "off").map(k => {
      const h = r[k]; const at = h.since ? " since " + new Date(h.since).toTimeString().slice(0, 5) : "";
      return [ROUTE_NAMES[k], h.state === "ok" ? "ok" : h.state === "down" ? "danger" : "warn", h.state === "ok" ? "reachable" + at : h.state === "down" ? "down" + at + " · " + (h.error || "unreachable") : "not checked yet"];
    });
  }
  window.renderHealth = function () {
    const d = state.doctor; if (!d) { document.getElementById("health").innerHTML = "<div class='muted small'>Waiting for doctor…</div>"; return; }
    const p = d.processes || {}; const m = d.models || {}; const roles = m.roles || {};
    const rows = [["Scheduler (nervous)", p.nervous ? "ok" : "danger", p.nervous ? "pid " + p.nervous : "not running"],
      ["Brain process", p.brainAlive === false ? "danger" : "ok", p.brain ? "pid " + p.brain + (p.brainAlive === false ? " · not alive" : " · alive") : "unknown"],
      ...routeRows(d),
      ["Misato", roles.misato && !/not set/.test(roles.misato) ? "ok" : "warn", roles.misato || "—"], ["Casper", roles.casper && /^local \(/.test(roles.casper) ? "ok" : "warn", roles.casper || "—"],
      ["Central Dogma (SQLite)", d.database && d.database.quick_check === "ok" ? "ok" : "danger", "schema " + ((d.schema || {}).user_version ?? "?") + " · " + ((d.database || {}).quick_check || "?")],
      ["Pending reminders", "ok", String(((d.pending || {}).count) ?? 0)]];
    const degraded = (d.degraded || []).length ? "<div class='small warn' style='margin-bottom:4px'>DEGRADED · Dummy Plug: reminders and rule-based actions keep running; requests that need a model fail with the reason below until it is back.</div>" : "";
    document.getElementById("health").innerHTML = degraded + rows.map(c => "<div class='row small'><span>" + c[0] + "</span><span class='" + c[1] + "'>" + (c[1] === "ok" ? "✓ " : "✗ ") + esc(c[2]) + "</span></div>").join("") +
      "<div class='row small' style='margin-top:6px'><span class='muted'>Edited config.json? Apply it without a restart.</span><button class='btn sm' id='btn-reload'>Reload models</button></div>";
  };
  // Kaji bases (F-036): every enrolled base with its real status; positions are a fixed layout around this base
  // (no real coordinates exist), redrawn when the set of bases or their status changes.
  let basesKey = "";
  /** This base's health from doctor: online (all well), standby (degraded: brain down or no model route for Misato), offline (scheduler down). */
  function healthOf(d) {
    const p = (d && d.processes) || {}; const roles = ((d && d.models) || {}).roles || {};
    if (!p.nervous) return "offline";
    return p.brainAlive === false || (d.degraded || []).length || !roles.misato || /not set|not configured/.test(roles.misato) ? "standby" : "online";
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
    state.kajiBases = list; observeTelegram(list);
    if (!list.length) { BASES[0].status = health; return; }
    pulseHeartbeats(list);
    const key = list.map(b => b.baseId + ":" + b.status + ":" + b.online + ":" + (b.health ? b.health.state : "")).join("|") + "|" + health; if (key === basesKey) return; basesKey = key;
    const self = list.find(b => b.self) || list[0]; const others = list.filter(b => b !== self);
    // Each other base gets a spot from its ID (owner, 2026-11-05: a column looked dull): scattered, but the same on every reload.
    const seed = id => { let h = 2166136261; for (const c of id) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
    const place = (b, i) => { if (b === self) return [35.236, 138.985]; const h = seed(b.baseId); const a = 2 * Math.PI * ((h % 3600) / 3600 + i / Math.max(3, others.length)); const r = 0.6 + ((h >>> 12) % 400) / 1000; return [35.236 + 0.09 * r * Math.sin(a), 138.985 + 0.2 * r * Math.cos(a)]; };
    const toBase = (b, i) => { const [lat, lon] = place(b, i); return { id:b.baseId.toLowerCase(), name:b.name.toUpperCase(), role:b.baseId + (b.self ? " · this machine" : " · " + b.address), lat, lon, main:!!b.main, self:!!b.self, status:b.status === "revoked" ? "offline" : !b.online ? "offline" : b.health && b.health.state === "degraded" ? "standby" : "online", cpu:null, ram:null, gpu:null, rtt:null, models:"—" }; };
    BASES.splice(0, BASES.length, toBase(self, 0), ...others.map((b, i) => toBase(b, i)));
    // This base's pulse and its EVA cage follow its real health; peers show what they last reported in their heartbeat.
    BASES[0].status = health;
    LINKS.length = 0; const up = list.filter(b => b.status === "enrolled");
    for (let i = 0; i < up.length; i++) for (let j = i + 1; j < up.length; j++) LINKS.push([up[i].baseId.toLowerCase(), up[j].baseId.toLowerCase()]);
    CAGES.forEach(c => { c.base = BASES[0].id; }); document.getElementById("cages").innerHTML = "";
    initMap();
  }
  const sinceText = t => { if (!t) return "never heard"; const s = Math.round((Date.now() - Date.parse(t)) / 1000); return s < 90 ? "seen " + s + " s ago" : s < 5400 ? "last seen " + Math.round(s / 60) + " min ago" : "last seen " + new Date(t).toLocaleString(); };
  // A heartbeat reports a route check, not successful delivery to a phone.
  function channelLine(b) {
    const c = b.channel;
    if (!c) return "<div class='tiny muted'>Telegram · state not reported</div>";
    const labels = { "via-main":"via main", "local-fallback":"local fallback", local:"local channel", unavailable:"unavailable · not configured", unknown:"unknown" };
    const destination = c.destination ? " · main " + baseName(c.destination) : "";
    const fresh = b.channelFresh;
    const route = fresh ? labels[c.mode] || "unknown" : "unknown · last reported " + (labels[c.mode] || "unknown");
    const d = c.lastDelivery;
    const apiState = telegramApiState(b);
    const connection = apiState === "unknown" && fresh && !c.api ? "not checked yet" : apiState;
    return "<div class='tiny muted'>Telegram · " + esc(route + destination) + "</div>" +
      "<div class='tiny muted'><span class='" + (apiState === "responding" ? "ok" : apiState === "failed" ? "warn" : "muted") + "'>● Midori API · " + esc(connection) + "</span>" + (c.api ? " · checked " + esc(new Date(c.api.at).toLocaleString()) : "") + "</div>" +
      "<div class='tiny muted'>Route checked " + esc(new Date(c.checkedAt).toLocaleString()) + (!fresh ? " · stale or offline" : "") + "</div>" +
      (c.lastReceived ? "<div class='tiny muted'>Last received " + esc(new Date(c.lastReceived).toLocaleString()) + "</div>" : "") +
      (d ? "<div class='tiny muted'>Last send " + esc(d.result === "accepted" ? "accepted" : "failed") + " via " + esc(d.route === "main" ? "main" : "local bot") + " · " + esc(new Date(d.at).toLocaleString()) + " (phone receipt unknown)</div>" : "<div class='tiny muted'>No send result reported</div>");
  }
  window.renderBases = function () {
    const list = state.kajiBases || []; const roles = ((state.doctor || {}).models || {}).roles || {};
    if (!list.length) {
      const base = (state.doctor || {}).base || { id:"NERV-01", name:"Neo Tokyo-3" };
      document.getElementById("bases-sub").textContent = BASES[0].status === "online" ? "1/1 online" : "1/1 " + (BASES[0].status === "standby" ? "degraded" : "down");
      document.getElementById("bases").innerHTML = "<div class='card'><div class='row'><span class='b'>" + esc(base.id) + " · " + esc(base.name) + "</span>" + (BASES[0].status === "standby" ? "<span class='badge b-warn'>DEGRADED</span>" : BASES[0].status === "offline" ? "<span class='badge b-danger'>DOWN</span>" : "<span class='badge b-ok'>ONLINE</span>") + "</div><div class='tiny muted'>this machine · coordinator, scheduler, brain</div><div class='tiny muted'>Misato " + esc(roles.misato || "—") + " · Casper " + esc(roles.casper || "—") + "</div>" + channelLine({online:BASES[0].status !== "offline",channel:(state.doctor || {}).channel,channelFresh:(state.doctor || {}).channelFresh}) + "</div>" +
        "<div class='muted small' style='margin-top:4px'>No Kaji line yet: enrol your bases (INSTALL, Kaji line) to see them here.</div>";
      return;
    }
    const midori = list.some(b => telegramApiState(b) === "responding") ? "API live" : list.some(b => telegramApiState(b) === "failed") ? "API failed" : "API unchecked";
    document.getElementById("bases-sub").innerHTML = list.filter(b => b.online).length + "/" + list.filter(b => b.status === "enrolled").length + " online · <span class='" + (midori === "API live" ? "ok" : midori === "API failed" ? "warn" : "muted") + "'>● Midori " + midori + "</span>";
    document.getElementById("bases").innerHTML = list.map(b => "<div class='card'><div class='row'><span class='b'>" + esc(b.baseId) + " · " + esc(b.name) + (b.main ? " <span class='badge b-info' title='Main base selected in the signed registry'>MAIN</span>" : "") + "</span><span class='badge " + (b.status === "revoked" ? "b-muted'>REVOKED" : b.self && BASES[0].status === "standby" ? "b-warn'>DEGRADED" : b.self && BASES[0].status === "offline" ? "b-danger'>DOWN" : !b.online ? "b-warn'>OFFLINE" : b.health && b.health.state === "degraded" ? "b-warn'>DEGRADED" : "b-ok'>ONLINE") + "</span></div>" +
      "<div class='tiny muted'>" + (b.self ? "this machine" : esc(b.address)) + " · key " + esc(b.fingerprint.slice(0, 9)) + " · " + (b.self ? "local" : esc(sinceText(b.lastSeen))) + "</div>" +
      (b.self ? "<div class='tiny muted'>Misato " + esc(roles.misato || "—") + " · Casper " + esc(roles.casper || "—") + "</div>" : "") +
      (!b.self && b.online && b.health && b.health.reasons.length ? b.health.reasons.map(r => "<div class='tiny warn'>▲ " + esc(r) + "</div>").join("") : "") +
      (!b.self && b.online && !b.health ? "<div class='tiny muted'>health not reported (that base runs an older version)</div>" : "") + channelLine(b) + "</div>").join("");
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
  // The sortie detail, live: who started it and its status (Misato plans; a pilot advises, with its own skills and trust stage), the plan when there
  // is one, and the Spear only while the sortie is open; no battery line while every route is local and free.
  const baseDetail = window.renderDetail;
  window.renderDetail = function (s) {
    const box = document.getElementById("detail"); const sub = document.getElementById("detail-sub");
    if (!s) { box.innerHTML = "<div class='muted'>No sortie selected. Pick one in Sorties, or ask Misato below to start one.</div>"; sub.textContent = ""; return; }
    const who = s.pilot === "misato" ? "Misato, from a chat" : "you, as a direct action";
    const status = { active:"running", waiting:"waiting for you", done:"done", failed:"failed", "stood-down":"stopped" }[s.status] || s.status;
    if (!s.actions.length) {
      const message = s.forwarded ? (s.status === "active" ? "Waiting for " : s.status === "failed" ? "No answer received from " : "Answered on ") + s.forwarded + ". No actions ran on this base."
        : s.status === "active" ? "Misato is planning. No actions yet."
        : s.status === "failed" ? "The sortie failed before any action ran."
        : s.status === "stood-down" ? "The sortie stopped before any action ran."
        : "No actions: Misato answered without using a tool.";
      box.innerHTML = (s.advisor ? "<div class='tiny muted' style='margin-bottom:4px'>Advised by " + esc(s.advisor) + " before Misato planned (advice only, no vote)</div>" : "") + "<div class='muted small'>" + esc(message) + "</div>" +
        (s.forwarded && s.remoteSortie ? "<div class='small'>Destination sortie: <code>" + esc(s.remoteSortie) + "</code><br />Open the dashboard on " + esc(s.forwarded) + " to inspect its actions.</div>" : "") +
        (s.outcome ? "<div class='small' style='margin-top:4px'>Reply: " + esc(s.outcome) + "</div>" : "");
      sub.textContent = "started by " + who + " · " + status; return;
    }
    if (s.actions.some(a => !a.ballot || !a.ballot.verdicts)) { box.innerHTML = "<div class='muted small'>Loading this sortie…</div>"; sub.textContent = "started by " + who + " · " + status; return; }
    baseDetail(s); sub.textContent = "started by " + who + " · " + status;
    box.querySelectorAll(".plan .row .tiny.muted").forEach(el => { if (/battery/.test(el.textContent)) el.remove(); });
    if (s.status !== "active" && s.status !== "waiting") box.querySelectorAll("[data-spear]").forEach(el => el.remove());
  };
  window.renderBudget = function () { document.getElementById("budget-sub").textContent = "Cost tracking planned"; document.getElementById("budget").innerHTML = PLANNED; };
  // F-051: the real pilot roster (config.json pilots), the generic pilot first; stages change with `nerv pilots set ID --stage`.
  const pilotDrafts = new Map(); const pilotBusy = new Set();
  window.renderMelons = function (force = false) {
    // undefined: the first poll has not answered yet; null: this service has no roster (older version).
    const roster = state.pilots; const box = document.getElementById("melons"); if (!force && box.contains(document.activeElement) && document.activeElement.closest(".pilot-model-form")) return; if (roster === undefined) { box.innerHTML = "<div class='muted small'>Loading pilots…</div>"; return; } if (!roster) { box.innerHTML = PLANNED; return; }
    const badge = { prototype:"b-info", test:"b-orange", production:"b-ok" }, short = { prototype:"PROTO", test:"TEST", production:"PROD" };
    // B-017: GET /api/models nests the roles under models (it said "off" with a consultant set).
    const roles = modelsData && modelsData.models && modelsData.models.roles; const generic = roles && roles.consultant && roles.consultant.model;
    const local = modelsData && modelsData.ollama ? modelsData.ollama.models.map(m => m.name) : [];
    const selector = (id, current, fallback, name = "Generic pilot") => {
      if (!modelsData) return "<div class='tiny muted'>Reading local models…</div>";
      if (modelsData.error) return "<div class='tiny danger'>" + esc(modelsData.error) + "</div>";
      const selected = pilotDrafts.has(id) ? pilotDrafts.get(id) : current || "off";
      const option = (value, label, disabled) => "<option value='" + esc(value) + "'" + (selected === value ? " selected" : "") + (disabled ? " disabled" : "") + ">" + esc(label) + "</option>";
      const options = (fallback ? option("off", "Off", false) : "") + local.map(n => option(n, n + " · local", false)).join("") +
        (current && !local.includes(current) ? option(current, current + " · unavailable locally", true) : "") + (selected !== "off" && selected !== current && !local.includes(selected) ? option(selected, selected + " · unavailable locally", true) : "");
      const busy = pilotBusy.has(id); const disabled = busy || (!fallback && !local.length);
      const unchanged = selected === (current || "off"); const unavailable = selected !== "off" && !local.includes(selected);
      return "<form class='pilot-model-form' data-pilot='" + esc(id) + "' data-current='" + esc(current || "off") + "'><label class='small' for='pilot-model-" + esc(id) + "'>Model</label><select id='pilot-model-" + esc(id) + "' aria-label='Model for " + esc(name) + "'" + (disabled ? " disabled" : "") + ">" + options + "</select><button class='btn sm' type='submit'" + (disabled || unchanged || unavailable ? " disabled" : "") + ">" + (busy ? "Applying…" : "Apply") + "</button></form>";
    };
    const card = (name, sub, right, line, control = "") => "<div class='card'><div class='row'><span class='b'>" + esc(name) + "</span>" + right + "</div><div class='row tiny muted'><span>" + esc(sub) + "</span></div>" + (line ? "<div class='tiny muted'>" + esc(line) + "</div>" : "") + control + "</div>";
    const stageOf = p => p.retired ? "retired" : p.stage; const counts = {}; roster.forEach(p => { counts[stageOf(p)] = (counts[stageOf(p)] || 0) + 1; });
    const tab = currentTab("pilots", "prototype"); const shown = roster.filter(p => stageOf(p) === tab);
    box.innerHTML = card("Generic pilot", "anything no specialist covers · " + (generic || "off"), "<span class='badge b-muted'>GENERIC</span>", "", selector("generic", generic, true)) +
      stageTabs("pilots", [["prototype","Proto"],["test","Test"],["production","Prod"],["retired","Retired"]], counts) +
      shown.map(p => card(p.name, p.domain + " · " + p.model + (p.pinned ? " · pinned" : ""), "<span class='badge " + (p.retired ? "b-muted" : badge[p.stage]) + "'>" + (p.retired ? "RETIRED" : short[p.stage]) + "</span>", "keywords: " + p.keywords.join(", "), selector(p.id, p.model, false, p.name))).join("") +
      (roster.length ? (shown.length ? "" : "<div class='muted small'>No pilot at this stage.</div>") : "<div class='muted small'>No specialists yet. Add one: nerv pilots add ID --name … --domain … --keywords … --model …, or approve a proposal from the Marduk Institute.</div>");
  };
  document.addEventListener("change", e => {
    const form = e.target.closest && e.target.closest(".pilot-model-form");
    if (form) {
      const id = form.dataset.pilot; const value = e.target.value;
      if (value === form.dataset.current) pilotDrafts.delete(id); else pilotDrafts.set(id, value);
      const option = e.target.options[e.target.selectedIndex];
      form.querySelector("button").disabled = pilotBusy.has(id) || !value || value === form.dataset.current || !!(option && option.disabled);
    }
  });
  document.addEventListener("submit", async e => {
    const form = e.target; if (!form.matches(".pilot-model-form")) return; e.preventDefault();
    const id = form.dataset.pilot; if (pilotBusy.has(id)) return; const restoreFocus = form.contains(document.activeElement);
    const value = form.querySelector("select").value; if (!value || value === form.dataset.current || form.querySelector("button").disabled) return;
    pilotBusy.add(id); renderMelons(true);
    try {
      if (id === "generic") await api("models", { method:"PUT", body:JSON.stringify({ consultant:value === "off" ? null : { model:value } }) });
      else { const result = await api("pilots/" + encodeURIComponent(id) + "/model", { method:"PATCH", body:JSON.stringify({ model:value }) }); state.pilots = result.pilots; }
      pilotDrafts.delete(id); log("Pilot model applied: " + id + " · " + value, "ok", null, "maya");
    } catch (error) { log("Pilot model: " + error.message, "danger", null, "maya"); }
    finally { pilotBusy.delete(id); await loadModels(true); renderMelons(true); if (restoreFocus) { const next = [...document.querySelectorAll(".pilot-model-form")].find(f => f.dataset.pilot === id); if (next) next.querySelector("select").focus(); } }
  });
  // While you were away: from real sorties and deliveries since your last visit, remembered in this browser only.
  const VISIT = "nerv.dashboard.lastVisit";
  try { const v = Number(localStorage.getItem(VISIT)); state.lastVisit = Number.isFinite(v) && v > 0 ? v : Date.now() - 12 * HOUR; } catch { state.lastVisit = Date.now() - 12 * HOUR; }
  window.liveSeen = function () { try { localStorage.setItem(VISIT, String(state.lastVisit)); } catch { /* private window: forget on reload */ } };
  window.renderAway = function () {
    const since = state.lastVisit; const ended = state.sorties.filter(s => s.ended && s.ended > since);
    const count = st => ended.filter(s => s.status === st).length; const delivered = (state.delivered || []).filter(t => t > since).length;
    document.getElementById("away-since").textContent = "since " + dayTime(since);
    document.getElementById("away").innerHTML = "<div class='small' style='margin-bottom:6px'>Since your last visit: <b class='ok'>" + count("done") + "</b> done, <b class='danger'>" + count("failed") + "</b> failed, <b class='warn'>" + count("stood-down") + "</b> stopped, and Pen Pen delivered <b>" + delivered + "</b> reminders.</div>" +
      ended.slice(0, 8).map(s => "<div class='row small'><span><span class='" + (s.status === "done" ? "ok" : s.status === "failed" ? "danger" : "warn") + "'>■</span> " + dayTime(s.ended) + " · " + esc(s.title) + "</span><a href='#' data-s='" + s.id + "' class='muted tiny'>open</a></div>" + (s.outcome ? "<div class='tiny muted' style='margin:0 0 4px 12px'>" + esc(s.outcome) + "</div>" : "")).join("") +
      "<button class='btn sm' id='btn-seen' style='margin-top:4px'>Mark as read</button>" +
      (state.brief ? "<details class='brief' id='brief-box' style='margin-top:6px'" + (state.briefOpen ? " open" : "") + "><summary class='small'>Hyuga's brief · " + esc(new Date(state.brief.created).toLocaleString(undefined, { weekday:"short", hour:"2-digit", minute:"2-digit" })) + "</summary><pre class='tiny' style='white-space:pre-wrap;margin:4px 0 0'>" + esc(state.brief.message) + "</pre></details>" : "");
  };
  // The panel redraws on every refresh: the brief stays open once the owner opened it.
  document.addEventListener("toggle", e => { if (e.target && e.target.id === "brief-box") state.briefOpen = e.target.open; }, true);
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
    const p = (state.doctor || {}).processes || {}; const bad = !p.nervous || p.brainAlive === false; const degraded = ((state.doctor || {}).degraded || []).length > 0;
    document.getElementById("qv-health").textContent = bad ? "issue" : degraded ? "degraded" : "OK"; document.getElementById("qd-health").textContent = bad ? "a process is down" : degraded ? "a model route is down · reminders still run" : "all checks pass";
    document.getElementById("q-health").classList.toggle("alert", bad); document.getElementById("q-health").classList.toggle("attn", !bad && degraded);
    document.getElementById("qv-budget").textContent = "—"; document.getElementById("qd-budget").textContent = "Cost tracking not connected";
  };
  state.upcoming = []; state.selected = null; renderAll();
  /* B-005: live mode suggests only what a live base answers (the simulation's status · approve AP-… commands are demo-only). */
  const LIVE_HINT = "Ask Misato: remind me to … at … · why S-1A2B? · what are my reminders?";
  let started = false; const begin = () => { if (started) return; started = true; document.getElementById("chat-in").placeholder = LIVE_HINT; poll(); setInterval(poll, 3000); };
  // F-039: the login code is swapped for a dashboard session (never the admin token), kept in this tab's sessionStorage so a
  // reload stays signed in; it ends after 12 h, when the service restarts, with `sessions revoke`, or when the tab closes.
  // A token pasted by hand is the admin token: it stays in memory only and is never stored.
  const SESSION_KEY = "nerv.dashboard.session";
  const SESSION_ENDED = "Your dashboard session ended (after 12 h, a service restart or sessions revoke).";
  function keepSession(t) { try { sessionStorage.setItem(SESSION_KEY, t); } catch { /* storage blocked: memory only */ } }
  function keptSession() { try { return sessionStorage.getItem(SESSION_KEY) || ""; } catch { return ""; } }
  function forgetSession() { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* nothing kept */ } }
  // Not signed in: a clear bar with a token field, never the simulation's invented data.
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
      .then(r => r.json().then(d => { if (!r.ok || !d.token) throw new Error(d.error || "Login failed"); token = d.token; keepSession(token); begin(); }))
      .catch(e => signIn(e.message + "."));
  } else if (keptSession()) {
    // A reload in the same tab: the dashboard session kept for this tab signs in again, until it ends.
    token = keptSession(); setBanner("<b>LIVE · SIGNING IN</b> <span class='muted'>— resuming this tab's session…</span>");
    api("status").then(begin).catch(() => { token = ""; forgetSession(); signIn(SESSION_ENDED); });
  } else signIn("This page was opened without a login code.");
  // A click on a sortie loads its trace at once instead of waiting for the next poll.
  document.addEventListener("click", e => { const t = e.target.closest("[data-s]"); if (t) setTimeout(poll, 0); });
})();
