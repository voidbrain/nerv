/* Live adapter for the dashboard (F-019). Runs only in LIVE mode (dashboard.js): swaps the login code for the token,
   which stays in this tab's memory, then reads this NERV Agency service with change notifications and recovery polling and maps its sorties, events and approvals onto
   the dashboard's panels. Panels without real data yet say so instead of showing invented numbers. */
(() => {
  if (!LIVE) return;
  const match = /^#code=([a-f0-9]{32})$/.exec(location.hash); const code = match ? match[1] : null;
  if (match) history.replaceState(null, "", location.pathname + location.search);
  // F-118-T05: a scanned pairing QR opens #pair=XXXX-XXXX&until=<ms>. The fragment never reaches the server; it is cleared
  // at once, so Add to Home Screen saves the clean address and the installed app keeps no code. A tab only shows it.
  const pairFragment = /^#pair=([A-Z2-9]{4}-[A-Z2-9]{4})&until=(\d{1,15})$/.exec(location.hash);
  if (pairFragment) history.replaceState(null, "", location.pathname + location.search);
  // A scan while the dashboard is already open in that tab only changes the fragment: load the page again to read it.
  addEventListener("hashchange", () => { if (/^#pair=/.test(location.hash)) location.reload(); });
  // B-170: a tap on a push reaches the service from the page it opened too, because iOS may drop the worker's request,
  // its notification data or the click event itself (sw.js). This page reports ?opened=<receipt>, and, on load and
  // whenever it becomes visible, every receipt the worker kept whose notification is no longer shown: tapped, or
  // removed by the owner; one still in Notification Centre, or one the phone never listed, is never reported. No sign-in needed: the receipt is the
  // credential, and a repeat keeps the first time.
  const reportOpened = receipt => fetch("/api/push/opened", { method:"POST", headers:{ "Content-Type":"application/json", "ngsw-bypass":"1" }, body:JSON.stringify({ receipt, via:"page" }) })
    .then(r => r.ok || r.status === 404, () => false);
  const openedParam = /^\?opened=([A-Za-z0-9_-]{24})$/.exec(location.search);
  if (openedParam) { history.replaceState(null, "", location.pathname + location.hash); void reportOpened(openedParam[1]); }
  const reportKept = async () => {
    try {
      if (!self.caches || !navigator.serviceWorker) return;
      const cache = await self.caches.open("nerv-push-pending"), kept = await cache.keys();
      if (!kept.length) return;
      const reg = await navigator.serviceWorker.getRegistration("/dashboard/");
      const shown = new Set((await reg.getNotifications()).map(n => n.tag));
      for (const entry of kept) {
        const receipt = entry.url.split("/").pop();
        // Only a receipt the worker saw listed right after showing it: an empty or tagless list on this phone never
        // counts as a tap (B-170 review).
        if (shown.has("nerv-push-" + receipt) || await (await cache.match(entry)).text() !== "listed") continue;
        if (await reportOpened(receipt)) await cache.delete(entry);
      }
    } catch { /* no worker or no notification list here: the worker's own report and the Telegram fallback remain */ }
  };
  void reportKept();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void reportKept(); });
  const consulted = new Set();
  let older = [], matches = [], shown = [], searchSeq = 0, searchTimer = null; let editing = null;
  let usageBefore = null, usageBack = [], usageBusy = false, usageNext = null, usagePage = null, usageError = false;
  let token = ""; let polling = false; let pollFailures = 0; let lastRan = null; let firstTrace = true; const detailCache = {}; const known = new Map(); let followNew = null;
  const PLANNED = "<div class='muted small'>Planned · not connected yet.</div>";
  const api = async (path, init = {}) => {
    const method = init.method || "GET";
    try {
      const res = await fetch("/api/" + path, { ...(method === "GET" ? { signal:AbortSignal.timeout(10000) } : {}), ...init, headers:{ "Content-Type":"application/json", Authorization:"Bearer " + token, "ngsw-bypass":"1" } });
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
  document.head.insertAdjacentHTML("beforeend", "<style>[data-toggle],[data-promote],[data-demote]{display:none}</style>");
  ["btn-dummy", "btn-reset", "btn-spear"].forEach(id => { const el = document.getElementById(id); if (el) el.hidden = true; });
  BASES[0] = Object.assign(BASES[0], { name:"TOKYO-3", role:"HQ · this machine", status:"online", cpu:null, ram:null, gpu:null, rtt:0, models:"—" });

  function mapStatus(s) { return s.status === "open" ? (s.waiting || s.question ? "waiting" : "active") : s.status === "done" ? "done" : s.status === "failed" ? "failed" : "stood-down"; }
  function toSortie(s) {
    const d = detailCache[s.id]; const actions = d ? d.detail.map(a => {
      TOOLS[a.tool] = TOOLS[a.tool] || { effect:a.ballot.effect };
      return { tool:a.tool, args:a.args, status:a.status, ballot:a.ballot, rejects:0, ...(a.durationMs != null ? { durationMs:a.durationMs } : {}), ...(a.evaInstance ? { evaInstance:a.evaInstance } : {}) };
    }) : s.patterns.map(p => ({ tool:"", args:{}, status:"proposed", ballot:{ pattern:p } }));
    const status = mapStatus(s);
    // One pass through the flow is one action: after the plan, only the latest action counts, so a step an earlier
    // action passed but this one bypassed is not shown as passed.
    const latest = actions[actions.length - 1]; const latestIs = (...st) => !!latest && st.includes(latest.status);
    // The consultant's advice is a passed step when it was given (owner, 2026-11-05: ADVISE stayed unlit after it advised).
    const done = { detect:true, intake:true, route:true, consult:consulted.has(s.id), plan:actions.length > 0 || !!s.question || known.has(s.id), magi:!!latest, sync:!!latest,
      apt:!!latest && !!latest.ballot && latest.ballot.outcome === "approval", plug:latestIs("done", "failed", "proposed"), eva:latestIs("done", "failed"), debrief:status !== "active" && status !== "waiting" };
    const phase = status === "waiting" ? "apt" : status === "active" ? (phaseOf.get(s.id) || "plan") : "debrief";
    const last = actions[actions.length - 1];
    const nt = Object.assign({}, (typeof nodeTimings !== "undefined" && nodeTimings.get(s.id)) || {});
    if (d && Array.isArray(d.timings)) {
      for (const t of d.timings) {
        if (t.role === "consultant" && nt.consult == null) nt.consult = t.durationMs;
        else if (t.role === "misato" && nt.plan == null) nt.plan = t.durationMs;
        else if (t.role === "casper" && nt.magi == null) nt.magi = t.durationMs;
        else if (t.role === "executor" && nt.eva == null) nt.eva = t.durationMs;
        else if (t.role === "kaji" && nt.detect == null) nt.detect = t.durationMs;
      }
    }
    return { id:short(s.id), realId:s.id, title:s.title, preset:null, pilot:s.source === "misato" ? "misato" : "owner", source:"aoba", proactive:false, consult:consulted.has(s.id), advisor:advisedBy.get(s.id) || null, forwarded:forwardedTo.get(s.id) || null, forwardedBaseId:(forwardedTo.baseIds && forwardedTo.baseIds.get(s.id)) || null, origin:originOf.get(s.id) || null, remoteSortie:remoteSorties.get(s.id) || null, // F-025: lit when a consultant advised Misato (its advice is in Comms)
      timings:d && Array.isArray(d.timings) ? d.timings : null, nodeTimings:nt, phaseStartedAt:(typeof phaseStarted !== "undefined" && phaseStarted.get(s.id)) || Date.parse(s.created),
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
    const historySince = state.lastVisit;
    try {
      const [latest20, cards, doctor, history, facts, episodes, kajiBases, pilots, update, queueData, updatePolicy, evaData, healthMetrics, scheduleSettings, updaterStatus] = await Promise.all([api("sorties?limit=20"), api("approvals?limit=20"), api("doctor"), api("dashboard/history?since=" + encodeURIComponent(new Date(historySince).toISOString())), api("memory"), api("memory/episodes"), api("bases").catch(() => []), api("pilots").catch(() => null), api("update").catch(() => null), api("queue").catch(() => null), api("update/policy").catch(() => null), api("eva/instances").catch(() => null), api("health/metrics").catch(() => null), api("settings/schedule").catch(() => null), api("update/status").catch(() => null)]);
      state.evaMachines = evaData && Array.isArray(evaData.machines) ? evaData.machines : null;
      state.healthMetrics = healthMetrics || null;
      state.scheduleSettings = scheduleSettings || null;
      state.update = update || doctor.update || null;
      state.updatePolicy = updatePolicy || null;
      state.updaterStatus = (updaterStatus && updaterStatus.updater) || null;
      // B-123: an update running when the page (re)opens keeps the button busy and is followed to its outcome.
      if (state.updaterStatus && state.updaterStatus.state === "running" && !state.manualUpdateBusy) { state.manualUpdateBusy = true; void awaitRestart(state.updaterStatus.revision); }
      await loadUsage();
      // The newest sorties, plus older pages the owner loaded and every match of the current search, newest first.
      const byId = new Map(); for (const x of [...latest20, ...older, ...matches]) if (!byId.has(x.id)) byId.set(x.id, x);
      const list = [...byId.values()].sort((a, b) => b.created.localeCompare(a.created)); shown = list;
      applyBases(kajiBases, healthOf(doctor)); void loadModels(); void loadTools(); void loadSkills();
      state.pilots = pilots && Array.isArray(pilots.pilots) ? pilots.pilots : null;
      state.lilith = Object.assign(state.lilith || { history:{} }, { facts, episodes });
      // Reminders delivered (briefs live in the inbox too since F-028, and are shown on their own in Debrief).
      state.deliveredCount = history.delivered;state.deliveredSince = historySince;state.pendingCount = history.pending;
      // B-149 review: an open box belongs to the brief the owner opened; a newer brief arrives closed and unread.
      if ((state.brief && state.brief.id) !== (history.brief && history.brief.id)) state.briefOpen = false;
      state.brief = history.brief;
      const selected = state.sorties.find(x => x.id === state.selected);
      const want = list.filter(s => (selected && s.id === selected.realId) || s.waiting || !detailCache[s.id] || s.status === "open").slice(0, 8);
      await Promise.all(want.map(async s => { detailCache[s.id] = await api("sorties/" + s.id); }));
      const ran = Object.values(detailCache).flatMap(d => d.detail).filter(a => a.status === "done" || a.status === "failed").map(a => a.created).sort().pop();
      if (ran) lastRan = ran;
      // Comms: the first refresh loads the five most recent sorties' traces (so the panel is not empty at start); later
      // ones keep the selected sortie and every running or waiting one up to date.
      const traced = new Set([...(firstTrace ? latest20.slice(0, 5) : latest20.filter(s => s.status === "open")).map(s => s.id), ...(selected ? [selected.realId] : [])]);
      const first = firstTrace; firstTrace = false;
      let added = 0; for (const id of traced) added += await loadEvents(id);
      // renderAll does not redraw Comms: redraw it when new trace lines arrived (not on every poll, so scrolling back stays put).
      // The first refresh always draws Comms, so a base with no sorties yet shows its empty state, never a blank panel.
      if (added || first) renderLog();
      const queuedSorties = (queueData && Array.isArray(queueData.queued) ? queueData.queued : []).map(q => ({
        id: "Q-" + q.id.slice(0, 4).toUpperCase(),
        realId: q.id,
        title: q.title,
        preset: null,
        pilot: "misato",
        source: q.channel || "aoba",
        proactive: false,
        consult: false,
        advisor: null,
        forwarded: null,
        origin: null,
        remoteSortie: null,
        why: "",
        created: q.enqueuedAt,
        trust: "trusted",
        battery: 0,
        spent: 0,
        started: Date.parse(q.enqueuedAt),
        ended: null,
        status: "queued",
        ahead: q.ahead,
        phase: "intake",
        done: { detect: true, intake: true },
        actions: [],
        current: 0,
        ballot: null,
        outcome: null,
        happened: [],
        note: "Queued, " + q.ahead + " ahead",
      }));
      state.sorties = [...queuedSorties, ...list.map(toSortie)];
      state.approvals = cards.map(toApproval).filter(ap => state.sorties.some(s => s.id === ap.sortie));
      state.reminders = history.reminders.filter(r => !r.delivered && !r.cancelled && Date.parse(r.due) > Date.now()).sort((a, b) => a.due.localeCompare(b.due));
      state.recent = history.recent || [];
      state.upcoming = state.reminders.map(r => ({ at:Date.parse(r.due), title:r.title, kind:"reminder", label:when(r) }));
      state.doctor = doctor; showBuild(doctor.build);
      if (!kajiBases.length && doctor.base) observeTelegram([{baseId:doctor.base.id,status:"enrolled",online:true,channel:doctor.channel,channelFresh:doctor.channelFresh}]);
      if (doctor.base && BASES[0].name !== doctor.base.name) { BASES[0].name = doctor.base.name; BASES[0].role = doctor.base.id + " · this machine"; }
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
      if (e.status === 401) { token = ""; forgetSession(); signIn(ended()); return; }
      // Keep the last successful view through one failed poll; the regular interval retries reads only.
      if (++pollFailures < 2) return;
      let statusFailure = null;
      try { await api("status"); }
      catch (statusError) {
        if (statusError.status === 401) { token = ""; forgetSession(); signIn(ended()); return; }
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
  async function loadUsage(before = usageBefore, back = usageBack) {
    if (usageBusy) return false;
    usageBusy = true;
    try { const page = await api("model-usage?limit=5" + (before == null ? "" : "&before=" + before)); usageBefore = before; usageBack = back; usagePage = page; usageNext = page.next; usageError = false; return true; }
    catch (e) { if (e.status === 401) throw e; usageError = true; return false; }
    finally { usageBusy = false; }
  }
  async function moveUsage(direction) {
    if (usageBusy) return false;
    if (direction === "older" && usageNext != null) return loadUsage(usageNext, [...usageBack, usageBefore]);
    if (direction === "newer" && usageBack.length) return loadUsage(usageBack[usageBack.length - 1], usageBack.slice(0,-1));
    return false;
  }
  document.addEventListener("click", async e => {
    const button = e.target.closest("[data-usage-page]"); if (!button || usageBusy) return;
    const direction = button.dataset.usagePage;
    try { await moveUsage(direction); }
    catch (e) { if (e.status === 401) { token = ""; forgetSession(); signIn(ended()); } return; }
    button.blur(); renderBudget(); const nextButton = document.querySelector('[data-usage-page="' + direction + '"]:not(:disabled)') || document.querySelector('[data-usage-page]:not(:disabled)'); if (nextButton) nextButton.focus();
  });
  document.addEventListener("change", async e => {
    const chk = e.target && e.target.closest && e.target.closest("input[data-checklist-toggle]");
    if (!chk) return;
    const itemId = chk.dataset.checklistToggle;
    const listId = chk.dataset.listId || "";
    const done = !!chk.checked;
    chk.disabled = true;
    try {
      const r = await api("lists/toggle", { method: "POST", body: JSON.stringify({ itemId, done }) });
      if (r && r.surface) {
        for (const entry of state.log) {
          if (entry.surface && entry.surface.props && entry.surface.props.listId === listId) {
            entry.surface = r.surface;
          }
        }
        renderLog();
      }
    } catch (err) {
      chk.checked = !done;
      log("Could not update list item: " + err.message, "danger", null, "misato");
    } finally {
      chk.disabled = false;
    }
  });
  const seen = new Set();
  const phaseOf = new Map(), phaseStarted = new Map(), nodeTimings = new Map(), advisedBy = new Map(), forwardedTo = new Map(), originOf = new Map(), remoteSorties = new Map();
  const sortieSurfaces = new Map();
  const addNodeTiming = (id, node, ms) => { if (typeof ms !== "number") return; const nt = nodeTimings.get(id) || {}; nt[node] = (nt[node] || 0) + ms; nodeTimings.set(id, nt); };
  // The EVA class that ran the action: its ballot's executor, else the recorded instance; EVA-02 only for events recorded before either was stored.
  const evaOf = (p) => String(p.executor || (p.evaInstance && p.evaInstance.evaClass) || "eva-02").toUpperCase();
  const generic = () => { const r = modelsData && modelsData.models && modelsData.models.roles; return !!(r && r.consultant && r.consultant.model); };
  async function loadEvents(id) {
    let after = 0; const all = []; let added = 0;
    for (;;) { const page = await api("sorties/" + id + "/events?after=" + after); if (!page.length) break; all.push(...page); after = page[page.length - 1].sequence; if (page.length < 50) break; }
    for (const e of all) {
      const key = id + ":" + e.sequence; if (seen.has(key)) continue; seen.add(key);
      const s = { id:short(id) }; const t = Date.parse(e.created); const p = e.payload || {};
      const line = e.kind === "misato.request" ? ["Owner: " + p.text, "", "you"] : e.kind === "misato.asked" ? ["Misato asks: " + p.text + " · waiting for your answer", "warn", "misato"] : e.kind === "misato.answered" ? ["Owner: " + p.text, "", "you"] : e.kind === "misato.unanswered" ? ["No answer within 24 hours", "warn", "misato"] : e.kind === "misato.reply" ? ["Misato: " + p.text, "ok", "misato"]
        : e.kind === "ballot" ? ["MAGI: Pattern " + p.pattern.toUpperCase() + " · " + p.outcome + " · " + p.reason, p.outcome === "grant" ? "ok" : p.outcome === "reject" ? "danger" : "warn", "magi"]
        : e.kind === "approval.requested" ? ["Approval card: " + p.reason, "warn", "penpen"]
        : e.kind.startsWith("approval.") ? ["Owner " + e.kind.slice(9) + " (" + (p.source || "") + ")", e.kind === "approval.approve" ? "ok" : "danger", "you"]
        : e.kind === "action.done" ? [evaOf(p) + ": " + p.tool + " done", "ok", evaOf(p).toLowerCase()] : e.kind === "action.failed" ? [evaOf(p) + ": " + p.tool + " failed · " + p.error, "danger", evaOf(p).toLowerCase()]
        : e.kind === "ballot.shadow" ? ["MAGI · " + p.seat + " (shadow, after the decision): " + p.vote + (p.reason ? " — " + p.reason : ""), p.vote === "reject" ? "warn" : "", "magi"]
        : e.kind === "kaji.forwarded" ? ["Kaji line · forwarded to " + (p.base && p.base.name || "the main base"), "", "maya"]
        : e.kind === "kaji.answered" ? ["Kaji line · answered by " + (p.base && p.base.name || "the main base") + (p.sortieId ? " (its S-" + String(p.sortieId).slice(0, 4).toUpperCase() + ")" : ""), "ok", "maya"]
        : e.kind === "kaji.result" ? ["Kaji line · " + p.text, p.outcome === "grant" ? "ok" : p.outcome === "refused" || p.outcome === "reject" ? "danger" : "", "maya"]
        : e.kind === "misato.consult" ? [(p.pilot && p.pilot.name ? "Pilot " + p.pilot.name : "Consultant") + (p.model ? " (" + p.model + ")" : "") + ": " + p.advice, "", "maya"]
        : e.kind === "skill.applied" ? ["Skill: " + p.title + " · " + p.id + " " + p.version + (p.tools && p.tools.length ? " · tools " + p.tools.join(", ") : ""), "", "misato"]
        : e.kind === "skill.refused" ? ["Skill " + p.title + " · " + p.id + " " + p.version + " not applied: " + p.reason, "warn", "misato"]
        : e.kind === "misato.resumed" ? ["Misato: resuming after your decision", "", "misato"] : e.kind === "sortie.done" || e.kind === "sortie.failed" ? ["Debrief: " + e.kind.slice(7), e.kind === "sortie.done" ? "ok" : "danger", "misato"] : null;
      if (e.kind === "misato.reply") known.set(id, p.text);
      if (e.kind === "kaji.forwarded") forwardedTo.set(id, p.base && p.base.name || "the main base");
      if (e.kind === "kaji.forwarded" && p.base && p.base.id) (forwardedTo.baseIds || (forwardedTo.baseIds = new Map())).set(id, String(p.base.id));
      if (e.kind === "kaji.answered") { if (p.base && p.base.id) (forwardedTo.baseIds || (forwardedTo.baseIds = new Map())).set(id, String(p.base.id)); if (p.sortieId) remoteSorties.set(id, String(p.sortieId)); }
      // The main base dropped out and this base answered in the same sortie: local work means it is not shown as forwarded.
      if (e.kind === "misato.consult" || e.kind === "ballot" || e.kind === "misato.step") { forwardedTo.delete(id); if (forwardedTo.baseIds) forwardedTo.baseIds.delete(id); remoteSorties.delete(id); }
      if (e.kind === "misato.request" && /^kaji:/.test(p.conversation || "")) originOf.set(id, baseName(String(p.conversation).slice(5).split("-").slice(0, 2).join("-")));
      const noteTiming = (node, ms) => { if (typeof addNodeTiming === "function") addNodeTiming(id, node, ms); };
      if (e.kind === "misato.consult") { consulted.add(id); advisedBy.set(id, (p.pilot && p.pilot.name ? p.pilot.name : "Generic pilot") + (p.model ? " · " + p.model : "")); noteTiming("consult", p.durationMs); }
      if (e.kind === "misato.step" && p.step && p.step.outcome === "grant" && p.step.result && p.step.result.surface && p.step.result.surface.component === "nerv-checklist-card") {
        sortieSurfaces.set(id, p.step.result.surface);
      }
      if (e.kind === "misato.step" || e.kind === "misato.reply" || e.kind === "misato.asked") noteTiming("plan", p.durationMs);
      if (e.kind === "ballot" && Array.isArray(p.verdicts)) {
        const magiMs = p.verdicts.filter(v => !v.shadow && typeof v.durationMs === "number").reduce((m, v) => Math.max(m, v.durationMs), 0);
        if (magiMs > 0 || p.verdicts.some(v => v.seat === "casper" && typeof v.durationMs === "number")) noteTiming("magi", magiMs);
      }
      if (e.kind === "action.done" || e.kind === "action.failed") noteTiming("eva", p.durationMs);
      if (e.kind === "kaji.answered" && typeof p.transferMs === "number") noteTiming("detect", p.transferMs);
      // F-051: the step a running sortie is on, from its latest event (not always MAGI).
      const step = { "misato.request":generic() ? "consult" : "plan", "misato.consult":"plan", "misato.resumed":"plan", "misato.asked":"apt", "misato.answered":"plan", "action.done":"plan", "action.failed":"plan", "approval.requested":"apt", "approval.approve":"plug", "misato.reply":"debrief" }[e.kind] || (e.kind === "ballot" ? (p.outcome === "grant" ? "plug" : p.outcome === "approval" ? "apt" : "plan") : null);
      if (step) { phaseOf.set(id, step); if (typeof phaseStarted !== "undefined") phaseStarted.set(id, t); }
      if (line) {
        const surface = e.kind === "misato.reply" ? sortieSurfaces.get(id) : undefined;
        state.log.push({ t, msg:line[0], cls:line[1], s:s.id, who:line[2], chat:e.kind.startsWith("misato."), ...(surface ? { surface } : {}) });
        added++;
      }
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
  const when = r => {
    const obj = typeof r === "object" && r && !(r instanceof Date);
    const kind = obj ? (r.kind || "at") : "at";
    const iso = obj ? (kind === "until" && r.end ? r.end : r.due) : r;
    const d = new Date(iso);
    const today = new Date().toDateString() === d.toDateString();
    const day = today ? "" : d.toLocaleDateString(undefined, { weekday:"short", day:"numeric", month:"short" }) + " ";
    const clock = dt => pad(dt.getHours()) + ":" + pad(dt.getMinutes());
    if (kind === "all-day") return day + "all day";
    if (kind === "from-to" && obj && r.end) return day + clock(d) + "–" + clock(new Date(r.end));
    if (kind === "from") return day + "from " + clock(d);
    if (kind === "until") return day + "until " + clock(d);
    return day + clock(d);
  };
  const until = t => {
    const now = new Date(), target = new Date(t); const m = Math.max(0, Math.round((t - now.getTime()) / 60000));
    if (m < 48 * 60) return m < 60 ? "in " + m + " min" : "in " + Math.round(m / 60) + " h";
    // Calendar months, clamped to their last day: January 31 → February 28 is one month.
    let months = Math.max(0, (target.getFullYear() - now.getFullYear()) * 12 + target.getMonth() - now.getMonth());
    const anchor = n => new Date(now.getFullYear(), now.getMonth() + n, Math.min(now.getDate(), new Date(now.getFullYear(), now.getMonth() + n + 1, 0).getDate()), now.getHours(), now.getMinutes());
    if (anchor(months) > target) months--;
    const at = anchor(months); const days = Math.max(0, Math.floor((Date.UTC(target.getFullYear(), target.getMonth(), target.getDate()) - Date.UTC(at.getFullYear(), at.getMonth(), at.getDate())) / 86400000));
    const years = Math.floor(months / 12); months %= 12;
    return "in " + [[years,"year"],[months,"month"],[days,"day"]].filter(([n]) => n).map(([n,word]) => n + " " + word + (n === 1 ? "" : "s")).join(" ");
  };

  window.renderNext = function () {
    // B-170: reminders delivered in the last 24 hours and not done yet, each with Done (which also stops the Telegram copy).
    const recent = state.recent || [];
    patchHTML(document.getElementById("next-done"), recent.length ? "<div class='tiny muted'>Delivered · not done yet</div>" + recent.map(r =>
      "<div class='rem' data-key='done-" + esc(r.id) + "'><span class='small'><b>" + when(r) + "</b> " + esc(r.title) + "</span><span class='acts'><button class='btn sm primary' type='button' data-rem-done='" + esc(r.id) + "' aria-label='Done: " + esc(r.title) + "'>Done</button></span></div>").join("") : "");
    const box = document.getElementById("next-list"); const list = state.reminders || [];
    document.getElementById("next-sub").textContent = "Next " + list.length + " of " + (state.pendingCount ?? list.length) + " reminders";
    // While a reminder is being edited the list stays as it is, so a refresh never wipes what you are typing.
    if (editing && list.some(r => r.id === editing) && box.querySelector("[data-rem-form]")) return;
    if (!list.some(r => r.id === editing)) editing = null;
    if (!list.length) { box.innerHTML = "<div class='muted small'>No reminders. Ask Misato “remind me tomorrow at 9 to call Ada” below, or on Telegram; it appears here, where you can edit or cancel it.</div>"; return; }
    box.innerHTML = list.map(r => editing === r.id
      ? "<form class='rem-edit' data-rem-form='" + r.id + "'><label class='sr-only' for='rem-t-" + r.id + "'>Reminder</label><input type='text' id='rem-t-" + r.id + "' maxlength='500' required value='" + esc(r.title) + "'/>" +
        "<label class='sr-only' for='rem-d-" + r.id + "'>When</label><input type='datetime-local' id='rem-d-" + r.id + "' required value='" + localInput(r.kind === "until" && r.end ? r.end : r.due) + "'/>" +
        "<button class='btn sm primary' type='submit'>Save</button><button class='btn sm' type='button' data-rem-keep>Keep as is</button></form>"
      : "<div class='rem'><span class='small'><b>" + when(r) + "</b> " + esc(r.title) + "</span><span class='acts'><button class='btn sm' data-rem-edit='" + r.id + "' aria-label='Edit reminder: " + esc(r.title) + "'>Edit</button>" +
        "<button class='btn sm danger' data-rem-cancel='" + r.id + "' aria-label='Cancel reminder: " + esc(r.title) + "'>Cancel</button></span><span class='tiny muted'>" + until(Date.parse(r.due)) + "</span></div>").join("");
    if ((state.pendingCount || 0) > list.length) box.insertAdjacentHTML("beforeend", "<p class='small'>More reminders are scheduled. <a href='/'>Browse reminder history</a> in the workspace; run nerv open to sign in there.</p>");
    const input = editing && document.getElementById("rem-t-" + editing); if (input) input.focus();
  };
  const reminderAction = async (path, init, done) => { try { await api(path, init); log(done, "ok", null, "penpen"); } catch (e) { log("Reminder: " + e.message, "danger", null, "penpen"); } poll(); };
  document.addEventListener("click", e => {
    const t = e.target.closest("[data-rem-edit],[data-rem-cancel],[data-rem-keep],[data-rem-done]"); if (!t) return; e.preventDefault();
    if (t.dataset.remDone) { const r = (state.recent || []).find(x => x.id === t.dataset.remDone); if (r) reminderAction("reminders/" + r.id + "/done", { method:"POST" }, "Reminder done: " + r.title); return; }
    if (t.dataset.remEdit) { editing = t.dataset.remEdit; renderNext(); return; }
    if (t.hasAttribute("data-rem-keep")) { const id = editing; editing = null; renderNext(); const b = document.querySelector("[data-rem-edit='" + id + "']"); if (b) b.focus(); return; }
    const r = (state.reminders || []).find(x => x.id === t.dataset.remCancel);
    if (r && confirm("Cancel the reminder “" + r.title + "” at " + when(r) + "?")) reminderAction("reminders/" + r.id, { method:"DELETE" }, "Reminder cancelled: " + r.title);
  });
  document.addEventListener("submit", e => {
    const form = e.target.closest("[data-rem-form]"); if (!form) return; e.preventDefault();
    const id = form.dataset.remForm; const r = (state.reminders || []).find(x => x.id === id); if (!r) { editing = null; renderNext(); return; }
    const title = document.getElementById("rem-t-" + id).value.trim(); const at = new Date(document.getElementById("rem-d-" + id).value);
    if (!title || !Number.isFinite(at.getTime())) { log("Reminder: give a title and a time.", "danger", null, "penpen"); return; }
    if (at.getTime() <= Date.now()) { log("Reminder: pick a time in the future.", "danger", null, "penpen"); return; }
    const refIso = r.kind === "until" && r.end ? r.end : r.due;
    const patch = {}; if (title !== r.title) patch.title = title; if (at.toISOString() !== new Date(refIso).toISOString()) patch.due = at.toISOString();
    editing = null; if (!Object.keys(patch).length) { renderNext(); return; }
    reminderAction("reminders/" + id, { method:"PATCH", body:JSON.stringify(patch) }, "Reminder updated: " + title + " · " + when(Object.assign({}, r, patch, r.kind === "until" && patch.due ? { end:patch.due } : {})));
  });
  // Models (F-038): each role's model, picked from what Ollama has; the cloud route on or off. The key is never asked here:
  // it is typed in a terminal (models key). The list is re-read every 30 s, and never while the owner is choosing.
  let modelsData = null, modelsAt = 0, modelsBusy = false, modelsDraft = false;
  /** F-021-T05: the Tools panel: granted MCP tools and suspended grants first, then NERV's own tools with versions. */
  function toolsHtml(data) {
    if (!data) return "<div class='muted small'>Reading tools…</div>";
    if (data.error) return "<div class='small danger'>" + esc(data.error) + "</div>";
    const tools = data.tools || [];
    const granted = tools.filter(t => t.grant === "granted"), own = tools.filter(t => t.grant !== "granted");
    const card = t => "<div class='card'><div class='row'><span class='b'>" + esc(t.name) + "</span><span class='tiny muted'>" + esc("granted · " + t.source + (t.eva ? " · EVA-" + t.eva : "")) + "</span></div><div class='row tiny muted'><span>" + esc(t.effect) + "</span><span>version " + esc(String(t.version).slice(0, 12)) + "</span></div></div>";
    const suspended = (data.suspended || []).map(s => "<div class='card'><div class='row'><span class='b'>" + esc(s.name) + "</span><span class='tiny warn'>suspended</span></div><div class='tiny muted'>" + esc(s.why) + "</div></div>");
    const ownList = own.length
      ? "<details><summary class='small'>NERV's own tools (" + own.length + ")</summary><ul class='tiny' style='margin:4px 0 0 16px;padding:0'>" + own.map(t => "<li><span class='b'>" + esc(t.name) + "</span> <span class='muted'>· " + esc(t.effect) + " · version " + esc(String(t.version).slice(0, 12)) + "</span></li>").join("") + "</ul></details>"
      : "";
    const none = granted.length || suspended.length ? "" : "<div class='muted small'>No MCP tools granted on this base.</div>";
    return granted.map(card).join("") + suspended.join("") + none + ownList;
  }
  // end F-021-T05 toolsHtml
  let toolsData, toolsAt = 0;
  const loadTools = async (force) => { if (!force && Date.now() - toolsAt < 60000) return; toolsAt = Date.now(); try { toolsData = await api("tools"); } catch (e) { toolsData = { error:e.message }; } const box = document.getElementById("tools-list"); if (box) box.innerHTML = toolsHtml(toolsData); };
  // F-145: the skills store, read-only; redrawn only when it changed.
  let skillsAt = 0, skillsSeen = "";
  const loadSkills = async () => { if (Date.now() - skillsAt < 60000) return; skillsAt = Date.now(); let next; try { next = (await api("skills")).skills; } catch (e) { next = { error:e.message }; } const seen = JSON.stringify(next); if (seen === skillsSeen) return; skillsSeen = seen; state.skills = next; renderSkills(); };
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
    // F-144: how long Ollama keeps the local model loaded after a call (models.local.keepAlive), or always (keep_alive -1).
    const warmNow = m.local ? (m.local.alwaysLoaded ? "always" : m.local.keepAlive || "30m") : "";
    const warmChoices = [["15m", "15 min"], ["30m", "30 min"], ["1h", "1 h"], ["2h", "2 h"], ["4h", "4 h"], ["8h", "8 h"], ["24h", "24 h"]];
    if (m.local && m.local.keepAlive && !warmChoices.some(c => c[0] === m.local.keepAlive)) warmChoices.push([m.local.keepAlive, m.local.keepAlive]);
    const warmOpts = warmChoices.map(c => opt(c[0], c[1] + " after the last reply", warmNow === c[0])).join("") + opt("always", "Always", warmNow === "always");
    sub.textContent = d.ollama.reachable ? local.length + " local model" + (local.length === 1 ? "" : "s") : "Ollama not found";
    box.innerHTML = (local.length || cloudOn ? "<form id='models-form' class='models-form'><label for='m-misato' class='small'>Misato</label><select id='m-misato'>" + misatoOpts + "</select>" +
      "<label for='m-casper' class='small'>Casper</label><select id='m-casper'" + (local.length ? "" : " disabled") + ">" + casperOpts + "</select>" +
      (m.local ? "<label for='m-warm' class='small'>Keep loaded</label><select id='m-warm'>" + warmOpts + "</select>" : "") +
      "<span></span><span><button class='btn sm primary' type='submit'" + (modelsBusy ? " disabled" : "") + ">" + (modelsBusy ? "Applying…" : "Apply") + "</button></span></form>" : "") +
      (m.local ? "<div class='tiny muted' style='margin-top:4px'>Always keeps the model in memory until Ollama stops (about 16 GB for gemma4:26b), taking it from virtual machines and image runs.</div>" : "") +
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
    const wSel = document.getElementById("m-warm"); const wv = wSel ? wSel.value : "";
    if (wv && wv !== (m.local.alwaysLoaded ? "always" : m.local.keepAlive || "30m")) change.warm = wv === "always" ? { alwaysLoaded:true } : { keepAlive:wv, alwaysLoaded:false };
    if (!Object.keys(change).length) { modelsDraft = false; log("Models: nothing changed.", "", null, "maya"); return; }
    applyModels(change, "Models applied");
  });
  document.addEventListener("change", e => { if (e.target.closest && e.target.closest("#models-form")) modelsDraft = true; });
  document.addEventListener("click", e => { const t = e.target.closest("#m-cloud"); if (!t) return; e.preventDefault(); applyModels({ cloud:{ enabled:t.dataset.on === "true" } }, t.dataset.on === "true" ? "Cloud route on" : "Cloud route off"); });
  // Real actions instead of simulated ones.
  window.decide = async function (apId, decision) {
    const payload = decision === "use-fix" ? { decision: "approve", useSuggestedFix: true } : { decision };
    const effective = decision === "use-fix" ? "approve" : decision;
    try { const r = await api("approvals/" + apId, { method:"POST", body:JSON.stringify(payload) }); log("Owner " + effective + " · " + r.decision + (r.error ? " · " + r.error : ""), effective === "approve" ? "ok" : "danger", null, "you"); }
    catch (e) { log("Decision failed: " + e.message, "danger"); }
    poll();
  };
  window.decideMany = async function (ids, decision) {
    try {
      const results = await Promise.all(ids.map(id => api("approvals/" + id, { method:"POST", body:JSON.stringify({ decision }) })));
      log("Owner " + decision + " · " + results.length + " facts", decision === "approve" ? "ok" : "danger", null, "you");
    } catch (e) { log("Decision failed: " + e.message, "danger"); }
    poll();
  };
  // B-175: the dashboard chat's conversation. "New conversation" starts a clean one: Misato no longer sees the earlier
  // messages, nor a tool result that made the old one untrusted. Kept for this tab, so a reload stays in it.
  const CONVERSATION = "nerv.dashboard.conversation";
  function newConversationId() {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return "dashboard:" + Array.from(bytes, b => b.toString(36).padStart(2, "0")).join("");
  }
  let conversation = "dashboard";
  try { const saved = sessionStorage.getItem(CONVERSATION); if (saved && /^dashboard:[a-z0-9]{1,30}$/.test(saved)) conversation = saved; } catch { /* private window: the default conversation */ }
  document.getElementById("chat-new")?.addEventListener("click", () => {
    conversation = newConversationId();
    try { sessionStorage.setItem(CONVERSATION, conversation); } catch { /* private window: kept until reload */ }
    log("New conversation: Misato no longer sees the earlier messages.", "ok", null, "maya");
    document.getElementById("chat-in")?.focus();
  });
  window.chat = async function (text) {
    log(text, "", null, "you"); state.log[state.log.length - 1].chat = true;
    // F-051: where the request goes, said before it goes: another online main base gets it over the Kaji line.
    const main = (state.kajiBases || []).find(b => b.main && !b.self && b.online);
    const command = /^\/|^ask .*\/status[.!?]?$/i.test(text.trim());
    const requestId = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : ("req-" + Date.now() + "-" + Math.random().toString(16).slice(2, 8));
    followNew = command ? null : new Set(state.sorties.map(x => x.realId));
    log(command ? "Checking command…" : main ? "Forwarded to " + main.name + " · Misato there is planning" : "Misato is planning", "", null, "misato");
    let settled = false;
    const queueTimer = command ? null : setTimeout(async () => {
      if (settled) return;
      try {
        const q = await api("queue");
        const entry = (q.queued || []).find(item => item.id === requestId);
        if (entry && entry.ahead > 0) log("Queued, " + entry.ahead + " ahead.", "warn", null, "misato");
        poll();
      } catch { /* ignore queue check errors */ }
    }, 60);
    try { const r = await api("chat", { method:"POST", body:JSON.stringify({ message:text, conversation, requestId }) });
      // Dispatched (F-036): the main base answered; its sortie and cards are there, so only the reply is shown here.
      if (r.command) { followNew = null; log(r.reply || r.error || "No command result", r.error ? "danger" : "ok", null, "maya"); }
      else if (r.base) log((r.reply || ("Could not finish: " + (r.error || "no reply"))) + " · answered by " + r.base.name + (r.waiting && r.waiting.length ? "; decide its card on Aoba or on " + r.base.name + "'s dashboard" : ""), r.reply ? "ok" : "danger", null, "misato");
      else {
        state.selected = short(r.sortieId);
        if (r.surface && r.surface.component === "nerv-checklist-card") {
          sortieSurfaces.set(r.sortieId, r.surface);
          const sid = short(r.sortieId);
          const hit = [...state.log].reverse().find(x => x.s === sid && x.who === "misato" && x.chat);
          if (hit) { hit.surface = r.surface; renderLog(); }
        }
      } }
    catch (e) { log("Misato could not answer: " + e.message, "danger", null, "misato"); }
    finally { settled = true; if (queueTimer) clearTimeout(queueTimer); poll(); }
  };
  document.addEventListener("click", async e => {
    const btn = e.target.closest && e.target.closest("[data-cancel-queue]");
    if (!btn) return;
    e.stopPropagation();
    const id = btn.dataset.cancelQueue;
    try { await api("queue/" + encodeURIComponent(id), { method:"DELETE" }); log("Queued request cancelled.", "warn", null, "misato"); }
    catch (err) { log("Cancel queued failed: " + err.message, "danger", null, "misato"); }
    poll();
  });
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
  // B-123: updater status (start)
  /** B-123: the outside updater's last run, beside Update now: in progress (its step), then its outcome until dismissed. */
  function updaterStatusHtml(s) {
    if (!s || typeof s.state !== "string") return "";
    const rev = typeof s.revision === "string" ? s.revision.slice(0, 7) : "";
    const on = rev ? " · " + rev : "";
    const title = s.state === "running" ? "Update in progress" + on + " · " + (s.step || "started")
      : s.state === "completed" ? "Update completed" + (rev ? " · now on " + rev : "")
        : s.state === "refused" ? "Update refused" + on
          : s.state === "failed" ? "Update failed" + on
            : "Update outcome uncertain" + on;
    const tone = s.state === "completed" ? "ok" : s.state === "refused" || s.state === "running" ? "warn" : "danger";
    const t = Date.parse(s.at);
    const time = Number.isFinite(t) ? new Date(t).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }) + " local" : "";
    const reasons = Array.isArray(s.reasons) ? s.reasons : [];
    const recovery = Array.isArray(s.recovery) ? s.recovery : [];
    return "<div id='update-status' class='update-status small " + tone + "'>" +
      "<div class='row'><strong>" + esc(title) + "</strong><span class='row' style='gap:6px'>" + (time ? "<span class='muted'>" + esc(time) + "</span>" : "") +
      (s.state !== "running" ? "<button class='btn sm' id='btn-dismiss-update-status' type='button'>Dismiss</button>" : "") + "</span></div>" +
      (reasons.length ? "<ul style='margin:4px 0 0 16px;padding:0'>" + reasons.map(r => "<li>" + esc(r) + "</li>").join("") + "</ul>" : "") +
      (recovery.length ? "<div class='muted' style='margin-top:4px'>Recovery:<ol style='margin:2px 0 0 16px;padding:0'>" + recovery.map(r => "<li>" + esc(r) + "</li>").join("") + "</ol></div>" : "") +
      "</div>";
  }
  // B-123: updater status (end)
  // B-129: doctor run (start)
  /** What GET /api/doctor reports as wrong, in words: processes, database integrity, revision skew, degraded reasons, fleet. */
  function doctorProblems(d) {
    const out = []; const p = d.processes;
    if (p && !p.nervous) out.push("Scheduler (nervous) is not running.");
    if (p && p.brainAlive === false) out.push("Brain process is not alive.");
    if (d.models === "brain unavailable") out.push("Brain did not answer the model check.");
    const qc = (d.database || {}).quick_check;
    if (qc !== "ok") out.push("Database integrity: " + (qc == null ? "not checked" : String(qc)));
    const skew = d.revisionSkew;
    if (skew && skew.skewed) out.push(String(skew.message || "Running service differs from the checkout."));
    (Array.isArray(d.degraded) ? d.degraded : []).forEach(r => out.push(String(r)));
    if (d.fleet && d.fleet.error) out.push("Fleet: " + d.fleet.error);
    return out;
  }
  function doctorUpdateText(u) {
    if (!u || typeof u.status !== "string") return "not checked";
    const short = rev => typeof rev === "string" && rev.length >= 7 ? rev.slice(0, 7) : "?";
    const ch = " (" + (u.channel || "main") + ")";
    if (u.status === "update-available") return "update available · " + short(u.availableRevision) + ch;
    if (u.restartRequired) return "restart required · installed " + short(u.installedRevision);
    if (u.status === "up-to-date") return "up to date · " + short(u.runningRevision) + ch;
    if (u.status === "ahead") return "ahead · " + short(u.runningRevision) + ch;
    if (u.status === "offline") return "offline · " + short(u.runningRevision);
    return u.status;
  }
  /** The block next to Run doctor: running, the service's answer, or why there is none (unreachable, 401, other). */
  function doctorRunHtml(run) {
    if (run.running) return "<div id='doctor-run' class='small muted'>Running doctor…</div>";
    const time = run.at ? new Date(run.at).toTimeString().slice(0, 8) : "";
    const head = (cls, title) => "<div id='doctor-run' class='small " + cls + "'><div class='row'><strong>" + esc(title) + "</strong><span class='muted'>" + esc(time) + "</span></div>";
    if (run.error) {
      const e = run.error;
      if (e.status === 401) return head("danger", "Doctor refused (401)") + "<div>The dashboard session ended. Run <code>nerv open dashboard</code> on the Mac to sign in again.</div></div>";
      if (e.status) return head("danger", "Doctor failed (" + e.status + ")") + "<div>" + esc(e.message) + "</div></div>";
      return head("danger", "Doctor could not reach the service") + "<div>" + esc(e.message) + "</div><div class='muted'>Is NERV running? Nothing was checked.</div></div>";
    }
    const d = run.result || {}; const problems = doctorProblems(d);
    const b = d.build || {}; const skew = d.revisionSkew || {};
    const skewText = skew.skewed ? "checkout is at " + (skew.checkoutShortCommit || "?") : skew.checkoutCommit ? "matches the checkout" : "checkout unknown";
    const db = d.database || {}; const pending = (d.pending || {}).count;
    const lines = [
      "Revision " + (b.version || "?") + " · " + (b.shortCommit || "?") + " · " + skewText,
      "Database: integrity " + (db.quick_check == null ? "not checked" : db.quick_check) + " · schema " + ((d.schema || {}).user_version ?? "?") + (pending != null ? " · " + pending + " pending reminder" + (pending === 1 ? "" : "s") : ""),
      "Update: " + doctorUpdateText(d.update),
    ];
    return head(problems.length ? "danger" : "ok", problems.length ? "Doctor · " + problems.length + " problem" + (problems.length === 1 ? "" : "s") : "Doctor · all checks pass") +
      (problems.length ? "<ul style='margin:4px 0 0 16px;padding:0'>" + problems.map(p => "<li>" + esc(p) + "</li>").join("") + "</ul>" : "") +
      lines.map(l => "<div class='muted'>" + esc(l) + "</div>").join("") + "</div>";
  }
  /** Maya's line in Comms: only a pointer to the block in Health. */
  function doctorChatLine(run) {
    if (run.error) return "Doctor: " + (run.error.status === 401 ? "refused (401)" : run.error.status ? "failed (" + run.error.status + ")" : "service unreachable") + " · details in Health.";
    const n = doctorProblems(run.result || {}).length;
    return "Doctor: " + (n ? n + " problem" + (n === 1 ? "" : "s") : "all checks pass") + " · details in Health.";
  }
  // B-129: doctor run (end)
  /** B-134: the Phone push line: subscribed devices and the last delivery result, read-only from the doctor. */
  function pushRow(p) {
    if (!p) return ["Phone push", "warn", "unknown"];
    // B-183: paired devices, as Settings lists them, then subscriptions no paired device made (they still get pushes).
    const n = p.devices || 0, u = p.unpaired || 0, last = p.last;
    const devices = n + (n === 1 ? " device" : " devices") + (u ? " · " + u + " unpaired subscription" + (u === 1 ? "" : "s") : "");
    if (!last) return ["Phone push", n || u ? "ok" : "warn", devices + " · no delivery yet"];
    const when = new Date(last.at).toLocaleString();
    return ["Phone push", last.ok ? "ok" : "danger", devices + " · " + (last.ok ? "last ok (" + last.status + ")" : "last failed (" + last.status + (last.reason ? " " + last.reason : "") + ")") + " · " + when];
  }
  // B-142: health rows (start)
  /** One Health row: a label that never wraps, then the value (marker, text, optional action); c[4] follows the row, c[5] adds attributes. */
  function healthRowHtml(c) {
    const mark = c[1] === "ok" ? "✓ " : c[1] === "muted" ? "· " : "✗ ";
    return "<div class='row small health-row'" + (c[5] || "") + "><span class='health-label'>" + esc(c[0]) + "</span><span class='row health-value'><span class='" + c[1] + "'>" + mark + esc(c[2]) + "</span>" + (c[3] || "") + "</span></div>" + (c[4] || "");
  }
  /** F-152: the diagnostics table: the service sample and one row per peer link, so they compare by column. */
  function healthDiagnosticsHtml(hm) {
    const warned = prefix => (hm && Array.isArray(hm.warnings) ? hm.warnings : []).some(w => String(w.key).startsWith(prefix));
    const mb = n => (Number(n) / 1048576).toFixed(1);
    const bytes = n => (n = Number(n) || 0) < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : mb(n) + " MB";
    const none = why => "<td><span aria-hidden='true'>—</span><span class='sr-only'>" + why + "</span></td>";
    const NA = none("not applicable");
    const td = v => "<td>" + esc(v) + "</td>";
    const status = (warn, extra) => "<td><span class='" + (warn ? "warn'>✗ warning" : "ok'>✓ ok") + "</span>" + esc(extra || "") + "</td>";
    const empty = (attr, label, text) => "<tr" + attr + "><th scope='row'>" + label + "</th><td colspan='7' class='muted'>· " + text + "</td></tr>";
    const s = hm && hm.latestSample;
    const sample = s
      ? "<tr id='health-sample-row'><th scope='row'>Service sample</th>" + status(warned("sample:"), " · " + s.pollCount + " polls") + NA + NA + td("loop " + s.eventLoopDelayMs + " ms") + NA + NA + td("RSS " + mb(s.rssBytes) + " MB · heap " + mb(s.heapUsedBytes) + " MB") + "</tr>"
      : empty(" id='health-sample-row'", "Service sample", "No health samples yet.");
    const links = hm && Array.isArray(hm.links) ? hm.links : [];
    const linkRows = links.length
      ? links.map(l => "<tr data-link-peer='" + esc(l.peerId) + "'><th scope='row'>Link · " + esc(l.peerId) + "</th>" + status(warned("link:" + l.peerId + ":")) + td(bytes(l.bytesSent)) + td(bytes(l.bytesReceived)) + (l.lastLatencyMs == null ? none("not measured yet") : td(l.lastLatencyMs + " ms")) + td(l.inFlight) + td(l.reconnects) + NA + "</tr>").join("")
      : empty(" id='health-links-empty'", "Links", "No peer link traffic recorded.");
    const head = ["Status", "Sent", "Received", "Latency", "In flight", "Reconnects", "Memory"].map(h => "<th scope='col'>" + h + "</th>").join("");
    return "<div class='diag-wrap' role='region' aria-label='Diagnostics' tabindex='0'><table class='diag'><caption>Diagnostics · service and peer links</caption>" +
      "<thead><tr><td></td>" + head + "</tr></thead><tbody>" + sample + linkRows + "</tbody></table></div>";
  }
  // B-142: health rows (end)
  window.renderHealth = function () {
    const d = state.doctor; if (!d) { document.getElementById("health").innerHTML = "<div class='muted small'>Waiting for doctor…</div>"; return; }
    const p = d.processes || {}; const m = d.models || {}; const roles = m.roles || {};
    const rows = [["Scheduler (nervous)", p.nervous ? "ok" : "danger", p.nervous ? "pid " + p.nervous : "not running"],
      ["Brain process", p.brainAlive === false ? "danger" : "ok", p.brain ? "pid " + p.brain + (p.brainAlive === false ? " · not alive" : " · alive") : "unknown"],
      ...routeRows(d),
      ["Misato", roles.misato && !/not set/.test(roles.misato) ? "ok" : "warn", roles.misato || "—"], ["Casper", roles.casper && /^local \(/.test(roles.casper) ? "ok" : "warn", roles.casper || "—"],
      ["Central Dogma (SQLite)", d.database && d.database.quick_check === "ok" ? "ok" : "danger", "schema " + ((d.schema || {}).user_version ?? "?") + " · " + ((d.database || {}).quick_check || "?")],
      ["Pending reminders", "ok", String(((d.pending || {}).count) ?? 0)],
      pushRow(d.push)];
    const u = state.update || d.update;
    if (u && typeof u.status === "string") {
      const short = rev => typeof rev === "string" && rev.length >= 7 ? rev.slice(0, 7) : "?";
      const label = u.status === "update-available"
        ? ["warn", "update available · " + short(u.availableRevision) + " (" + (u.channel || "main") + ")"]
        : u.restartRequired
          ? ["warn", "restart required · installed " + short(u.installedRevision)]
          : u.status === "up-to-date"
            ? ["ok", "up to date · " + short(u.runningRevision) + " (" + (u.channel || "main") + ")"]
            : u.status === "ahead"
              ? ["ok", "ahead · " + short(u.runningRevision) + " (" + (u.channel || "main") + ")"]
              : u.status === "offline"
                ? ["warn", "offline · " + short(u.runningRevision)]
                : ["warn", "unknown"];
      rows.push(["Update availability", label[0], label[1]]);
    }
    const degraded = degradedBanner(d.degraded);
    const mu = state.manualUpdate;
    // B-110: one Update now, beside the availability line, only when there is something to update.
    const updateActionHtml = u && u.status === "update-available"
      ? "<button class='btn sm' id='btn-apply-update' type='button'" + (state.manualUpdateBusy ? " disabled" : "") + ">" + (state.manualUpdateBusy ? "Updating…" : "Update now") + "</button>"
      : "";
    const availabilityRow = rows.find(r => r[0] === "Update availability");
    if (updateActionHtml && availabilityRow) availabilityRow[3] = updateActionHtml;
    // B-123: an answer this click got at once (a refusal before the hand-off) shows as it is; a hand-off ("started")
    // shows the outside updater's own status from the server, which outlives a restart and a reload.
    const shownStatus = mu && mu.outcome !== "started"
      ? { state:mu.outcome, revision:mu.revision, at:mu.at, reasons:mu.reasons || [], recovery:mu.recovery || [] }
      : state.updaterStatus || (mu ? { state:"running", revision:mu.revision, at:mu.at, reasons:[], recovery:[] } : null);
    const statusHtml = updaterStatusHtml(shownStatus);
    if (availabilityRow) availabilityRow[4] = statusHtml;
    const updateResultHtml = availabilityRow ? "" : statusHtml;
    // F-102-T02: the last automatic attempt; the switch, mode and hours live in the settings panel only (F-152).
    const la = state.updatePolicy && state.updatePolicy.lastAttempt;
    const policyHtml = la
      ? "<div class='small " + (la.outcome === "completed" || la.outcome === "started" ? "ok" : la.outcome === "refused" ? "warn" : "muted") + "'>Last automatic attempt: " + esc(la.outcome) + (la.revision ? " · " + esc(la.revision.slice(0, 7)) : "") + ((la.reasons || []).length ? " · " + esc(la.reasons.join("; ")) : "") + "</div>"
      : "";
    const hm = state.healthMetrics;
    const warnings = hm && Array.isArray(hm.warnings) ? hm.warnings : [];
    const warningsHtml = warnings.length
      ? "<div id='health-warnings' style='margin-top:4px'>" + warnings.map(w => "<div class='small warn' data-health-warning='" + esc(w.key) + "'>▲ " + esc(w.message) + "</div>").join("") + "</div>"
      : "";
    // B-142: Update availability (with the updater status) ends the table; F-152: the diagnostics table follows it.
    const table = rows.filter(r => r !== availabilityRow).concat(availabilityRow ? [availabilityRow] : []);
    document.getElementById("health").innerHTML = degraded + "<div class='health-table'>" + table.map(healthRowHtml).join("") + "</div>" +
      healthDiagnosticsHtml(hm) +
      warningsHtml +
      policyHtml +
      updateResultHtml;
  };
  // Kaji bases (F-036): every enrolled base with its real status; positions are a fixed layout around this base
  // (no real coordinates exist), redrawn when the set of bases or their status changes.
  let basesKey = "";
  /** B-101: a reason that means requests needing a model fail now: a model route or the brain is down. */
  function modelDown(reasons) {
    return (reasons || []).some(r => / route down since |brain process not answering/.test(String(r)));
  }
  /** B-101: the DEGRADED banner lists every reason; it says model requests fail only when a route or the brain is down. */
  function degradedBanner(reasons) {
    if (!(reasons || []).length) return "";
    return "<div class='small warn' style='margin-bottom:4px'>DEGRADED" +
      (modelDown(reasons) ? " · Dummy Plug: reminders and rule-based actions keep running; requests that need a model fail until it is back." : "") +
      "<ul style='margin:2px 0 0 16px;padding:0'>" + reasons.map(r => "<li>" + esc(r) + "</li>").join("") + "</ul></div>";
  }
  /** B-101: the overview tile's line for a degraded base: a down model, or the first reason the health card lists. */
  function degradedSummary(reasons) {
    if (modelDown(reasons)) return "a model route is down · reminders still run";
    const first = String((reasons || [])[0] || "");
    return (first.length > 60 ? first.slice(0, 59) + "…" : first) || "see the health card";
  }
  /** This base's health from doctor: online (all well), standby (brain down or no model route for Misato), offline (scheduler down). */
  function healthOf(d) {
    const p = (d && d.processes) || {}; const roles = ((d && d.models) || {}).roles || {};
    if (!p.nervous) return "offline";
    return p.brainAlive === false || modelDown(d.degraded) || !roles.misato || /not set|not configured/.test(roles.misato) ? "standby" : "online";
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
    const enrolled = list.filter(b => b.status !== "revoked");
    observeTelegram(enrolled);
    const key = list.map(b => b.baseId + ":" + b.status + ":" + b.online + ":" + (b.health ? b.health.state : "") + ":" + (Array.isArray(b.reachable) ? b.reachable.slice().sort().join(",") : "")).join("|") + "|" + health; if (key === basesKey) return; basesKey = key;
    if (!enrolled.length) { BASES.splice(1); BASES[0].status = health; LINKS.length = 0; state.meshStates = {}; initMap(); return; }
    pulseHeartbeats(enrolled);
    const self = enrolled.find(b => b.self) || enrolled[0]; const others = enrolled.filter(b => b !== self);
    // Each other base gets a spot from its ID (owner, 2026-11-05: a column looked dull): scattered, but the same on every reload.
    const seed = id => { let h = 2166136261; for (const c of id) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
    const place = (b, i) => { if (b === self) return [35.236, 138.985]; const h = seed(b.baseId); const a = 2 * Math.PI * ((h % 3600) / 3600 + i / Math.max(3, others.length)); const r = 0.6 + ((h >>> 12) % 400) / 1000; return [35.236 + 0.09 * r * Math.sin(a), 138.985 + 0.2 * r * Math.cos(a)]; };
    const toBase = (b, i) => { const [lat, lon] = place(b, i); return { id:b.baseId.toLowerCase(), name:b.name, role:b.baseId + (b.self ? " · this machine" : " · " + b.address), lat, lon, main:!!b.main, self:!!b.self, status:!b.online ? "offline" : b.health && b.health.state === "degraded" ? "standby" : "online", cpu:null, ram:null, gpu:null, rtt:null, models:"—" }; };
    BASES.splice(0, BASES.length, toBase(self, 0), ...others.map((b, i) => toBase(b, i)));
    // This base's pulse and its EVA cage follow its real health; peers show what they last reported in their heartbeat.
    BASES[0].status = health;
    LINKS.length = 0; state.meshStates = {}; const up = enrolled;
    const mainBase = up.find(b => b.main);
    if (mainBase) {
      const mainId = mainBase.baseId.toLowerCase();
      // Routes (owner, 2026-11-18): requests and Telegram go through the main base. Heartbeats run between every pair of
      // bases, so peers are also joined by a quieter mesh line; no message is routed along it.
      up.forEach(b => { const id = b.baseId.toLowerCase(); if (id !== mainId) LINKS.push([id, mainId, "route"]); });
      const peers = up.filter(b => b !== mainBase);
      for (let i = 0; i < peers.length; i++) for (let j = i + 1; j < peers.length; j++) {
        const pa = peers[i], pb = peers[j];
        const ia = pa.baseId.toLowerCase(), ib = pb.baseId.toLowerCase();
        LINKS.push([ia, ib, "mesh"]);
        const ms = !Array.isArray(pa.reachable) || !Array.isArray(pb.reachable)
          ? "unreported"
          : pa.reachable.includes(pb.baseId) && pb.reachable.includes(pa.baseId)
            ? "ok"
            : "warn";
        state.meshStates[ia + "|" + ib] = ms;
        state.meshStates[ib + "|" + ia] = ms;
      }
    } else {
      for (let i = 0; i < up.length; i++) for (let j = i + 1; j < up.length; j++) LINKS.push([up[i].baseId.toLowerCase(), up[j].baseId.toLowerCase(), "route"]);
    }
    initMap();
  }
  const sinceText = t => { if (!t) return "never heard"; const s = Math.round((Date.now() - Date.parse(t)) / 1000); return s < 90 ? "seen " + s + " s ago" : s < 5400 ? "last seen " + Math.round(s / 60) + " min ago" : "last seen " + new Date(t).toLocaleString(); };
  /** F-152: the phone push line for this base (push is local to a base): devices, the last push and its open time. */
  function pushLines(p) {
    if (!p) return "<div class='tiny muted'>Phone push · state not reported</div>";
    // B-183: paired devices, then subscriptions no paired device made, as in Health.
    const n = p.devices || 0, u = p.unpaired || 0;
    if (!n && !u) return "<div class='tiny muted'>Phone push · no device subscribed</div>";
    const last = p.last;
    const sent = !last
      ? "No push sent yet"
      : last.ok
        ? "Last push accepted · " + esc(new Date(last.at).toLocaleString())
        : "<span class='warn'>Last push failed (" + esc(last.status + (last.reason ? " " + last.reason : "")) + ")</span> · " + esc(new Date(last.at).toLocaleString());
    return "<div class='tiny muted'>Phone push · " + n + (n === 1 ? " device" : " devices") + (u ? " · " + u + " unpaired subscription" + (u === 1 ? "" : "s") : "") + "</div>" +
      "<div class='tiny muted'>" + sent + " · " + (p.lastOpened ? "opened " + esc(new Date(p.lastOpened).toLocaleString()) : "not opened yet") + "</div>";
  }
  // A heartbeat reports a route check, not successful delivery to a phone.
  function channelLine(b) {
    const push = b.self ? pushLines(b.push) : "";
    const c = b.channel;
    if (!c) return "<div class='tiny muted'>Telegram · state not reported</div>" + push;
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
      (d ? "<div class='tiny muted'>Last send " + esc(d.result === "accepted" ? "accepted" : "failed") + " via " + esc(d.route === "main" ? "main" : "local bot") + " · " + esc(new Date(d.at).toLocaleString()) + " (phone receipt unknown)</div>" : "<div class='tiny muted'>No send result reported</div>") +
      push;
  }
  window.renderBases = function () {
    const list = state.kajiBases || []; const roles = ((state.doctor || {}).models || {}).roles || {};
    const enrolled = list.filter(b => b.status !== "revoked"), revoked = list.filter(b => b.status === "revoked");
    // Revoked bases stay in the signed registry for good (a revocation must outlive the key), but the list keeps them
    // folded away (owner, 2026-11-18).
    const revokedHtml = revoked.length ? "<details class='revoked-bases'" + (state.revokedOpen ? " open" : "") + "><summary class='tiny muted' style='margin:6px 0 3px'>Revoked (" + revoked.length + ")</summary>" + revoked.map(b => "<div class='card'><div class='row'><span class='b'>" + esc(b.baseId) + " · " + esc(b.name) + "</span><span class='badge b-muted'>REVOKED</span></div><div class='tiny muted'>" + esc(b.address) + " · key " + esc(b.fingerprint.slice(0, 9)) + "</div></div>").join("") + "</details>" : "";
    if (!enrolled.length) {
      const base = (state.doctor || {}).base || { id:"NERV-01", name:"Neo Tokyo-3" };
      document.getElementById("bases-sub").textContent = BASES[0].status === "online" ? "1/1 online" : "1/1 " + (BASES[0].status === "standby" ? "degraded" : "down");
      document.getElementById("bases").innerHTML = "<div class='card'><div class='row'><span class='b'>" + esc(base.id) + " · " + esc(base.name) + "</span>" + (BASES[0].status === "standby" ? "<span class='badge b-warn'>DEGRADED</span>" : BASES[0].status === "offline" ? "<span class='badge b-danger'>DOWN</span>" : "<span class='badge b-ok'>ONLINE</span>") + "</div><div class='tiny muted'>this machine · coordinator, scheduler, brain</div><div class='tiny muted'>Misato " + esc(roles.misato || "—") + " · Casper " + esc(roles.casper || "—") + "</div>" + channelLine({self:true,push:(state.doctor || {}).push,online:BASES[0].status !== "offline",channel:(state.doctor || {}).channel,channelFresh:(state.doctor || {}).channelFresh}) + "</div>" +
        (revokedHtml || "<div class='muted small' style='margin-top:4px'>No Kaji line yet: enrol your bases (INSTALL, Kaji line) to see them here.</div>");
      return;
    }
    // The name takes its base's status colour (owner, 2026-11-18), the same reading as its badge.
    const baseTone = b => (b.self && BASES[0].status === "offline") || (!b.self && !b.online) ? "muted" : (b.self && BASES[0].status === "standby") || (!b.self && b.health && b.health.state === "degraded") ? "warn" : "ok";
    const midori = enrolled.some(b => telegramApiState(b) === "responding") ? "live" : enrolled.some(b => telegramApiState(b) === "failed") ? "failed" : "unchecked";
    document.getElementById("bases-sub").innerHTML = enrolled.filter(b => b.online).length + "/" + enrolled.length + " online · <span class='" + (midori === "live" ? "ok" : midori === "failed" ? "warn" : "muted") + "'>● Midori " + midori + "</span>";
    document.getElementById("bases").innerHTML = enrolled.map(b => "<div class='card'><div class='row'><span class='b " + baseTone(b) + "'>" + esc(b.baseId) + " · " + esc(b.name) + (b.main ? " <span class='badge b-info' title='Main base selected in the signed registry'>MAIN</span>" : "") + "</span><span class='badge " + (b.self && BASES[0].status === "standby" ? "b-warn'>DEGRADED" : b.self && BASES[0].status === "offline" ? "b-danger'>DOWN" : !b.online ? "b-warn'>OFFLINE" : b.health && b.health.state === "degraded" ? "b-warn'>DEGRADED" : "b-ok'>ONLINE") + "</span></div>" +
      "<div class='tiny muted'>" + (b.self ? "this machine" : esc(b.address)) + " · key " + esc(b.fingerprint.slice(0, 9)) + " · " + (b.self ? "local" : esc(sinceText(b.lastSeen))) + "</div>" +
      (b.self ? "<div class='tiny muted'>Misato " + esc(roles.misato || "—") + " · Casper " + esc(roles.casper || "—") + "</div>" : "") +
      (!b.self && b.online && b.health && b.health.reasons.length ? b.health.reasons.map(r => "<div class='tiny warn'>▲ " + esc(r) + "</div>").join("") : "") +
      (!b.self && b.online && !b.health ? "<div class='tiny muted'>health not reported (that base runs an older version)</div>" : "") + channelLine(b.self ? { ...b, push:(state.doctor || {}).push } : b) + "</div>").join("") + revokedHtml;
    // B-093: the list is rebuilt on every poll, so the Revoked section's open state lives in state, not in the DOM.
    const fold = document.getElementById("bases").querySelector && document.getElementById("bases").querySelector(".revoked-bases");
    if (fold) fold.addEventListener("toggle", () => { state.revokedOpen = fold.open; });
  };
  // Lilith: the owner's facts, editable here; every change is the owner's and stays in the fact's history.
  window.renderLilith = function () {
    const l = state.lilith || { facts:[], episodes:[], history:{} }; const open = state.lilithOpen; const query = (state.search || "").trim().toLowerCase(); const found = l.facts.filter(f => !query || f.text.toLowerCase().includes(query));
    // The panel redraws on every poll: keep what the owner is typing and where the focus is.
    const draftEl = document.getElementById("lilith-new"); const draft = draftEl ? draftEl.value : ""; const typing = document.activeElement === draftEl;
    document.getElementById("lilith-sub").textContent = (query ? found.length + " matching of " : "") + l.facts.length + " loaded facts";
    const facts = found.map(f => "<div class='card'><div class='row small'><span>" + highlight(f.text, state.search) + "</span><span class='tiny muted'>" + esc(f.source) + (f.tainted ? " · tainted" : "") + "</span></div>" +
      "<div class='row tiny' style='margin-top:3px'><span><button class='btn sm' data-mem-edit='" + f.id + "'>Edit</button> <button class='btn sm danger' data-mem-forget='" + f.id + "'>Forget</button> " +
      "<button class='btn sm' data-mem-share='" + f.id + "' data-shareable='" + (!f.shareable) + "' aria-pressed='" + f.shareable + "'>" + (f.shareable ? "Shareable" : "Local-only") + "</button></span>" +
      "<a href='#' class='muted' data-mem-hist='" + f.id + "'>" + (open === f.id ? "hide history" : "history") + "</a></div>" +
      (open === f.id && l.history[f.id] ? "<div class='tiny muted' style='margin-top:3px'>" + l.history[f.id].map(h => esc(h.created.slice(0, 16).replace("T", " ") + " · " + h.kind + " · " + h.source + " · " + h.text)).join("<br/>") + "</div>" : "") + "</div>").join("");
    const eps = l.episodes.filter(e => e.summary && (!query || e.summary.toLowerCase().includes(query))).slice(0, 3).map(e => "<div class='tiny muted' style='margin-top:3px'>" + esc(e.until.slice(0, 10)) + " · " + esc(e.summary) + "</div>").join("");
    document.getElementById("lilith").innerHTML = (facts || (query ? "<div class='muted small'>No loaded facts match your search.</div>" : "<div class='muted small'>No facts yet. Tell Misato something to remember, or add one here.</div>")) +
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
  // is one, and the Spear only while the sortie is open; no declared action-cost line presented as measured model spend.
  const baseDetail = window.renderDetail;
  window.renderDetail = function (s) {
    const remoteInspections = window.renderDetail._remote || (window.renderDetail._remote = new Map());
    const renderRemoteInspection = (sortie) => {
      if (!sortie.forwarded || !sortie.remoteSortie) return "";
      if (!sortie.forwardedBaseId) return "<div class='small'>Destination sortie: <code>" + esc(sortie.remoteSortie) + "</code><br />Open the dashboard on " + esc(sortie.forwarded) + " to inspect its actions.</div>";
      const key = sortie.forwardedBaseId + ":" + sortie.remoteSortie;
      const entry = remoteInspections.get(key);
      const btn = "<div class='row' style='margin-top:6px'><span class='small'>Destination sortie: <code>" + esc(sortie.remoteSortie) + "</code></span><button class='btn sm' data-inspect-remote-base='" + esc(sortie.forwardedBaseId) + "' data-inspect-remote-sortie='" + esc(sortie.remoteSortie) + "'" + (entry && entry.loading ? " disabled" : "") + ">" + (entry && entry.loading ? "Inspecting…" : entry && entry.data ? "Refresh from " + esc(sortie.forwarded) : "Inspect on " + esc(sortie.forwarded)) + "</button></div>";
      if (!entry || entry.loading) return btn;
      if (entry.error) return btn + "<div class='tiny warn' style='margin-top:4px'>" + esc(entry.error) + "</div>";
      const remote = entry.data && entry.data.sortie;
      if (!remote) return btn + "<div class='tiny muted' style='margin-top:4px'>No sortie details returned from " + esc(sortie.forwarded) + ".</div>";
      const detail = Array.isArray(remote.detail) ? remote.detail : [];
      const actions = detail.length
        ? "<ol style='padding-left:18px;margin:4px 0'>" + detail.map(a => {
            const b = a.ballot;
            const verdicts = b && Array.isArray(b.verdicts) ? "<div class='verdicts' style='margin-top:2px'>" + b.verdicts.map(v => {
              const tag = v.seat.startsWith("extra:") ? (v.shadow ? " (peer · shadow)" : " (peer · veto-only)") : (v.shadow ? " (shadow)" : "");
              return "<span class='vchip " + esc(v.vote) + (v.shadow ? " shadow" : "") + "'>" + esc(seatName(v.seat) + tag) + ": " + esc(v.reason || v.vote) + "</span>";
            }).join("") + "</div>" : "";
            return "<li style='margin-bottom:4px'><b>" + esc(a.tool) + "</b>" + (b ? " · <span class='badge b-" + esc(b.pattern) + "'>" + esc(String(b.pattern).toUpperCase()) + "</span> · " + esc(b.outcome) + " (" + esc(b.executor) + ")" : "") + verdicts + "</li>";
          }).join("") + "</ol>"
        : "<div class='tiny muted'>No tool actions ran on " + esc(sortie.forwarded) + ".</div>";
      return btn + "<div class='card' style='margin-top:6px'><div class='small'><b>" + esc((entry.data.base && entry.data.base.name) || sortie.forwarded) + "</b> · " + esc(remote.status) + (remote.why ? " · " + esc(remote.why) : "") + "</div>" + actions + "</div>";
    };
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
        renderRemoteInspection(s) +
        (s.outcome ? "<div class='small' style='margin-top:4px'>Reply: " + esc(s.outcome) + "</div>" : "");
      sub.textContent = "started by " + who + " · " + status; return;
    }
    if (s.actions.some(a => !a.ballot || !a.ballot.verdicts)) { box.innerHTML = "<div class='muted small'>Loading this sortie…</div>"; sub.textContent = "started by " + who + " · " + status; return; }
    baseDetail(s); sub.textContent = "started by " + who + " · " + status;
    box.querySelectorAll(".plan .row .tiny.muted").forEach(el => { if (/battery/.test(el.textContent)) el.remove(); });
    if (s.status !== "active" && s.status !== "waiting") box.querySelectorAll("[data-spear]").forEach(el => el.remove());
  };
  document.addEventListener("click", async e => {
    const btn = e.target.closest("[data-inspect-remote-base][data-inspect-remote-sortie]");
    if (!btn) return;
    e.preventDefault();
    const remoteInspections = window.renderDetail._remote || (window.renderDetail._remote = new Map());
    const baseId = btn.dataset.inspectRemoteBase;
    const sortieId = btn.dataset.inspectRemoteSortie;
    const key = baseId + ":" + sortieId;
    remoteInspections.set(key, { loading: true });
    const cur = state.sorties.find(x => x.id === state.selected);
    if (cur) window.renderDetail(cur);
    try {
      const data = await api("bases/" + encodeURIComponent(baseId) + "/sorties/" + encodeURIComponent(sortieId));
      remoteInspections.set(key, { data });
    } catch (err) {
      if (err && err.status === 401) { token = ""; forgetSession(); signIn(ended()); return; }
      remoteInspections.set(key, { error: "Could not inspect on destination base: " + (err && err.message ? err.message : "unavailable") });
    }
    const after = state.sorties.find(x => x.id === state.selected);
    if (after) window.renderDetail(after);
  });
  // Accounting is page-scoped: unknown calls are counted separately and currencies are never combined.
  function usageView(page) {
    const items = page && Array.isArray(page.items) ? page.items : [];
    const totals = new Map(); let unknown = 0;
    const count = n => n == null ? "unavailable" : String(n);
    const money = cost => cost && cost.status === "estimated" ? cost.price.currency + " " + cost.amount.toFixed(6) + " estimated" : "Cost unavailable";
    for (const r of items) { if (r.cost && r.cost.status === "estimated") totals.set(r.cost.price.currency, (totals.get(r.cost.price.currency) || 0) + r.cost.amount); else if (r.state !== "not-called") unknown++; }
    const summary = [...totals].map(([currency, amount]) => currency + " " + amount.toFixed(6)).join(" · ");
    const heading = !page ? "Accounting unavailable until a recorded page loads." : items.length ? (summary ? "Priced subtotal on this page: " + summary + ". " : "No priced calls on this page. ") + unknown + " call(s) with unavailable cost." : "No recorded model calls. Ask Misato to start one.";
    const rows = items.map(r => {
      const o = r.observation;
      const title = o ? o.route + " · " + (o.returnedModel || "returned model unavailable") : r.state === "not-called" ? "No provider call" : "Outcome and usage unknown";
      const requested = o ? "Requested: " + o.requestedModel + " · " + o.outcome + " · " + o.durationMs + " ms" : "";
      const tokens = o ? "Input: " + count(o.inputTokens) + " · output: " + count(o.outputTokens) + " · cache read: " + count(o.cacheReadTokens) + " · cache write: " + count(o.cacheWriteTokens) + " (provider reported)" : "Tokens unavailable";
      const price = r.cost && r.cost.status === "estimated" ? " · price as of " + r.cost.price.asOf + " · " + r.cost.price.source : "";
      return "<li style='margin-bottom:8px;overflow-wrap:anywhere'><b>" + esc(title) + "</b><div class='tiny muted'>" + esc(r.operation + " · " + new Date(r.started).toLocaleString()) + "</div><div class='small'>" + esc(requested) + "</div><div class='tiny'>" + esc(tokens) + "</div><div class='tiny'>" + esc(money(r.cost) + price) + "</div></li>";
    }).join("");
    return { summary, heading, html:"<p class='small'>" + esc(heading) + "</p><p class='tiny muted'>This page only · not an invoice. Budget limits and forecasts unavailable.</p><ul style='padding-left:18px'>" + rows + "</ul>" };
  }
  window.renderBudget = function () {
    const box = document.getElementById("budget");
    // Polling never removes the pager while it has keyboard focus.
    if (box.contains(document.activeElement)) return;
    const view = usageView(usagePage);
    document.getElementById("budget-sub").textContent = usageError ? "Accounting refresh unavailable · last loaded page" : usagePage ? "Recorded model usage · " + (usagePage.items || []).length + " calls on this page" : "Loading recorded model usage…";
    box.innerHTML = view.html + "<nav aria-label='Model usage pages'><button class='btn sm' data-usage-page='newer'" + (!usageBack.length ? " disabled" : "") + ">Newer calls</button> <button class='btn sm' data-usage-page='older'" + (usageNext == null ? " disabled" : "") + ">Older calls</button></nav>";
  };
  // F-051: the real pilot roster (config.json pilots), the generic pilot first; stages change with `nerv pilots set ID --stage`.
  const pilotDrafts = new Map(); const pilotBusy = new Set();
  window.renderMelons = function (force = false) {
    // undefined: the first poll has not answered yet; null: this service has no roster (older version).
    const roster = state.pilots; const box = document.getElementById("melons"); if (!force && box.contains(document.activeElement) && document.activeElement.closest(".pilot-model-form")) return; if (roster === undefined) { box.innerHTML = "<div class='muted small'>Loading pilots…</div>"; return; } if (!roster) { box.innerHTML = PLANNED; return; }
    const badge = { prototype:"b-info", test:"b-orange", production:"b-ok" }, short = { prototype:"PROTO", test:"TEST", production:"PROD" };
    // B-017: GET /api/models nests the roles under models (it said "off" with a consultant set).
    const roles = modelsData && modelsData.models && modelsData.models.roles; const generic = roles && roles.consultant && roles.consultant.model;
    const local = modelsData && modelsData.ollama ? modelsData.ollama.models.map(m => m.name) : [];
    const draftFor = id => {
      const d = pilotDrafts.get(id);
      if (typeof d === "string") return { model: d };
      return d && typeof d === "object" ? d : {};
    };
    const modelControl = (id, current, fallback, name = "Generic pilot", extraHeader = "", extraChanged = false, extraValid = true) => {
      if (!modelsData) return { body: "<div class='tiny muted'>Reading local models…</div>", hdr: extraHeader, attrs: "" };
      if (modelsData.error) return { body: "<div class='tiny danger'>" + esc(modelsData.error) + "</div>", hdr: extraHeader, attrs: "" };
      const d = draftFor(id);
      const selected = d.model !== undefined ? d.model : current || "off";
      const option = (value, label, disabled) => "<option value='" + esc(value) + "'" + (selected === value ? " selected" : "") + (disabled ? " disabled" : "") + ">" + esc(label) + "</option>";
      const options = (fallback ? option("off", "Off", false) : "") + local.map(n => option(n, n + " · local", false)).join("") +
        (current && !local.includes(current) ? option(current, current + " · unavailable locally", true) : "") + (selected !== "off" && selected !== current && !local.includes(selected) ? option(selected, selected + " · unavailable locally", true) : "");
      const busy = pilotBusy.has(id); const disabled = busy || (!fallback && !local.length);
      const modelChanged = selected !== (current || "off");
      const unavailable = modelChanged && selected !== "off" && !local.includes(selected);
      const canApply = !busy && extraValid && (modelChanged || extraChanged) && !unavailable && (!modelChanged || fallback || local.length > 0);
      const curName = d.savedName !== undefined ? d.savedName : name;
      const curSecond = d.savedSecond !== undefined ? d.savedSecond : "";
      return {
        hdr: extraHeader,
        attrs: "data-pilot='" + esc(id) + "' data-current='" + esc(current || "off") + "' data-current-name='" + esc(curName) + "' data-current-second='" + esc(curSecond) + "'",
        body: "<div class='pilot-field'><label class='small' for='pilot-model-" + esc(id) + "'>Model</label><select id='pilot-model-" + esc(id) + "' aria-label='Model for " + esc(name) + "'" + (disabled ? " disabled" : "") + ">" + options + "</select></div>" +
          "<div class='pilot-actions'><button class='btn sm' type='submit'" + (!canApply ? " disabled" : "") + ">" + (busy ? "Applying…" : "Apply") + "</button></div>"
      };
    };
    const specialistControl = p => {
      const d = draftFor(p.id);
      const savedName = p.name || "";
      const savedSecond = p.secondName || "";
      const nameVal = d.name !== undefined ? d.name : savedName;
      const secondVal = d.secondName !== undefined ? d.secondName : savedSecond;
      const busy = pilotBusy.has(p.id);
      const dis = busy ? " disabled" : "";
      const hdr = "<div class='pilot-hdr-inputs'><input id='pilot-name-" + esc(p.id) + "' class='pilot-name-input' type='text' maxlength='40' aria-label='Call name for " + esc(savedName) + "' value='" + esc(nameVal) + "'" + dis + "/>" +
        "<input id='pilot-second-" + esc(p.id) + "' class='pilot-second-input' type='text' maxlength='40' placeholder='Second name' aria-label='Second name for " + esc(savedName) + "' value='" + esc(secondVal) + "'" + dis + "/></div>";
      const changed = nameVal.trim() !== savedName || secondVal.trim() !== savedSecond;
      const valid = nameVal.trim().length > 0 && nameVal.trim().length <= 40 && secondVal.trim().length <= 40;
      if (d.savedName === undefined) d.savedName = savedName;
      if (d.savedSecond === undefined) d.savedSecond = savedSecond;
      return modelControl(p.id, p.model, false, savedName, hdr, changed, valid);
    };
    const card = (name, sub, right, line, ctrl) => {
      // Owner 2026-11-23: call name and second name each take their own full-width line under the badge row.
      const top = ctrl.hdr
        ? "<div class='row tiny muted' style='gap:6px'><span>" + esc(sub) + "</span>" + right + "</div>" + ctrl.hdr
        : "<div class='row'><span class='b'>" + esc(name) + "</span>" + right + "</div><div class='row tiny muted'><span>" + esc(sub) + "</span></div>";
      const inner = top + (line ? "<div class='tiny muted'>" + esc(line) + "</div>" : "") + ctrl.body;
      return ctrl.attrs ? "<div class='card'><form class='pilot-model-form' " + ctrl.attrs + ">" + inner + "</form></div>" : "<div class='card'>" + inner + "</div>";
    };
    const stageOf = p => p.retired ? "retired" : p.stage; const counts = {}; roster.forEach(p => { counts[stageOf(p)] = (counts[stageOf(p)] || 0) + 1; });
    const tab = currentTab("pilots", "prototype"); const shown = roster.filter(p => stageOf(p) === tab);
    const gridHtml = shown.length
      ? "<div class='pilot-grid'>" + shown.map(p => card(p.name, p.domain + " · " + p.model + (p.pinned ? " · pinned" : ""), "<span class='badge " + (p.retired ? "b-muted" : badge[p.stage]) + "'>" + (p.retired ? "RETIRED" : short[p.stage]) + "</span>", "keywords: " + p.keywords.join(", "), specialistControl(p))).join("") + "</div>"
      : "";
    box.innerHTML = card("Generic pilot", "anything no specialist covers · " + (generic || "off"), "<span class='badge b-muted'>GENERIC</span>", "", modelControl("generic", generic, true)) +
      stageTabs("pilots", [["prototype","Proto"],["test","Test"],["production","Prod"],["retired","Retired"]], counts) +
      gridHtml +
      (roster.length ? (shown.length ? "" : "<div class='muted small'>No pilot at this stage.</div>") : "<div class='muted small'>No specialists yet. Add one: nerv pilots add ID --name … --domain … --keywords … --model …, or approve a proposal from the Marduk Institute.</div>");
  };
  const syncPilotForm = form => {
    const id = form.dataset.pilot;
    const nameEl = form.querySelector(".pilot-name-input");
    const secondEl = form.querySelector(".pilot-second-input");
    const selectEl = form.querySelector("select");
    const prev = pilotDrafts.get(id);
    const next = typeof prev === "string" ? { model: prev } : prev && typeof prev === "object" ? { ...prev } : {};
    if (nameEl) next.name = nameEl.value;
    if (secondEl) next.secondName = secondEl.value;
    if (selectEl) next.model = selectEl.value;
    const curName = form.dataset.currentName || "";
    const curSecond = form.dataset.currentSecond || "";
    const curModel = form.dataset.current || "off";
    const nameChanged = nameEl ? nameEl.value.trim() !== curName : false;
    const secondChanged = secondEl ? secondEl.value.trim() !== curSecond : false;
    const modelChanged = selectEl ? selectEl.value !== curModel : false;
    if (!nameChanged && !secondChanged && !modelChanged) pilotDrafts.delete(id);
    else pilotDrafts.set(id, next);
    const option = selectEl && selectEl.options[selectEl.selectedIndex];
    const modelBad = modelChanged && (!selectEl.value || (option && option.disabled));
    const nameValid = !nameEl || (nameEl.value.trim().length > 0 && nameEl.value.trim().length <= 40);
    const secondValid = !secondEl || secondEl.value.trim().length <= 40;
    form.querySelector("button").disabled = pilotBusy.has(id) || !(nameChanged || secondChanged || modelChanged) || modelBad || !nameValid || !secondValid;
  };
  document.addEventListener("input", e => {
    const form = e.target.closest && e.target.closest(".pilot-model-form");
    if (form) syncPilotForm(form);
  });
  document.addEventListener("change", e => {
    const form = e.target.closest && e.target.closest(".pilot-model-form");
    if (form) syncPilotForm(form);
  });
  document.addEventListener("submit", async e => {
    const form = e.target; if (!form.matches(".pilot-model-form")) return; e.preventDefault();
    const id = form.dataset.pilot; if (pilotBusy.has(id)) return; const restoreFocus = form.contains(document.activeElement);
    const btn = form.querySelector("button"); if (!btn || btn.disabled) return;
    const selectEl = form.querySelector("select");
    const nameEl = form.querySelector(".pilot-name-input");
    const secondEl = form.querySelector(".pilot-second-input");
    const value = selectEl ? selectEl.value : "";
    pilotBusy.add(id); window.renderMelons(true);
    try {
      if (id === "generic") {
        await api("models", { method:"PUT", body:JSON.stringify({ consultant:value === "off" ? null : { model:value } }) });
        log("Pilot model applied: " + id + " · " + value, "ok", null, "maya");
      } else {
        const patch = {};
        if (nameEl && nameEl.value.trim() !== (form.dataset.currentName || "")) patch.name = nameEl.value.trim();
        if (secondEl && secondEl.value.trim() !== (form.dataset.currentSecond || "")) patch.secondName = secondEl.value.trim();
        if (selectEl && value !== (form.dataset.current || "off")) patch.model = value;
        const result = await api("pilots/" + encodeURIComponent(id), { method:"PATCH", body:JSON.stringify(patch) });
        state.pilots = result.pilots;
        log("Pilot updated: " + id, "ok", null, "maya");
      }
      pilotDrafts.delete(id);
    } catch (error) { log("Pilot update: " + error.message, "danger", null, "maya"); }
    finally { pilotBusy.delete(id); await loadModels(true); window.renderMelons(true); if (restoreFocus) { const next = [...document.querySelectorAll(".pilot-model-form")].find(f => f.dataset.pilot === id); if (next) (next.querySelector("select") || next.querySelector("input"))?.focus(); } }
  });
  // While you were away: from real sorties and deliveries since your last visit, remembered in this browser only.
  const VISIT = "nerv.dashboard.lastVisit";
  try { const v = Number(localStorage.getItem(VISIT)); state.lastVisit = Number.isFinite(v) && v > 0 ? v : Date.now() - 12 * HOUR; } catch { state.lastVisit = Date.now() - 12 * HOUR; }
  window.liveSeen = async function () {
    const since = state.lastVisit; const ids = new Set();
    try {
      if (state.deliveredSince === since) {
        let before = 0;
        while (true) {
          const page = await api("inbox/history?before=" + before + "&limit=50");
          const items = Array.isArray(page.items) ? page.items : [];
          for (const item of items) if (item.kind === "reminder" && Date.parse(item.created) > since) ids.add(item.id);
          const oldest = items.at(-1);
          if (!page.next || !oldest || Date.parse(oldest.created) <= since) break;
          before = page.next;
        }
      }
      if (state.brief && state.brief.id) ids.add(state.brief.id);
      await Promise.all([...ids].map(id => api("inbox/" + encodeURIComponent(id) + "/read", { method:"POST" })));
      state.lastVisit = Date.now(); state.deliveredSince = state.lastVisit; state.deliveredCount = 0;
      try { localStorage.setItem(VISIT, String(state.lastVisit)); } catch { /* private window: forget on reload */ }
      renderAll();
    } catch { /* leave the visit cursor unchanged so the service read can be retried */ }
  };
  window.renderAway = function () {
    const since = state.lastVisit; const ended = state.sorties.filter(s => s.ended && s.ended > since);
    const count = st => ended.filter(s => s.status === st).length; const delivered = state.deliveredSince === state.lastVisit ? state.deliveredCount || 0 : 0;
    document.getElementById("away-since").textContent = "since " + dayTime(since);
    document.getElementById("away").innerHTML = "<div class='small' style='margin-bottom:6px'>Since your last visit: <b class='ok'>" + count("done") + "</b> done, <b class='danger'>" + count("failed") + "</b> failed, <b class='warn'>" + count("stood-down") + "</b> stopped, and Pen Pen delivered <b>" + delivered + "</b> reminders.</div>" +
      ended.slice(0, 8).map(s => "<div class='row small'><span><span class='" + (s.status === "done" ? "ok" : s.status === "failed" ? "danger" : "warn") + "'>■</span> " + dayTime(s.ended) + " · " + esc(s.title) + "</span><a href='#' data-s='" + s.id + "' class='muted tiny'>open</a></div>" + (s.outcome ? "<div class='tiny muted' style='margin:0 0 4px 12px'>" + esc(s.outcome) + "</div>" : "")).join("") +
      "<button class='btn sm' id='btn-seen' style='margin-top:4px'>Mark as read</button>" +
      (state.brief ? "<details class='brief' id='brief-box' style='margin-top:6px'" + (state.briefOpen ? " open" : "") + "><summary class='small'>Hyuga's brief · " + esc(new Date(state.brief.created).toLocaleString(undefined, { weekday:"short", hour:"2-digit", minute:"2-digit" })) + "</summary><pre class='tiny' style='white-space:pre-wrap;margin:4px 0 0'>" + esc(state.brief.message) + "</pre></details>" : "");
  };
  // The panel redraws on every refresh: the brief stays open once the owner opened it.
  document.addEventListener("toggle", e => { if (e.target && e.target.id === "brief-box") { state.briefOpen = e.target.open; readBrief(); } }, true);
  // B-149: the brief the owner opened in a visible page counts as read, so its Telegram fallback is skipped (once each).
  const briefsRead = new Set();
  function readBrief() {
    const b = state.brief;
    if (!b || !b.id || b.read_at || !state.briefOpen || document.visibilityState !== "visible" || briefsRead.has(b.id)) return;
    briefsRead.add(b.id);
    api("inbox/" + encodeURIComponent(b.id) + "/read", { method:"POST" }).catch(() => briefsRead.delete(b.id));
  }
  document.addEventListener("visibilitychange", readBrief);
  const renderAwayPanel = window.renderAway;
  window.renderAway = function () { renderAwayPanel(); readBrief(); };
  // B-129: Run doctor asks the service now and keeps its answer next to the button until the next run.
  window.liveDoctor = async function () {
    const box = document.getElementById("doctor-result"); const btn = document.getElementById("btn-doctor");
    if (!box || (btn && btn.disabled)) return;
    if (btn) btn.disabled = true;
    box.hidden = false; box.innerHTML = doctorRunHtml({ running:true });
    let run;
    try { const result = await api("doctor"); run = { at:new Date().toISOString(), result }; state.doctor = result; }
    catch (e) { run = { at:new Date().toISOString(), error:{ status:e.status, message:e.message } }; }
    if (btn) btn.disabled = false;
    box.innerHTML = doctorRunHtml(run);
    log(doctorChatLine(run), run.error || doctorProblems(run.result).length ? "danger" : "ok", null, "maya");
    if (run.result) renderHealth();
  };
  // F-152: Settings, Advanced: re-reads the models part of config.json after a hand edit; the result shows by the button.
  window.liveReload = async function () {
    if (state.reloadBusy) return;
    state.reloadBusy = true; state.reloadMsg = null; renderSettings();
    try {
      const r = await api("models/reload", { method:"POST" }); const roles = (r.models || {}).roles || {};
      state.reloadMsg = { kind:"ok", text:"Model settings re-read from config.json." };
      log("Models reloaded · Misato " + (roles.misato || "—") + " · Casper " + (roles.casper || "—"), "ok", null, "maya");
    } catch (e) {
      state.reloadMsg = { kind:"danger", text:"Not re-read: " + e.message + ". The previous settings stay in use." };
      log("Reload refused: " + e.message + " (the previous settings stay in use)", "danger", null, "maya");
    } finally { state.reloadBusy = false; renderSettings(); }
    poll();
  };
  window.liveApplyUpdate = async function () {
    if (state.manualUpdateBusy) return;
    const channel = (state.update && state.update.channel) || "main";
    state.manualUpdateBusy = true;
    renderHealth();
    try {
      const result = await api("update/apply", { method:"POST", body:JSON.stringify({ channel }) });
      state.manualUpdate = Object.assign({ at:new Date().toISOString() }, result);
      const summary = "Manual update " + result.outcome + (result.revision ? " (" + result.revision.slice(0, 7) + ")" : "") +
        ((result.reasons || []).length ? ": " + result.reasons.join("; ") : "");
      log(summary, result.outcome === "completed" ? "ok" : result.outcome === "refused" ? "warn" : "danger", null, "maya");
    } catch (e) {
      state.manualUpdate = { outcome:"refused", channel, revision:null, at:new Date().toISOString(), reasons:[e.message], recovery:["Inspect /api/update and lifecycle status before retrying."] };
      log("Manual update error: " + e.message, "danger", null, "maya");
    } finally {
      // B-113: started means NERV stops, updates and restarts: keep the button busy until the new revision answers.
      if (state.manualUpdate && state.manualUpdate.outcome === "started") void awaitRestart(state.manualUpdate.revision);
      else state.manualUpdateBusy = false;
      renderHealth();
      poll();
    }
  };
  async function awaitRestart(revision) {
    // B-123: the server calls a run silent for 15 minutes uncertain; wait a little longer than that.
    const until = Date.now() + 16 * 60_000;
    while (Date.now() < until) {
      await new Promise(r => setTimeout(r, 5000));
      try {
        // B-123: the updater's own outcome ends the wait: a refusal or a failure leaves the old revision running.
        const st = await api("update/status").catch(() => null);
        const s = st && st.updater;
        if (s && s.state !== "running" && s.revision === revision) { state.updaterStatus = s; state.manualUpdate = null; state.manualUpdateBusy = false; renderHealth(); poll(); return; }
        const u = await api("update");
        // Only the new revision, actually running, ends the wait (B-113 review): "up to date" alone can be the old process.
        if (u && u.runningRevision === revision && !u.restartRequired) { state.update = u; state.manualUpdateBusy = false; renderHealth(); poll(); return; }
      } catch { /* restarting: not answering yet */ }
    }
    state.manualUpdateBusy = false;
    if (!state.updaterStatus) state.manualUpdate = { outcome:"uncertain", channel:"main", revision, at:new Date().toISOString(), reasons:["NERV did not answer on the new revision within 16 minutes."], recovery:["Check ~/.nerv/updater.log and the inbox for the updater's result."] };
    renderHealth();
    poll();
  }
  // B-123: Dismiss hides the shown outcome for every page until a new run.
  document.addEventListener("click", e => {
    const t = e.target && e.target.closest && e.target.closest("#btn-dismiss-update-status");
    if (!t) return;
    e.preventDefault();
    state.manualUpdate = null;
    state.updaterStatus = null;
    renderHealth();
    void api("update/status/dismiss", { method:"POST" }).catch(e2 => log("Could not dismiss the update result: " + e2.message, "warn", null, "maya"));
  });
  document.addEventListener("click", e => {
    const t = e.target && e.target.closest && e.target.closest("#btn-apply-update");
    if (!t) return;
    e.preventDefault();
    void window.liveApplyUpdate();
  });
  const DEFAULT_SCHEDULE = { mode:"apply", checkHour:20, applyHour:3, quietFrom:8, quietUntil:23 };
  function settingsModel() {
    if (state.settingsDraft) return state.settingsDraft;
    const up = (state.updatePolicy && state.updatePolicy.policy) || { enabled:false };
    const s = Object.assign({}, DEFAULT_SCHEDULE, up.schedule || {});
    const ss = state.scheduleSettings || { brief:"08:00", timeZone:"Europe/Rome" };
    const briefEnabled = ss.brief !== "off";
    return {
      enabled:!!up.enabled,
      mode:s.mode,
      checkHour:s.checkHour,
      applyHour:s.applyHour,
      quietFrom:s.quietFrom,
      quietUntil:s.quietUntil,
      briefEnabled,
      briefAt:briefEnabled ? ss.brief : "08:00",
      timeZone:ss.timeZone || "Europe/Rome"
    };
  }
  window.renderSettings = function () {
    const box = document.getElementById("settings"); if (!box) return;
    const m = settingsModel();
    const busy = !!state.settingsBusy;
    const msg = state.settingsMsg;
    const rm = state.reloadMsg;
    const hour = (label, value) => " aria-label='" + label + "' type='number' min='0' max='23' step='1' value='" + esc(value) + "'" + (busy ? " disabled" : "") + ">";
    // Update schedule: one label and its controls per line, so the fields align in their column.
    box.innerHTML = "<form id='settings-form' class='list'>" +
      "<div class='field-grid small'>" +
      "<span>Updates</span><label class='field'><input type='checkbox' id='set-auto-enabled'" + (m.enabled ? " checked" : "") + (busy ? " disabled" : "") + "> Automatic</label>" +
      "<span class='field wide'><select id='set-update-mode' aria-label='Update mode'" + (busy ? " disabled" : "") + "><option value='apply'" + (m.mode === "apply" ? " selected" : "") + ">Apply after notice</option><option value='notify'" + (m.mode === "notify" ? " selected" : "") + ">Notify only</option></select></span>" +
      "<span>Check at</span><span class='field'><input id='set-check-hour'" + hour("Check hour (0–23)", m.checkHour) + "<span>:00</span></span>" +
      "<span>Apply at</span><span class='field'><input id='set-apply-hour'" + hour("Apply hour (0–23)", m.applyHour) + "<span>:00</span></span>" +
      "<span>Quiet hours</span><span class='field'><span class='nowrap'><input id='set-quiet-from'" + hour("No-apply from (0–23)", m.quietFrom) + " :00 –</span><span class='nowrap'><input id='set-quiet-until'" + hour("No-apply until (0–23)", m.quietUntil) + " :00</span></span>" +
      "<span>Daily brief</span><span class='field'><input type='checkbox' id='set-brief-enabled' aria-label='Daily brief'" + (m.briefEnabled ? " checked" : "") + (busy ? " disabled" : "") + "><input id='set-brief-at' aria-label='Daily brief time (HH:MM)' type='time' value='" + esc(m.briefAt) + "'" + (busy || !m.briefEnabled ? " disabled" : "") + "></span>" +
      "</div>" +
      "<div class='tiny muted'>Time zone " + esc(m.timeZone) + " · Sync Ratio 80% · Telegram 90 s</div>" +
      "<div class='row'><button class='btn sm primary' id='btn-save-settings' type='submit'" + (busy ? " disabled" : "") + ">" + (busy ? "Applying…" : "Apply") + "</button>" +
      "<span id='settings-status' role='status' class='tiny " + (msg ? msg.kind : "muted") + "'>" + esc(msg ? msg.text : (state.settingsDraft ? "Unsaved changes" : "")) + "</span></div>" +
      "</form>" +
      // The panel redraws on every poll: the Advanced section's open state lives in state (toggle listener below).
      "<details id='settings-advanced'" + (state.advancedOpen ? " open" : "") + "><summary class='tiny muted'>Advanced</summary>" +
      "<div class='row small'><button class='btn sm' id='btn-reload' type='button'" + (state.reloadBusy ? " disabled" : "") + ">Re-read the model settings from config.json</button>" +
      "<span id='reload-status' role='status' class='tiny " + (rm ? rm.kind : "muted") + "'>" + esc(rm ? rm.text : "") + "</span></div></details>";
  };
  function readSettingsDraft() {
    const enabled = !!document.getElementById("set-auto-enabled").checked;
    const mode = document.getElementById("set-update-mode").value;
    const num = id => Number(document.getElementById(id).value);
    const briefEnabled = !!document.getElementById("set-brief-enabled").checked;
    const briefAt = document.getElementById("set-brief-at").value || "08:00";
    return {
      enabled,
      mode,
      checkHour:num("set-check-hour"),
      applyHour:num("set-apply-hour"),
      quietFrom:num("set-quiet-from"),
      quietUntil:num("set-quiet-until"),
      briefEnabled,
      briefAt,
      timeZone:(state.scheduleSettings && state.scheduleSettings.timeZone) || "Europe/Rome"
    };
  }
  document.addEventListener("toggle", e => { if (e.target && e.target.id === "settings-advanced") state.advancedOpen = e.target.open; }, true);
  document.addEventListener("input", e => {
    if (e.target && e.target.closest && e.target.closest("#settings-form")) { state.settingsDraft = readSettingsDraft(); state.settingsMsg = null; }
  });
  document.addEventListener("change", e => {
    if (e.target && e.target.closest && e.target.closest("#settings-form")) {
      state.settingsDraft = readSettingsDraft();
      state.settingsMsg = null;
      if (e.target.id === "set-brief-enabled") renderSettings();
    }
  });
  document.addEventListener("submit", async e => {
    const form = e.target && e.target.closest && e.target.closest("#settings-form");
    if (!form) return;
    e.preventDefault();
    if (state.settingsBusy) return;
    const draft = readSettingsDraft();
    state.settingsDraft = draft;
    state.settingsBusy = true;
    state.settingsMsg = null;
    renderSettings();
    try {
      const current = (state.updatePolicy && state.updatePolicy.policy) || { channels: [], targets: [] };
      const r = await api("update/policy", {
        method:"POST",
        body:JSON.stringify({
          enabled: draft.enabled,
          channels: current.channels || [],
          targets: current.targets || [],
          schedule: { mode:draft.mode, checkHour:draft.checkHour, applyHour:draft.applyHour, quietFrom:draft.quietFrom, quietUntil:draft.quietUntil }
        })
      });
      const ss = await api("settings/schedule", {
        method:"PUT",
        body:JSON.stringify({ brief: draft.briefEnabled ? draft.briefAt : "off" })
      });
      state.updatePolicy = Object.assign({}, state.updatePolicy, { policy: r.policy });
      state.scheduleSettings = { brief: ss.brief, timeZone: ss.timeZone };
      state.settingsDraft = null;
      state.settingsMsg = { kind:"ok", text:"Settings saved." };
      renderHealth();
    } catch (err) {
      state.settingsMsg = { kind:"danger", text:err.message };
    } finally {
      state.settingsBusy = false;
      renderSettings();
    }
  });
  // F-118-T03: Settings lists the paired devices (name, paired, last use) and revokes one. A device paired from a browser
  // tab before the fix of #707 shows as "<kind> · dashboard app" with an old last use. Revoking this device ends its
  // pairing at once: the next request is refused (401) and the sign-in bar says the pairing ended.
  state.devices = null; state.devicesMsg = null;
  const deviceDay = t => new Date(t).toLocaleDateString();
  const deviceAgo = t => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 60 ? m + " min ago" : m < 2880 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " days ago"; };
  function renderDevices() {
    const box = document.getElementById("settings-devices"); if (!box) return;
    const list = state.devices, msg = state.devicesMsg;
    box.innerHTML = "<div class='row small settings-head'><b>Paired devices</b><span class='row' style='gap:4px'><button class='btn sm' type='button' id='btn-pair-device'>Pair a device</button><button class='btn sm' type='button' id='btn-devices-refresh'>Refresh</button></span></div>" + pairingHtml() +
      (list === null ? "<div class='tiny muted'>Loading…</div>" : !list.length ? "<div class='tiny muted'>No paired devices. Pair a phone with Pair a device or nerv open --phone --qr.</div>" :
        "<div class='list'>" + list.map(d => "<div class='row small' data-device='" + esc(d.id) + "' style='justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap'>" +
          "<span><b>" + esc(d.name) + "</b>" + (d.current ? " <span class='ok'>· this device</span>" : "") +
          "<br><span class='tiny muted'>paired " + esc(deviceDay(d.created)) + " · last used " + esc(deviceAgo(d.lastUse)) + " · lapses " + esc(deviceDay(d.expires)) + "</span></span>" +
          "<button class='btn sm danger' type='button' data-revoke='" + esc(d.id) + "' aria-label='Revoke " + esc(d.name) + (d.current ? " (this device)" : "") + "'>Revoke</button></div>").join("") + "</div>") +
      "<div role='status' class='tiny " + (msg ? msg.kind : "muted") + "'>" + esc(msg ? msg.text : "A revoked device must pair again with a new code; each lapses after 90 days unused.") + "</div>";
  }
  // F-118-T05: Settings → Pair a device mints a 10-minute code (a dashboard session may; a paired device may not) and
  // shows it with the QR of the dashboard link carrying it in the fragment. B-128: from a 127.0.0.1 page the server puts
  // the phone's address (config phone.url or this Mac's tailnet name) in the link; without one it keeps this page's
  // address and sends a hint how to set one.
  state.pairing = null;
  const loopbackHost = h => /^(127\.|localhost$|\[::1\]$)/.test(h);
  const linkHost = link => { try { return new URL(link).host; } catch { return ""; } };
  const qrSvg = rows => {
    if (!Array.isArray(rows) || !rows.every(r => typeof r === "string" && /^[01]+$/.test(r) && r.length === rows.length)) return "";
    const n = rows.length + 8; let d = "";
    rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] === "1") d += "M" + (x + 4) + " " + (y + 4) + "h1v1h-1z"; });
    return "<svg class='pair-qr' viewBox='0 0 " + n + " " + n + "' role='img' aria-label='QR code of the pairing link' shape-rendering='crispEdges'><rect width='" + n + "' height='" + n + "'/><path d='" + d + "'/></svg>";
  };
  function pairingHtml() {
    const p = state.pairing; if (!p) return "<div id='settings-pair'></div>";
    if (p.error) return "<div id='settings-pair' role='status' class='tiny danger'>" + esc(p.error) + "</div>";
    if (p.expired) return "<div id='settings-pair' role='status' class='tiny muted'>The pairing code expired: press Pair a device for a new one.</div>";
    const at = new Date(p.expiresAt).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
    return "<div id='settings-pair' class='list'>" + (p.qr ? qrSvg(p.qr) : "<div class='tiny muted'>No QR: " + esc(p.qrError || "none returned") + "</div>") +
      "<div class='small'>Pairing code <b class='pair-code'>" + esc(p.code) + "</b> <span class='tiny muted'>one use, valid until " + esc(at) + "</span></div>" +
      "<div class='tiny muted'>Scan it with the phone: Safari opens the dashboard and shows the code (it never pairs). There, Share → Add to Home Screen, open NERV from the Home Screen and type the code. A scanned link opens in Safari, never in the installed app.</div>" +
      (loopbackHost(linkHost(p.link).replace(/:\d+$/, "")) ? "<div class='tiny warn'>The QR opens " + esc(linkHost(p.link)) + ", which a phone cannot open. " + esc(p.phoneHint || "Open the dashboard at its Tailscale address (https://…ts.net) to pair from here.") + "</div>" :
        loopbackHost(location.hostname) ? "<div class='tiny muted'>The QR opens " + esc(linkHost(p.link)) + ", this Mac's address for the phone.</div>" : "") + "</div>";
  }
  let pairingExpiry = null;
  async function pairDevice() {
    clearTimeout(pairingExpiry);
    try {
      const p = await api("device/codes", { method:"POST", body:JSON.stringify({ base:location.origin }) });
      state.pairing = p;
      pairingExpiry = setTimeout(() => { state.pairing = { expired:true }; renderDevices(); }, Math.max(0, Math.min(p.expiresAt - Date.now(), 2147483647)));
    } catch (e) { if (e.status === 401) return; state.pairing = { error:e.status === 403 ? "A paired device cannot pair others: use nerv open --phone --qr, or Settings from nerv open dashboard." : e.message }; }
    renderDevices();
  }
  async function loadDevices() {
    try { state.devices = (await api("devices")).devices || []; }
    catch (e) { if (e.status === 401) return; state.devices = state.devices || []; state.devicesMsg = { kind:"danger", text:e.message }; }
    renderDevices();
  }
  document.addEventListener("click", async e => {
    if (e.target && e.target.closest && e.target.closest("#btn-devices-refresh")) { state.devicesMsg = null; void loadDevices(); return; }
    if (e.target && e.target.closest && e.target.closest("#btn-pair-device")) { void pairDevice(); return; }
    const b = e.target && e.target.closest && e.target.closest("#settings-devices button[data-revoke]"); if (!b) return;
    const d = (state.devices || []).find(x => x.id === b.getAttribute("data-revoke")); if (!d) return;
    if (!confirm("Revoke " + d.name + (d.current ? " (this device)" : "") + "? It must pair again with a new code from nerv open --phone.")) return;
    b.disabled = true;
    try {
      await api("devices/" + encodeURIComponent(d.id), { method:"DELETE" });
      if (d.current) { void poll(); return; }
      state.devicesMsg = { kind:"ok", text:"Revoked " + d.name + "." };
    } catch (err) {
      if (err.status === 401) return;
      state.devicesMsg = { kind:"danger", text:err.message };
    }
    await loadDevices();
  });
  // F-004-T08: Settings → Notifications. iOS asks for permission only after a tap inside the Home Screen app, and a
  // Safari tab has no PushManager, so a tab says to open the installed app. Enable asks first (still inside the tap),
  // then subscribes with the service's VAPID key through this page's own worker (sw.js, scope /dashboard/) and
  // registers the subscription with POST /api/push/subscribe, as the workspace's push toggle (web/src/main.ts) does;
  // Turn off removes it from the service, then unsubscribes here. A paired device may do both, like a dashboard session.
  state.push = { busy:false, on:false, checked:false, broken:false, msg:null };
  const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  let pushReady = null;
  const pushWorker = () => pushReady || (pushReady = navigator.serviceWorker.register("/dashboard/sw.js", { scope:"/dashboard/" }).then(() => navigator.serviceWorker.ready).catch(e => { pushReady = null; throw e; }));
  const vapidKey = s => Uint8Array.from(atob((s + "=".repeat((4 - s.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
  function pushView() {
    if (!pushSupported()) return ["muted", !INSTALLED && "standalone" in navigator ? "Notifications need the Home Screen app: in Safari, Share → Add to Home Screen, open NERV from the Home Screen and enable them there." : "This browser cannot receive notifications.", ""];
    // B-146: Enable shows only when enabling can work: push supported, permission not denied, this device not subscribed.
    if (Notification.permission === "denied") return ["muted", "Blocked on this device: allow notifications for NERV in its settings, then reload.", ""];
    if (!state.push.checked) return ["muted", "Checking this device…", ""];
    if (state.push.on) return ["ok", "On: this device is subscribed; reminders that fall due are sent here.", "<button class='btn sm' type='button' id='btn-push-disable'>Turn off</button>"];
    if (state.push.broken) return ["muted", "Notifications cannot be set up on this device now.", ""];
    return ["muted", "Off. Press Enable notifications and allow them when asked.", "<button class='btn sm primary' type='button' id='btn-push-enable'>Enable notifications</button>"];
  }
  function renderPush() {
    const box = document.getElementById("settings-push"); if (!box) return;
    const p = state.push, [kind, text, button] = pushView();
    box.innerHTML = "<div class='row small settings-head'><b>Notifications</b>" + (p.busy ? "<button class='btn sm' type='button' disabled>Working…</button>" : button) + "</div>" +
      "<div role='status' class='tiny " + kind + "'>" + esc(text) + "</div>" + (p.msg ? "<div role='alert' class='tiny " + p.msg.kind + "'>" + esc(p.msg.text) + "</div>" : "");
  }
  async function loadPush() {
    if (pushSupported()) {
      try { state.push.on = !!(await (await pushWorker()).pushManager.getSubscription()); state.push.broken = false; }
      catch (e) { state.push.broken = true; state.push.msg = { kind:"danger", text:"Notifications unavailable: " + e.message }; }
      state.push.checked = true;
    }
    renderPush();
  }
  async function pushChange(enable) {
    const p = state.push; if (p.busy) return; p.busy = true; p.msg = null; renderPush();
    try {
      if (enable) {
        // Asked first, while the tap is still the user's gesture: iOS shows the prompt only then.
        const permission = await Notification.requestPermission();
        if (permission !== "granted") { if (permission !== "denied") p.msg = { kind:"muted", text:"Not allowed: notifications stay off." }; return; }
        const [reg, key] = await Promise.all([pushWorker(), api("push/key")]);
        if (!key.publicKey) throw new Error("the service has no push key");
        const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:vapidKey(key.publicKey) });
        await api("push/subscribe", { method:"POST", body:JSON.stringify({ endpoint:sub.endpoint, keys:sub.toJSON().keys, userAgent:navigator.userAgent }) });
        p.on = true;
      } else {
        const sub = await (await pushWorker()).pushManager.getSubscription();
        if (sub) { await api("push/unsubscribe", { method:"POST", body:JSON.stringify({ endpoint:sub.endpoint }) }); await sub.unsubscribe(); }
        p.on = false;
      }
    } catch (e) { if (e.status !== 401) p.msg = { kind:"danger", text:(enable ? "Notifications not enabled: " : "Notifications not turned off: ") + e.message }; }
    finally { p.busy = false; renderPush(); }
  }
  document.addEventListener("click", e => {
    if (!e.target || !e.target.closest) return;
    if (e.target.closest("#btn-push-enable")) void pushChange(true);
    else if (e.target.closest("#btn-push-disable")) void pushChange(false);
  });
  window.liveSpear = async function (shortId) {
    const s = state.sorties.find(x => x.id === shortId); if (!s) return;
    if (!confirm("Spear " + s.id + "? Unused grants are revoked and waiting cards stood down. Actions that already ran are not undone.")) return;
    try { const r = await api("sorties/" + s.realId + "/spear", { method:"POST", body:JSON.stringify({ reason:"Spear from the dashboard" }) });
      log("SPEAR " + s.id + ": " + r.revoked + " grants revoked, " + r.stoodDown + " cards stood down; already happened: " + (r.happened.map(h => h.tool + (h.inverse ? " (undo with " + h.inverse + ")" : " (no undo)")).join(", ") || "nothing"), "danger", null, "gendo"); }
    catch (e) { log("Spear failed: " + e.message, "danger", null, "gendo"); }
    poll();
  };
  window.renderQuestions = function () {
    const n = state.approvals.length; setText(document.getElementById("qv-needs"), n);
    setText(document.getElementById("qd-needs"), n ? state.approvals.map(a => a.action.tool).join(" · ") : "nothing waits for you"); document.getElementById("q-needs").classList.toggle("alert", n > 0);
    { const ended = state.sorties.filter(s => s.ended && s.ended > state.lastVisit); const c = st => ended.filter(s => s.status === st).length; const delivered = state.deliveredSince === state.lastVisit ? state.deliveredCount || 0 : 0;
      setText(document.getElementById("qv-away"), c("done") + " done"); setText(document.getElementById("qd-away"), c("failed") + " failed · " + c("stood-down") + " stopped · " + delivered + " reminders");
      document.getElementById("q-away").classList.toggle("attn", c("failed") + c("stood-down") > 0); }
    const next = state.upcoming.filter(u => u.at > Date.now()).sort((a, b) => a.at - b.at)[0];
    setText(document.getElementById("qv-next"), next ? (next.label || hhmm(next.at)) : "—"); setText(document.getElementById("qd-next"), next ? next.title : "nothing scheduled");
    const p = (state.doctor || {}).processes || {}; const bad = !p.nervous || p.brainAlive === false; const degraded = ((state.doctor || {}).degraded || []).length > 0;
    setText(document.getElementById("qv-health"), bad ? "issue" : degraded ? "degraded" : "OK"); setText(document.getElementById("qd-health"), bad ? "a process is down" : degraded ? degradedSummary(state.doctor.degraded) : "all checks pass");
    document.getElementById("q-health").classList.toggle("alert", bad); document.getElementById("q-health").classList.toggle("attn", !bad && degraded);
    const usage = usageView(usagePage); setText(document.querySelector('[data-l="qBudget"]'), "Model usage"); setText(document.getElementById("qv-budget"), usagePage ? usagePage.items.length + " calls" : "—"); setText(document.getElementById("qd-budget"), usageError ? "Accounting refresh unavailable" : "Loaded page · " + usage.heading);
  };
  state.upcoming = []; state.selected = null; renderAll();
  /* B-005: live mode suggests only what a live base answers (the simulation's status · approve AP-… commands are demo-only). */
  const LIVE_HINT = "Ask Misato: remind me to … at … · why S-1A2B? · what are my reminders?";
  // Header-authenticated fetch stream; reconnect re-reads current pages instead of replaying operations.
  let streamController = null, streamTimer = null, refreshQueued = false, streamPaused = false;
  function queueRefresh() { if (refreshQueued) return; refreshQueued = true; setTimeout(() => { refreshQueued = false; if (polling) { queueRefresh(); return; } void poll(); }, 200); }
  async function watchChanges() {
    clearTimeout(streamTimer); if (streamController || !token || streamPaused) return;
    const session = token; const controller = new AbortController(); streamController = controller;
    try {
      const response = await fetch("/api/dashboard/stream", { headers:{Authorization:"Bearer " + session, "ngsw-bypass":"1"}, signal:controller.signal });
      if (!response.ok || !response.body) return;
      const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = "";
      try { for (;;) { const next = await reader.read(); if (next.done) break; pending += decoder.decode(next.value, {stream:true}); if (pending.length > 8192) throw new Error("Dashboard notification exceeds bound."); let end; while ((end = pending.indexOf("\n\n")) >= 0) { const message = pending.slice(0,end); pending = pending.slice(end+2); if (message.split("\n").includes("event: refresh")) queueRefresh(); } } }
      finally { await reader.cancel().catch(() => {}); }
    } catch { /* Periodic read recovery remains active during stream failures. */ }
    finally { if (streamController === controller) streamController = null; if (token && !streamPaused) streamTimer = setTimeout(watchChanges, 3000); }
  }
  window.addEventListener("pagehide", () => { streamPaused = true; clearTimeout(streamTimer); if (streamController) streamController.abort(); });
  window.addEventListener("pageshow", e => { if (e.persisted) { streamPaused = false; void watchChanges(); queueRefresh(); } });
  let started = false; const begin = () => { void watchChanges(); void api("commands").then(r => { if (r && Array.isArray(r.commands)) state.commands = r.commands; }).catch(() => {}); void loadDevices(); void loadPush(); if (started) { void poll(); return; } started = true; document.getElementById("chat-in").placeholder = LIVE_HINT; poll(); setInterval(poll, 3000); };
  // F-039: the login code is swapped for a dashboard session (never the admin token), kept in this tab's sessionStorage so a
  // reload stays signed in; it ends after 12 h, when the service restarts, with `sessions revoke`, or when the tab closes.
  // A token pasted by hand is the admin token: it stays in memory only and is never stored.
  // F-118-T02: a typed pairing code (nerv open --phone) is swapped once for a device credential, only in the installed
  // app (Home Screen): it is kept in the origin's localStorage so later launches sign in by themselves until it is
  // revoked, lapses after 90 days unused or the admin token rotates. A browser tab refuses the code before any request
  // (review of #707): it would hold a 90-day device it cannot sign out of.
  const SESSION_KEY = "nerv.dashboard.session"; const DEVICE_KEY = "nerv.device";
  const SESSION_ENDED = "Your dashboard session ended (after 12 h, a service restart or sessions revoke).";
  const DEVICE_ENDED = "This device's pairing ended (revoked, 90 days unused or a changed token).";
  const INSTALLED = (() => { try { return navigator.standalone === true || matchMedia("(display-mode: standalone)").matches; } catch { return false; } })();
  let paired = false;
  const store = kind => { try { return kind === "device" ? localStorage : sessionStorage; } catch { return null; } };
  function keepSession(t) { try { store("session").setItem(SESSION_KEY, t); } catch { /* storage blocked: memory only */ } }
  function keptSession() { try { return store("session").getItem(SESSION_KEY) || ""; } catch { return ""; } }
  function keptDevice() { try { return INSTALLED ? store("device").getItem(DEVICE_KEY) || "" : ""; } catch { return ""; } }
  function forgetSession() { try { store("session").removeItem(SESSION_KEY); } catch { /* nothing kept */ } if (paired) try { store("device").removeItem(DEVICE_KEY); } catch { /* nothing kept */ } }
  const ended = () => paired ? DEVICE_ENDED : SESSION_ENDED;
  const PAIRING_CODE = /^[A-Za-z0-9]{4}[\s-]?[A-Za-z0-9]{4}$/;
  const deviceName = () => { const ua = navigator.userAgent; const kind = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Macintosh|Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Device"; return kind + " · dashboard app"; };
  // Not signed in: a clear bar with a pairing-code or token field, never the simulation's invented data.
  const signIn = reason => {
    clearTimeout(streamTimer); if (streamController) streamController.abort();
    setBanner("<b>LIVE · NOT SIGNED IN</b> <span class='muted'>— " + esc(reason) + " Run <code>nerv open dashboard</code>" + (INSTALLED ? ", or type the pairing code from <code>nerv open --phone</code> (this app then stays signed in)" : "; on a phone, open the installed NERV app from the Home Screen and type the pairing code from <code>nerv open --phone</code> there") + "; or paste the access token (kept in memory only):</span> " +
      "<form id='live-signin' style='display:inline-flex;gap:4px'><label class='sr-only' for='live-token'>Pairing code or access token</label><input id='live-token' type='password' autocomplete='off' placeholder='XXXX-XXXX' style='width:16em'/><button class='btn sm' type='submit'>Sign in</button></form>");
  };
  const pair = value => {
    setBanner("<b>LIVE · SIGNING IN</b> <span class='muted'>— pairing this device…</span>");
    fetch("/api/device/pair", { method:"POST", headers:{ "Content-Type":"application/json", "ngsw-bypass":"1" }, body:JSON.stringify({ code:value, name:deviceName() }) })
      .then(r => r.json().catch(() => ({})).then(d => {
        if (!r.ok || !d.token) throw new Error(d.error || "Pairing failed");
        token = d.token; paired = true;
        try { store("device").setItem(DEVICE_KEY, token); } catch { /* storage blocked: this launch only */ }
        begin();
      }))
      .catch(e => signIn(e instanceof TypeError ? "The service was not reached." : e.message));
  };
  document.addEventListener("submit", e => {
    if (e.target.id !== "live-signin") return; e.preventDefault(); const input = document.getElementById("live-token"); const value = input.value.trim(); input.value = "";
    if (!value) return;
    if (PAIRING_CODE.test(value)) { if (INSTALLED) pair(value); else signIn("A pairing code works only in the installed NERV app: open it from the Home Screen and type the code there, or use the access token here."); return; }
    paired = false; token = value; api("status").then(begin).catch(err => { token = ""; signIn("That token was refused (" + err.message + ")."); });
  });
  // An installed app that was paired: sign in with the kept credential. Only a refusal (401) forgets it; a 403 stops;
  // while the service cannot be reached it is kept and tried again after 5 s, doubling up to 5 minutes.
  const resumeDevice = (wait = 5000) => {
    token = keptDevice(); paired = true; setBanner("<b>LIVE · SIGNING IN</b> <span class='muted'>— this device is paired; signing in…</span>");
    api("status").then(begin).catch(e => {
      if (e.status === 401) { token = ""; forgetSession(); paired = false; signIn(DEVICE_ENDED); return; }
      if (e.status === 403) { token = ""; signIn("The service refused this device (" + e.message + ")."); return; }
      setBanner("<b>LIVE · OFFLINE</b> <span class='muted'>— the service was not reached; trying again in " + Math.round(wait / 1000) + " s…</span>"); setTimeout(() => resumeDevice(Math.min(wait * 2, 300000)), wait);
    });
  };
  // F-118-T05: the page a scanned QR opens in Safari: the code and the steps while it is valid; no request, no pairing.
  const showPairingCode = (value, until) => {
    const at = new Date(until).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
    const expired = () => setBanner("<b>LIVE · PAIRING CODE EXPIRED</b> <span class='muted'>— this code expired at " + esc(at) + ". Run <code>nerv open --phone --qr</code> again (or Settings → Pair a device) and scan the new QR.</span>");
    if (Date.now() >= until) { expired(); return; }
    setBanner("<b>LIVE · PAIR THIS PHONE</b> <span class='muted'>— this page only shows the code; it never pairs.</span>" +
      "<div class='pair-code' aria-label='Pairing code " + esc(value) + "'>" + esc(value) + "</div>" +
      "<ol class='pair-steps'><li>Share → Add to Home Screen.</li><li>Open NERV from the Home Screen.</li><li>Type this code: <b>" + esc(value) + "</b> (valid until " + esc(at) + ").</li></ol>");
    setTimeout(expired, Math.min(until - Date.now(), 2147483647));
  };
  if (pairFragment && !INSTALLED) showPairingCode(pairFragment[1], Number(pairFragment[2]));
  else if (code) {
    setBanner("<b>LIVE · SIGNING IN</b> <span class='muted'>— exchanging the one-use login code…</span>");
    fetch("/api/session/exchange", { method:"POST", headers:{ "Content-Type":"application/json", "ngsw-bypass":"1" }, body:JSON.stringify({ code }) })
      .then(r => r.json().then(d => { if (!r.ok || !d.token) throw new Error(d.error || "Login failed"); token = d.token; keepSession(token); begin(); }))
      .catch(e => signIn(e.message + "."));
  } else if (keptDevice()) resumeDevice();
  else if (keptSession()) {
    // A reload in the same tab: the session kept for this tab signs in again, until it ends.
    token = keptSession(); setBanner("<b>LIVE · SIGNING IN</b> <span class='muted'>— resuming this tab's session…</span>");
    api("status").then(begin).catch(() => { token = ""; forgetSession(); signIn(SESSION_ENDED); });
  } else signIn("This page was opened without a login code.");
  // A click on a sortie loads its trace at once instead of waiting for the next poll.
  document.addEventListener("click", e => { const t = e.target.closest("[data-s]"); if (t) setTimeout(poll, 0); });
})();
