/*
 * NeoBet Intelligence — shared certainty rules and page interactions.
 * Prediction records must come from a verified, licensed provider and a calibrated model.
 */
(function () {
  "use strict";

  const certaintyBands = [
    { key: "very-high", label: "Very High", min: 0.8, max: 1, color: "#176b48" },
    { key: "high", label: "High", min: 0.7, max: 0.8, color: "#35a66f" },
    { key: "moderate", label: "Moderate", min: 0.6, max: 0.7, color: "#f1ca54" },
    { key: "low", label: "Low", min: 0.5, max: 0.6, color: "#ef9147" },
    { key: "very-low", label: "Very Low", min: 0, max: 0.5, color: "#e26362" },
  ];

  /**
   * Returns display certainty only for calibrated predictions that pass quality gates.
   * Probability and confidence stay separate; neither is a guarantee.
   */
  function getCertainty(prediction) {
    if (!prediction || !Number.isFinite(prediction.probability)) {
      return noBet(prediction?.noBetReason || "Missing probability");
    }
    const p = prediction.probability;
    if (p < 0 || p > 1) return noBet("Invalid probability");
    if (prediction.calibrated !== true) return noBet("Model is not calibrated");
    if (prediction.dataQuality !== "good") return noBet("Data quality is insufficient");
    if (prediction.oddsRequired && prediction.oddsFresh !== true) return noBet("Odds are unavailable or stale");
    if (!Number.isFinite(prediction.uncertainty) || prediction.uncertainty > 0.2) return noBet("Model uncertainty is excessive");
    const band = certaintyBands.find((item) => p >= item.min && p < item.max) || certaintyBands[0];
    return { key: band.key, label: band.label, color: band.color, probability: p, percentage: `${(p * 100).toFixed(1)}%`, noBet: false };
  }

  function noBet(reason) {
    return { key: "no-bet", label: "NO BET", color: "#8993a1", probability: null, percentage: null, reason, noBet: true };
  }

  window.NeoBet = Object.freeze({ certaintyBands, getCertainty });

  const legend = document.getElementById("certainty-legend");
  if (legend) {
    legend.innerHTML = certaintyBands.map((band) => {
      const upper = band.max === 1 ? "100%" : `${Math.round(band.max * 100) - 1}%`;
      return `<div class="certainty-item"><span class="certainty-swatch" style="--certainty-color:${band.color}"></span><div><strong>${band.label}</strong><small>${Math.round(band.min * 100)}%–${upper}</small></div></div>`;
    }).join("") + '<div class="certainty-item"><span class="certainty-swatch no-bet-swatch"></span><div><strong>NO BET</strong><small>Insufficient data</small></div></div>';
  }

  const pageNames = { home: "Overview", football: "Football centre", basketball: "Basketball centre", picks: "Best picks", performance: "Performance", "model-lab": "Model Lab", audit: "Prediction audit", "match-analysis": "Match analysis", methodology: "Methodology", responsible: "Responsible use", privacy: "Privacy", terms: "Terms", admin: "Admin dashboard" };
  const homeMarkup = document.getElementById("page-content").innerHTML;
  let selectedFixture = null;
  const emptyNotice = (label, title, body) => `<div class="page-empty"><div class="page-empty-mark">✳</div><div><div class="empty-label"><span></span> ${label}</div><h3>${title}</h3><p>${body}</p></div></div>`;
  const pageMarkup = {
    football: `<div class="page-intro"><div><div class="eyebrow"><span class="eyebrow-line"></span> SPORT CENTRE</div><h1>Football<span class="title-period">.</span></h1><p class="subhead">Upcoming fixtures from Football-Data.org, shown in your local time.</p></div><span class="page-status">● FOOTBALL-DATA.ORG FEED</span></div><section class="page-panel fixtures-panel"><div class="fixture-toolbar"><div><div class="eyebrow small-eyebrow">MATCH SCHEDULE</div><h2>Upcoming fixtures</h2></div><button class="button button-quiet" type="button" data-refresh-football>↻ Refresh</button></div><div class="sports-fixture-list" id="football-fixture-list" aria-live="polite"><p class="fixture-message">Loading upcoming football fixtures…</p></div></section><section class="page-panel shadow-disclosure"><strong>Today’s public experimental football picks</strong><p>Open the daily board for experimental model leans across today’s competitions. These are not approved bets: every selection remains NO BET, and estimates are hidden when data or model checks fail.</p><button class="button button-quiet" type="button" data-goto="model-lab">View today’s experimental picks →</button></section><section class="page-panel"><div class="panel-heading"><div><div class="eyebrow small-eyebrow">CERTAINTY GUIDE</div><h2>Same calibrated scale for every market</h2></div></div><div class="certainty-legend page-legend"></div><p class="panel-footnote">A grey NO BET status applies whenever data quality, model calibration, odds freshness, or uncertainty checks fail.</p></section>`,
    basketball: `<div class="page-intro"><div><div class="eyebrow"><span class="eyebrow-line"></span> SPORT CENTRE</div><h1>Basketball<span class="title-period">.</span></h1><p class="subhead">NBA and WNBA fixtures with a separate public, experimental NBA model board.</p></div><span class="page-status">● API NINJAS FEED</span></div><section class="page-panel fixtures-panel"><div class="fixture-toolbar"><div><div class="eyebrow small-eyebrow">MATCH SCHEDULE</div><h2>Upcoming fixtures</h2></div><button class="button button-quiet" type="button" data-refresh-basketball>↻ Refresh</button></div><div class="sports-fixture-list" id="basketball-fixture-list" aria-live="polite"><p class="fixture-message">Loading upcoming basketball fixtures…</p></div></section><section class="page-panel shadow-disclosure"><div class="shadow-league-heading"><strong>Today’s experimental NBA picks</strong><span class="fixture-no-bet shadow-no-bet">NO BET · EXPERIMENTAL</span></div><p>Eligible games show the leading score-history estimate and exact probability. The model is uncalibrated, betting value is not assessed, and every game remains grey NO BET. Estimates are hidden if source licensing, fixture quality, freshness, or timing checks fail.</p><button class="button button-quiet" type="button" data-refresh-basketball-experiment>↻ Refresh NBA experiment</button><div id="basketball-shadow-content" aria-live="polite"><p class="fixture-message">Loading today’s NBA experimental estimates…</p></div></section><section class="page-panel"><div class="panel-heading"><div><div class="eyebrow small-eyebrow">CERTAINTY GUIDE</div><h2>Same calibrated scale for every market</h2></div></div><div class="certainty-legend page-legend"></div><p class="panel-footnote">Experimental NBA probabilities do not receive certainty colours until calibration and publication checks pass. A grey NO BET status applies when those checks fail.</p></section>`,
    picks: `<div class="page-intro"><div><div class="eyebrow"><span class="eyebrow-line"></span> SHORTLIST</div><h1>Best picks<span class="title-period">.</span></h1><p class="subhead">Approved picks are ranked only after calibration and quality checks.</p></div></div>${emptyNotice("NO APPROVED BETS", "Experimental football and NBA leans are available.", "Visit the Football Model Lab or Basketball page for eligible daily estimates. Experimental estimates are not approved picks; every selection remains NO BET.")}<div class="experimental-board-link"><span>PUBLIC DAILY EXPERIMENTS</span><div><button class="button button-quiet" type="button" data-goto="model-lab">Football experiments →</button><button class="button button-quiet" type="button" data-goto="basketball">NBA experiments →</button></div></div><section class="page-panel"><div class="eyebrow small-eyebrow">APPROVAL GATES</div><div class="principle-grid"><div><b>01</b><strong>Calibration</strong><small>Chronological held-out performance must support published probabilities.</small></div><div><b>02</b><strong>Data reliability</strong><small>Fixture data must be good quality and updated within seven days.</small></div><div><b>03</b><strong>Betting value</strong><small>Value remains a separate measure; no odds are currently assessed.</small></div></div></section>`,
    performance: `<div class="page-intro"><div><div class="eyebrow"><span class="eyebrow-line"></span> TRACK RECORD</div><h1>Performance<span class="title-period">.</span></h1><p class="subhead">A transparent record of published predictions and settled outcomes.</p></div></div><section class="stats-grid page-stats"><article class="stat-card"><div class="stat-heading">SETTLED PREDICTIONS</div><div class="stat-value">—</div><div class="stat-foot muted">No settled records</div></article><article class="stat-card"><div class="stat-heading">ACCURACY</div><div class="stat-value">—<small>%</small></div><div class="stat-foot muted">Not yet available</div></article><article class="stat-card"><div class="stat-heading">BRIER SCORE</div><div class="stat-value">—</div><div class="stat-foot muted">Requires settled outcomes</div></article><article class="stat-card"><div class="stat-heading">LOG LOSS</div><div class="stat-value">—</div><div class="stat-foot muted">Requires settled outcomes</div></article></section>${emptyNotice("NO SETTLED RESULTS", "The record begins when predictions are published.", "Performance will be calculated from the permanent prediction audit. No historical results or ROI are fabricated.")}`,
    "model-lab": `<div class="page-intro"><div><div class="eyebrow"><span class="eyebrow-line"></span> DAILY FOOTBALL BOARD</div><h1>Experimental picks<span class="title-period">.</span></h1><p class="subhead">Today’s model leans across competitions available in the football feed.</p></div><div class="shadow-page-actions"><span class="page-status shadow-status">EXPERIMENTAL · ALL NO BET</span><button class="button button-quiet" type="button" data-refresh-shadow>↻ Refresh today</button></div></div><section class="page-panel shadow-disclosure"><strong>Public experimental estimates · not betting recommendations</strong><p>Only matches scheduled for today are listed. For eligible matches, the leading model outcome and exact probability are shown as an experimental pick. Every match remains a grey NO BET because the models are unverified and betting value is not assessed. Estimates are hidden when fixture data quality is not good, source data is missing or older than seven days, or a league model is unavailable. Probabilities are not guarantees.</p></section><div id="shadow-lab-content" aria-live="polite"><p class="fixture-message">Loading today’s public experiment results…</p></div>`,
    audit: `<div class="page-intro"><div><div class="eyebrow"><span class="eyebrow-line"></span> PERMANENT RECORD</div><h1>Prediction audit<span class="title-period">.</span></h1><p class="subhead">Original timestamps, model versions, and settlement outcomes.</p></div></div>${emptyNotice("AUDIT VIEW PENDING", "Every published prediction will leave a trace.", "The database schema is ready. The audit interface will be connected when calibrated predictions and settlements are implemented.")}<section class="page-panel"><div class="eyebrow small-eyebrow">RECORDED FOR EACH PICK</div><div class="principle-grid"><div><b>01</b><strong>Original prediction</strong><small>Sport, market, probability, model version, and published time.</small></div><div><b>02</b><strong>Settlement</strong><small>Win, loss, push, or void against the verified result.</small></div><div><b>03</b><strong>Evaluation</strong><small>Accuracy and probability scoring by sport and market.</small></div></div></section>`,
    "match-analysis": `<div class="page-intro"><div><div class="eyebrow"><span class="eyebrow-line"></span> MATCH REPORT</div><h1>Match analysis<span class="title-period">.</span></h1><p class="subhead">Verified fixture details and model status.</p></div></div><div id="selected-match-analysis"></div><section class="page-panel"><div class="eyebrow small-eyebrow">PREDICTION DISPLAY</div><div class="principle-grid"><div><b>01</b><strong>Probability</strong><small>Shown only when a calibrated prediction is available.</small></div><div><b>02</b><strong>Model confidence</strong><small>Reported separately from probability.</small></div><div><b>03</b><strong>Data quality &amp; value</strong><small>Source freshness and odds context, shown independently.</small></div></div></section>`,
    methodology: `<div class="page-intro"><div><div class="eyebrow"><span class="eyebrow-line"></span> HOW IT WORKS</div><h1>Methodology<span class="title-period">.</span></h1><p class="subhead">Numerical predictions come from statistical models. Explanations must follow verified inputs.</p></div></div><section class="page-panel methodology-panel"><div class="eyebrow small-eyebrow">THE PRINCIPLES</div><div class="method-row"><span>01</span><div><strong>Calibrated probabilities</strong><p>Certainty labels come from calibrated model probabilities, not subjective opinions. Football and basketball share the same thresholds.</p></div></div><div class="method-row"><span>02</span><div><strong>Independent measurements</strong><p>Probability, model confidence, data quality, and betting value answer different questions and remain separate in the interface.</p></div></div><div class="method-row"><span>03</span><div><strong>Data quality gates</strong><p>Uncalibrated output, poor source quality, stale required odds, or excessive model uncertainty results in a grey NO BET.</p></div></div><div class="method-row"><span>04</span><div><strong>Permanent audit</strong><p>Published predictions retain their original timestamp and model version, then settle against verified results.</p></div></div></section><section class="page-panel"><div class="eyebrow small-eyebrow">CERTAINTY SCALE</div><div class="certainty-legend page-legend"></div><p class="panel-footnote">These probability ranges describe model estimates. They do not imply that an outcome is guaranteed.</p></section>`,
    responsible: `<div class="page-intro"><div><div class="eyebrow"><span class="eyebrow-line"></span> RESPONSIBLE USE</div><h1>Keep perspective<span class="title-period">.</span></h1><p class="subhead">Sports outcomes are uncertain. A probability is an estimate, not a promise.</p></div></div><section class="page-panel responsible-panel"><div class="responsible-symbol">♡</div><h2>For information and entertainment.</h2><p>NeoBet Intelligence is designed to explain model estimates and their limitations. It does not guarantee results or provide financial advice. Never stake money you cannot afford to lose, and take a break if betting stops being enjoyable.</p><p>Predictions can be wrong even when data is complete and the model is calibrated. NO BET means the available information does not meet our current reliability checks.</p></section>`,
    privacy: `<div class="page-intro"><div><div class="eyebrow"><span class="eyebrow-line"></span> LEGAL</div><h1>Privacy<span class="title-period">.</span></h1><p class="subhead">A starter privacy notice for the development preview.</p></div></div><section class="page-panel"><h2>Preview status</h2><p class="panel-copy">This site does not include accounts, tracking analytics, or advertising. It requests football and basketball fixture data server-side and stores it in Cloudflare D1. Hosting providers may process standard server logs. This draft must be updated before adding analytics, advertising, or user accounts.</p><p class="panel-footnote">This draft is not legal advice and must be reviewed for the deployed service and its actual providers.</p></section>`,
    terms: `<div class="page-intro"><div><div class="eyebrow"><span class="eyebrow-line"></span> LEGAL</div><h1>Terms of use<span class="title-period">.</span></h1><p class="subhead">Informational and experimental sports analysis.</p></div></div><section class="page-panel"><h2>Experimental football and basketball estimates</h2><p class="panel-copy">NeoBet may display experimental football and NBA model leans and probabilities for transparency and evaluation. They are not approved betting picks, remain NO BET, may be inaccurate, and are not guarantees, betting recommendations, or financial advice. Betting value is not assessed. Users are responsible for their own decisions.</p><p class="panel-footnote">Football fixtures are attributed to Football-Data.org. NBA experimental estimates remain hidden unless NeoBet has a provider plan or written permission that allows public display. Do not use experimental estimates as a basis for wagering.</p></section>`,
    admin: `<div class="page-intro"><div><div class="eyebrow"><span class="eyebrow-line"></span> PRIVATE OPERATIONS</div><h1>Admin dashboard<span class="title-period">.</span></h1><p class="subhead">Provider status, data quality, and system operations.</p></div></div>${emptyNotice("OPERATIONS RUN THROUGH GITHUB", "Provider sync is managed in Actions.", "The GitHub Actions workflow fetches licensed provider data and writes it to D1. No public database write endpoint is exposed.")}`,
  };

  function renderLegend(container) {
    container.innerHTML = certaintyBands.map((band) => {
      const upper = band.max === 1 ? "100%" : `${Math.round(band.max * 100) - 1}%`;
      return `<div class="certainty-item"><span class="certainty-swatch" style="--certainty-color:${band.color}"></span><div><strong>${band.label}</strong><small>${Math.round(band.min * 100)}%–${upper}</small></div></div>`;
    }).join("") + '<div class="certainty-item"><span class="certainty-swatch no-bet-swatch"></span><div><strong>NO BET</strong><small>Insufficient data</small></div></div>';
  }

  function showPage(page) {
    const title = pageNames[page] || "Overview";
    document.getElementById("current-crumb").textContent = title;
    document.querySelectorAll(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.page === page));
    const content = document.getElementById("page-content");
    content.innerHTML = page === "home" ? homeMarkup : (pageMarkup[page] || pageMarkup["match-analysis"]);
    content.querySelectorAll(".page-legend").forEach(renderLegend);
    if (page === "football") loadSportFixtures(content, "football");
    if (page === "basketball") { loadSportFixtures(content, "basketball"); loadBasketballExperiment(content); }
    if (page === "model-lab") loadShadowLab(content);
    if (page === "match-analysis") renderMatchAnalysis(content);
    content.querySelectorAll("[data-goto]").forEach((button) => button.addEventListener("click", () => showPage(button.dataset.goto)));
    content.querySelectorAll(".view-all").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); showPage(link.getAttribute("href").slice(1)); }));
    document.querySelector(".sidebar").classList.remove("menu-open");
    if (page === "home") refreshProviderStatus();
    window.location.hash = page === "home" ? "home" : page;
  }

  document.querySelectorAll(".nav-link").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); showPage(link.dataset.page); }));
  document.querySelectorAll(".footer-links a").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); showPage(link.getAttribute("href").slice(1)); }));
  document.querySelectorAll("[data-goto]").forEach((button) => button.addEventListener("click", () => showPage(button.dataset.goto)));
  document.querySelectorAll(".view-all").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); showPage(link.getAttribute("href").slice(1)); }));

  document.querySelectorAll(".sport-tab").forEach((tab) => tab.addEventListener("click", () => {
    document.querySelectorAll(".sport-tab").forEach((other) => { other.classList.remove("selected"); other.setAttribute("aria-selected", "false"); });
    tab.classList.add("selected"); tab.setAttribute("aria-selected", "true");
  }));

  document.getElementById("mobile-menu").addEventListener("click", () => document.querySelector(".sidebar").classList.toggle("menu-open"));
  document.getElementById("refresh-button").addEventListener("click", () => {
    refreshProviderStatus();
    showToast("Run Sync NeoBet sports data from GitHub Actions to refresh fixtures");
  });

  async function refreshDatabaseStatus() {
    const dot = document.getElementById("database-status-dot");
    const message = document.getElementById("database-status-message");
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      if (!response.headers.get("content-type")?.includes("application/json")) return;
      const result = await response.json();
      if (result.ok && result.schema === "ready") {
        message.textContent = "Connected";
        dot.classList.add("connected");
      } else if (result.database === "schema_pending") {
        message.textContent = "Migration pending";
      } else if (result.database === "not_bound") {
        message.textContent = "Binding pending";
      } else {
        message.textContent = "Unavailable";
      }
    } catch {
      message.textContent = "Not connected";
    }
  }

  async function refreshProviderStatus() {
    const value = document.getElementById("provider-sync-value");
    const foot = document.getElementById("provider-sync-foot");
    if (!value || !foot) return;
    try {
      const response = await fetch("/api/data-status", { cache: "no-store" });
      if (!response.ok) throw new Error("Status unavailable");
      const result = await response.json();
      const providers = result.providers || [];
      if (!providers.length) {
        value.innerHTML = '<span class="quality-mark"></span>Waiting';
        foot.textContent = "Run the sync from GitHub Actions";
        return;
      }
      const failed = providers.filter((provider) => provider.status !== "succeeded");
      const fixtureCount = providers.reduce((total, provider) => total + (provider.records_received || 0), 0);
      value.innerHTML = `<span class="quality-mark"></span>${failed.length ? "Check sync" : "Synced"}`;
      foot.textContent = failed.length ? "Open the GitHub sync run for details" : `${fixtureCount} fixtures in latest provider runs`;
    } catch {
      value.innerHTML = '<span class="quality-mark"></span>Status unavailable';
      foot.textContent = "Check the GitHub sync workflow";
    }
  }

  refreshDatabaseStatus();
  refreshProviderStatus();
  window.addEventListener("hashchange", () => {
    const page = window.location.hash.slice(1) || "home";
    if (pageNames[page]) showPageWithoutHistory(page);
  });

  function showPageWithoutHistory(page) {
    const title = pageNames[page] || "Overview";
    document.getElementById("current-crumb").textContent = title;
    document.querySelectorAll(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.page === page));
    const content = document.getElementById("page-content");
    content.innerHTML = page === "home" ? homeMarkup : (pageMarkup[page] || pageMarkup["match-analysis"]);
    content.querySelectorAll(".page-legend").forEach(renderLegend);
    if (page === "football") loadSportFixtures(content, "football");
    if (page === "basketball") { loadSportFixtures(content, "basketball"); loadBasketballExperiment(content); }
    if (page === "model-lab") loadShadowLab(content);
    if (page === "match-analysis") renderMatchAnalysis(content);
    content.querySelectorAll("[data-goto]").forEach((button) => button.addEventListener("click", () => showPage(button.dataset.goto)));
    content.querySelectorAll(".view-all").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); showPage(link.getAttribute("href").slice(1)); }));
    if (page === "home") refreshProviderStatus();
  }

  async function loadShadowLab(content) {
    const target = content.querySelector("#shadow-lab-content");
    if (!target) return;
    const refreshButton = content.querySelector("[data-refresh-shadow]");
    if (refreshButton) refreshButton.onclick = () => loadShadowLab(content);
    target.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "fixture-message";
    loading.textContent = "Loading today’s public experiment results…";
    target.append(loading);
    try {
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      const params = new URLSearchParams({ from: dayStart.toISOString(), to: dayEnd.toISOString() });
      const response = await fetch(`/api/shadow-lab?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Experiment data unavailable");
      const result = await response.json();
      target.replaceChildren();
      const updated = document.createElement("p");
      updated.className = "panel-footnote shadow-updated";
      updated.textContent = `Today’s local match window · Results calculated ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(result.generated_at))}`;
      target.append(updated);
      const leagues = Array.isArray(result.leagues) ? result.leagues : [];
      if (!leagues.length) {
        const empty = document.createElement("p");
        empty.className = "fixture-message";
        empty.textContent = "No shadow experiment data is available yet.";
        target.append(empty);
        return;
      }
      const percentage = (value) => Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "—";
      const score = (value) => Number.isFinite(value) ? value.toFixed(4) : "—";
      const metrics = [
        ["SETTLED FORECASTS", (league) => league.metrics?.settled_matches ?? 0],
        ["ACCURACY", (league) => percentage(league.metrics?.accuracy)],
        ["MULTICLASS BRIER · LOWER IS BETTER", (league) => score(league.metrics?.multiclass_brier_score)],
        ["LOG LOSS · LOWER IS BETTER", (league) => score(league.metrics?.log_loss)],
        ["MEAN ONE-VS-REST ECE", (league) => percentage(league.metrics?.mean_one_vs_rest_ece)],
      ];
      for (const league of leagues) {
        const section = document.createElement("section");
        section.className = "page-panel shadow-league";
        const heading = document.createElement("div");
        heading.className = "shadow-league-heading";
        const title = document.createElement("h2");
        title.textContent = league.competition || "Football competition";
        const status = document.createElement("span");
        status.className = "fixture-no-bet shadow-no-bet";
        status.textContent = league.model_status?.startsWith("no eligible") ? "NO MODEL · NO BET" : "UNVERIFIED · NO BET";
        heading.append(title, status);
        section.append(heading);

        const metricGrid = document.createElement("div");
        metricGrid.className = "shadow-metric-grid";
        for (const [label, getValue] of metrics) {
          const card = document.createElement("article");
          card.className = "shadow-metric";
          const name = document.createElement("span");
          name.textContent = label;
          const value = document.createElement("strong");
          value.textContent = String(getValue(league));
          card.append(name, value);
          metricGrid.append(card);
        }
        section.append(metricGrid);
        const count = league.metrics?.settled_matches || 0;
        const sampleNote = document.createElement("p");
        sampleNote.className = "panel-footnote";
        sampleNote.textContent = count ? `Scored on ${count} settled shadow forecasts. This is an ongoing experiment, not approval for live picks.` : "No shadow forecasts have settled yet. Scores will appear after results are synced.";
        section.append(sampleNote);

        const upcoming = Array.isArray(league.upcoming) ? league.upcoming : [];
        const upcomingHeading = document.createElement("h3");
        upcomingHeading.className = "shadow-subheading";
        upcomingHeading.textContent = `Today’s fixtures and estimates (${upcoming.length})`;
        section.append(upcomingHeading);
        if (!upcoming.length) {
          const none = document.createElement("p");
          none.className = "fixture-message";
          none.textContent = "No remaining fixtures are scheduled in this competition today.";
          section.append(none);
        } else {
          const list = document.createElement("div");
          list.className = "shadow-forecast-list";
          for (const match of upcoming) {
            const card = document.createElement("article");
            card.className = "shadow-forecast-card";
            const teams = document.createElement("strong");
            teams.textContent = `${match.home_team || "Home"} vs ${match.away_team || "Away"}`;
            const date = document.createElement("time");
            date.dateTime = match.scheduled_at;
            date.textContent = Number.isFinite(Date.parse(match.scheduled_at))
              ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(match.scheduled_at))
              : "Kickoff unavailable";
            const forecastCopy = document.createElement("div");
            forecastCopy.className = "shadow-forecast-copy";
            const modelPick = document.createElement("p");
            modelPick.className = "shadow-model-pick";
            const probabilities = document.createElement("p");
            if (match.probabilities && ["home", "draw", "away"].includes(match.experimental_selection)) {
              const choices = [
                { key: "home", label: match.home_team || "Home" },
                { key: "draw", label: "Draw" },
                { key: "away", label: match.away_team || "Away" },
              ];
              const best = choices.find((choice) => choice.key === match.experimental_selection);
              modelPick.textContent = `Experimental model pick: ${best.label} · ${percentage(match.probabilities[best.key])}`;
              probabilities.textContent = `Estimated probabilities · Home ${percentage(match.probabilities.home)} · Draw ${percentage(match.probabilities.draw)} · Away ${percentage(match.probabilities.away)}`;
            } else {
              modelPick.textContent = "No experimental pick available.";
              probabilities.textContent = match.reason || "Data or model checks failed · NO BET";
            }
            forecastCopy.append(modelPick, probabilities);
            const noBet = document.createElement("span");
            noBet.className = "fixture-no-bet shadow-no-bet";
            noBet.textContent = "NO BET · EXPERIMENTAL";
            card.append(teams, date, forecastCopy, noBet);
            list.append(card);
          }
          section.append(list);
        }

        target.append(section);
      }
    } catch {
      const error = document.createElement("p");
      error.className = "fixture-message fixture-error";
      error.textContent = "Public experiment results could not be loaded. Please try again later.";
      target.replaceChildren(error);
    }
  }

  async function loadBasketballExperiment(content) {
    const target = content.querySelector("#basketball-shadow-content");
    if (!target) return;
    const refresh = content.querySelector("[data-refresh-basketball-experiment]");
    if (refresh) refresh.onclick = () => loadBasketballExperiment(content);
    target.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "fixture-message";
    loading.textContent = "Loading today’s NBA experimental estimates…";
    target.append(loading);
    try {
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      const params = new URLSearchParams({ from: dayStart.toISOString(), to: dayEnd.toISOString() });
      const response = await fetch(`/api/basketball-shadow-lab?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error("NBA experiment unavailable");
      const result = await response.json();
      target.replaceChildren();
      if (!result.enabled) {
        const locked = document.createElement("p");
        locked.className = "fixture-message";
        locked.textContent = result.reason || "Public experimental estimates are unavailable; NO BET.";
        target.append(locked);
        return;
      }

      const summary = document.createElement("div");
      summary.className = "shadow-metric-grid";
      const metrics = [
        ["SETTLED SHADOW FORECASTS", result.metrics?.settled_forecasts ?? 0],
        ["ACCURACY", Number.isFinite(result.metrics?.accuracy) ? `${(result.metrics.accuracy * 100).toFixed(2)}%` : "—"],
        ["BRIER · LOWER IS BETTER", Number.isFinite(result.metrics?.brier_score) ? result.metrics.brier_score.toFixed(4) : "—"],
        ["LOG LOSS · LOWER IS BETTER", Number.isFinite(result.metrics?.log_loss) ? result.metrics.log_loss.toFixed(4) : "—"],
        ["ECE · LOWER IS BETTER", Number.isFinite(result.metrics?.ece) ? `${(result.metrics.ece * 100).toFixed(2)}%` : "—"],
      ];
      for (const [label, metric] of metrics) {
        const card = document.createElement("article");
        card.className = "shadow-metric";
        const name = document.createElement("span");
        name.textContent = label;
        const value = document.createElement("strong");
        value.textContent = String(metric);
        card.append(name, value);
        summary.append(card);
      }
      target.append(summary);

      const count = result.metrics?.settled_forecasts ?? 0;
      const note = document.createElement("p");
      note.className = "panel-footnote";
      note.textContent = `${result.monitoring_status || "PROVISIONAL_SHADOW_SAMPLE"} · ${count} forecasts settled before tip-off; 100 is a monitoring threshold only, not approval. Model is uncalibrated; probabilities are not certainty labels.`;
      target.append(note);

      const matches = Array.isArray(result.upcoming) ? result.upcoming : [];
      const heading = document.createElement("h3");
      heading.className = "shadow-subheading";
      heading.textContent = `Today’s NBA experimental estimates (${matches.length})`;
      target.append(heading);
      if (!matches.length) {
        const none = document.createElement("p");
        none.className = "fixture-message";
        none.textContent = "No eligible NBA estimates for today. Fixtures remain NO BET when no current, good-quality forecast passes the safeguards.";
        target.append(none);
        return;
      }

      const list = document.createElement("div");
      list.className = "shadow-forecast-list";
      for (const match of matches) {
        const card = document.createElement("article");
        card.className = "shadow-forecast-card";
        const title = document.createElement("strong");
        title.textContent = `${match.home_team || "Home"} vs ${match.away_team || "Away"}`;
        const time = document.createElement("time");
        time.dateTime = match.scheduled_at;
        time.textContent = Number.isFinite(Date.parse(match.scheduled_at))
          ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(match.scheduled_at))
          : "Tip-off unavailable";
        const estimate = document.createElement("p");
        estimate.className = "shadow-model-pick";
        const selectedTeam = match.estimated_selection === "home" ? match.home_team : match.away_team;
        estimate.textContent = `Experimental model pick: ${selectedTeam} · ${Number.isFinite(match.estimated_probability) ? `${(match.estimated_probability * 100).toFixed(2)}%` : "—"}`;
        const probabilities = document.createElement("p");
        probabilities.textContent = `Home win ${Number.isFinite(match.home_probability) ? `${(match.home_probability * 100).toFixed(2)}%` : "—"} · Away win ${Number.isFinite(match.away_probability) ? `${(match.away_probability * 100).toFixed(2)}%` : "—"}`;
        const badge = document.createElement("span");
        badge.className = "fixture-no-bet shadow-no-bet";
        badge.textContent = "NO BET · EXPERIMENTAL";
        card.append(title, time, estimate, probabilities, badge);
        list.append(card);
      }
      target.append(list);
    } catch {
      const error = document.createElement("p");
      error.className = "fixture-message fixture-error";
      error.textContent = "NBA experimental estimates could not be loaded. Fixtures remain NO BET.";
      target.replaceChildren(error);
    }
  }

  async function loadSportFixtures(content, sport) {
    const list = content.querySelector(`#${sport}-fixture-list`);
    if (!list) return;

    const refreshButton = content.querySelector(`[data-refresh-${sport}]`);
    if (refreshButton) {
      refreshButton.onclick = () => loadSportFixtures(content, sport);
    }

    list.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "fixture-message";
    loading.textContent = `Loading upcoming ${sport} fixtures…`;
    list.append(loading);

    try {
      const response = await fetch(`/api/fixtures?sport=${sport}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Fixture service unavailable");
      const result = await response.json();
      const fixtures = (Array.isArray(result.fixtures) ? result.fixtures : [])
        .filter((fixture) => fixture.sport === sport && fixture.status === "scheduled" && Number.isFinite(Date.parse(fixture.scheduled_at)) && Date.parse(fixture.scheduled_at) > Date.now())
        .sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at));

      if (!fixtures.length) {
        const empty = document.createElement("p");
        empty.className = "fixture-message";
        empty.textContent = `No upcoming ${sport} fixtures are available in the current feed.`;
        list.replaceChildren(empty);
        return;
      }

      const formatter = new Intl.DateTimeFormat(undefined, {
        weekday: "short", year: "numeric", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit", timeZoneName: "short",
      });
      const cards = document.createDocumentFragment();
      fixtures.forEach((fixture) => {
        const card = document.createElement("article");
        card.className = "fixture-card";
        card.tabIndex = 0;
        card.setAttribute("role", "button");
        card.setAttribute("aria-label", `View match analysis: ${fixture.home_team || "Home team"} versus ${fixture.away_team || "Away team"}`);
        const openAnalysis = () => {
          selectedFixture = fixture;
          showPage("match-analysis");
        };
        card.addEventListener("click", openAnalysis);
        card.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openAnalysis();
          }
        });

        const meta = document.createElement("div");
        meta.className = "fixture-card-meta";
        const competition = document.createElement("span");
        competition.className = "fixture-competition";
        competition.textContent = fixture.competition || (sport === "basketball" ? "Basketball" : "Football");
        const status = document.createElement("span");
        status.className = "fixture-status";
        status.textContent = "Scheduled";
        meta.append(competition, status);

        const teams = document.createElement("div");
        teams.className = "fixture-teams";
        const home = document.createElement("strong");
        home.textContent = fixture.home_team || "Home team";
        const versus = document.createElement("span");
        versus.className = "fixture-versus";
        versus.textContent = "vs";
        const away = document.createElement("strong");
        away.textContent = fixture.away_team || "Away team";
        teams.append(home, versus, away);

        const certainty = window.NeoBet.getCertainty({
          noBetReason: "No calibrated prediction is available for this fixture",
        });
        const decision = document.createElement("div");
        decision.className = "fixture-decision";
        const badge = document.createElement("span");
        badge.className = "fixture-no-bet";
        badge.textContent = certainty.label;
        badge.setAttribute("aria-label", `${certainty.label}: ${certainty.reason}`);
        const reason = document.createElement("span");
        reason.className = "fixture-no-bet-reason";
        reason.textContent = sport === "basketball"
          ? "No calibrated basketball prediction is available"
          : certainty.reason;
        decision.append(badge, reason);

        const kickoff = document.createElement("time");
        kickoff.className = "fixture-kickoff";
        kickoff.dateTime = fixture.scheduled_at;
        kickoff.textContent = formatter.format(new Date(fixture.scheduled_at));

        card.append(meta, teams, decision, kickoff);
        cards.append(card);
      });
      list.replaceChildren(cards);
    } catch {
      const error = document.createElement("p");
      error.className = "fixture-message fixture-error";
      error.textContent = "Fixtures could not be loaded. Please try again.";
      const retry = document.createElement("button");
      retry.className = "text-button";
      retry.type = "button";
      retry.textContent = "Retry";
      retry.addEventListener("click", () => loadSportFixtures(content, sport));
      list.replaceChildren(error, retry);
    }
  }

  function renderMatchAnalysis(content) {
    const target = content.querySelector("#selected-match-analysis");
    if (!target) return;
    if (!selectedFixture) {
      target.innerHTML = emptyNotice(
        "NO MATCH SELECTED",
        "Match analysis uses verified inputs only.",
        "Choose a fixture from the Football or Basketball page. Since no calibrated prediction is currently available, the decision remains NO BET.",
      );
      return;
    }

    const fixture = selectedFixture;
    const panel = document.createElement("section");
    panel.className = "page-panel selected-match-panel";
    const competition = document.createElement("div");
    competition.className = "eyebrow small-eyebrow";
    competition.textContent = fixture.competition || (fixture.sport === "basketball" ? "Basketball" : "Football");
    const teams = document.createElement("h2");
    teams.className = "selected-match-teams";
    teams.textContent = `${fixture.home_team || "Home team"} vs ${fixture.away_team || "Away team"}`;
    const kickoff = document.createElement("time");
    kickoff.className = "selected-match-kickoff";
    kickoff.dateTime = fixture.scheduled_at;
    kickoff.textContent = new Intl.DateTimeFormat(undefined, {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
      hour: "numeric", minute: "2-digit", timeZoneName: "short",
    }).format(new Date(fixture.scheduled_at));

    const certainty = window.NeoBet.getCertainty({
      noBetReason: "No calibrated prediction is available for this fixture",
    });
    const decision = document.createElement("div");
    decision.className = "fixture-decision selected-match-decision";
    const badge = document.createElement("span");
    badge.className = "fixture-no-bet";
    badge.textContent = certainty.label;
    const reason = document.createElement("span");
    reason.className = "fixture-no-bet-reason";
    reason.textContent = certainty.reason;
    decision.append(badge, reason);

    const probability = document.createElement("p");
    probability.className = "selected-match-probability";
    probability.textContent = "Probability: unavailable — no calibrated prediction";
    const back = document.createElement("button");
    back.className = "button button-quiet selected-match-back";
    back.type = "button";
    const fixturePage = fixture.sport === "basketball" ? "basketball" : "football";
    back.textContent = `Back to ${fixturePage} fixtures`;
    back.addEventListener("click", () => showPage(fixturePage));

    panel.append(competition, teams, kickoff, decision, probability, back);
    target.replaceChildren(panel);
  }

  let toastTimer;
  function showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("visible"), 3200);
  }
})();
