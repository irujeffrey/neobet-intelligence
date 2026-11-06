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
    if (!prediction || !Number.isFinite(prediction.probability)) return noBet("Missing probability");
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

  const pageNames = { home: "Overview", football: "Football centre", basketball: "Basketball centre", picks: "Best picks", performance: "Performance", audit: "Prediction audit", "match-analysis": "Match analysis", methodology: "Methodology", responsible: "Responsible use", privacy: "Privacy", terms: "Terms", admin: "Admin dashboard" };
  const homeMarkup = document.getElementById("page-content").innerHTML;
  const emptyNotice = (label, title, body) => `<div class="page-empty"><div class="page-empty-mark">✳</div><div><div class="empty-label"><span></span> ${label}</div><h3>${title}</h3><p>${body}</p></div></div>`;
  const pageMarkup = {
    football: `<div class="page-intro"><div><div class="eyebrow"><span class="eyebrow-line"></span> SPORT CENTRE</div><h1>Football<span class="title-period">.</span></h1><p class="subhead">Verified fixtures, calibrated probabilities, and transparent match analysis.</p></div><span class="page-status">● DATA NOT CONNECTED</span></div>${emptyNotice("NO VERIFIED FIXTURES", "The football centre is ready for verified data.", "No fixtures or predictions are shown until a licensed source and calibrated football model are connected.")}<section class="page-panel"><div class="panel-heading"><div><div class="eyebrow small-eyebrow">CERTAINTY GUIDE</div><h2>Same calibrated scale for every market</h2></div></div><div class="certainty-legend page-legend"></div><p class="panel-footnote">A grey NO BET status applies whenever data quality, model calibration, odds freshness, or uncertainty checks fail.</p></section>`,
    basketball: `<div class="page-intro"><div><div class="eyebrow"><span class="eyebrow-line"></span> SPORT CENTRE</div><h1>Basketball<span class="title-period">.</span></h1><p class="subhead">Team strength, pace-aware projections, and transparent match analysis.</p></div><span class="page-status">● DATA NOT CONNECTED</span></div>${emptyNotice("NO VERIFIED FIXTURES", "The basketball centre is ready for verified data.", "No fixtures or predictions are shown until a licensed source and calibrated basketball model are connected.")}<section class="page-panel"><div class="panel-heading"><div><div class="eyebrow small-eyebrow">CERTAINTY GUIDE</div><h2>Same calibrated scale for every market</h2></div></div><div class="certainty-legend page-legend"></div><p class="panel-footnote">A grey NO BET status applies whenever data quality, model calibration, odds freshness, or uncertainty checks fail.</p></section>`,
    picks: `<div class="page-intro"><div><div class="eyebrow"><span class="eyebrow-line"></span> SHORTLIST</div><h1>Best picks<span class="title-period">.</span></h1><p class="subhead">Ranked by calibrated probability, data reliability, and quality checks.</p></div></div>${emptyNotice("NO ELIGIBLE PICKS", "Nothing is ranked without evidence.", "Picks will appear only when model outputs are calibrated and pass data quality and freshness checks. Attractive odds alone cannot move a selection up the ranking.")}<section class="page-panel"><div class="eyebrow small-eyebrow">RANKING PRINCIPLES</div><div class="principle-grid"><div><b>01</b><strong>Calibrated probability</strong><small>Model output on a validated probability scale.</small></div><div><b>02</b><strong>Data reliability</strong><small>Fresh, complete, and attributable source data.</small></div><div><b>03</b><strong>Betting value</strong><small>Shown separately when licensed odds exist.</small></div></div></section>`,
    performance: `<div class="page-intro"><div><div class="eyebrow"><span class="eyebrow-line"></span> TRACK RECORD</div><h1>Performance<span class="title-period">.</span></h1><p class="subhead">A transparent record of published predictions and settled outcomes.</p></div></div><section class="stats-grid page-stats"><article class="stat-card"><div class="stat-heading">SETTLED PREDICTIONS</div><div class="stat-value">—</div><div class="stat-foot muted">No settled records</div></article><article class="stat-card"><div class="stat-heading">ACCURACY</div><div class="stat-value">—<small>%</small></div><div class="stat-foot muted">Not yet available</div></article><article class="stat-card"><div class="stat-heading">BRIER SCORE</div><div class="stat-value">—</div><div class="stat-foot muted">Requires settled outcomes</div></article><article class="stat-card"><div class="stat-heading">LOG LOSS</div><div class="stat-value">—</div><div class="stat-foot muted">Requires settled outcomes</div></article></section>${emptyNotice("NO SETTLED RESULTS", "The record begins when predictions are published.", "Performance will be calculated from the permanent prediction audit. No historical results or ROI are fabricated.")}`,
    audit: `<div class="page-intro"><div><div class="eyebrow"><span class="eyebrow-line"></span> PERMANENT RECORD</div><h1>Prediction audit<span class="title-period">.</span></h1><p class="subhead">Original timestamps, model versions, and settlement outcomes.</p></div></div>${emptyNotice("AUDIT NOT INITIALIZED", "Every published prediction will leave a trace.", "The audit ledger is not connected to a database yet. Once implemented, published probabilities will retain their original timestamp and model version; later changes will not overwrite them.")}<section class="page-panel"><div class="eyebrow small-eyebrow">RECORDED FOR EACH PICK</div><div class="principle-grid"><div><b>01</b><strong>Original prediction</strong><small>Sport, market, probability, model version, and published time.</small></div><div><b>02</b><strong>Settlement</strong><small>Win, loss, push, or void against the verified result.</small></div><div><b>03</b><strong>Evaluation</strong><small>Accuracy and probability scoring by sport and market.</small></div></div></section>`,
    "match-analysis": `<div class="page-intro"><div><div class="eyebrow"><span class="eyebrow-line"></span> MATCH REPORT</div><h1>Match analysis<span class="title-period">.</span></h1><p class="subhead">Model probabilities and verified context for one fixture.</p></div></div>${emptyNotice("NO MATCH SELECTED", "Match analysis will use verified inputs only.", "Select a verified fixture once a licensed data source is connected. Probability, model confidence, data quality, and betting value will be reported as separate measurements.")}<section class="page-panel"><div class="eyebrow small-eyebrow">PREDICTION DISPLAY</div><div class="principle-grid"><div><b>01</b><strong>Probability</strong><small>Calibrated chance for the selected outcome.</small></div><div><b>02</b><strong>Model confidence</strong><small>Separate estimate of model reliability.</small></div><div><b>03</b><strong>Data quality &amp; value</strong><small>Source freshness and odds context, shown independently.</small></div></div></section>`,
    methodology: `<div class="page-intro"><div><div class="eyebrow"><span class="eyebrow-line"></span> HOW IT WORKS</div><h1>Methodology<span class="title-period">.</span></h1><p class="subhead">Numerical predictions come from statistical models. Explanations must follow verified inputs.</p></div></div><section class="page-panel methodology-panel"><div class="eyebrow small-eyebrow">THE PRINCIPLES</div><div class="method-row"><span>01</span><div><strong>Calibrated probabilities</strong><p>Certainty labels come from calibrated model probabilities, not subjective opinions. Football and basketball share the same thresholds.</p></div></div><div class="method-row"><span>02</span><div><strong>Independent measurements</strong><p>Probability, model confidence, data quality, and betting value answer different questions and remain separate in the interface.</p></div></div><div class="method-row"><span>03</span><div><strong>Data quality gates</strong><p>Uncalibrated output, poor source quality, stale required odds, or excessive model uncertainty results in a grey NO BET.</p></div></div><div class="method-row"><span>04</span><div><strong>Permanent audit</strong><p>Published predictions retain their original timestamp and model version, then settle against verified results.</p></div></div></section><section class="page-panel"><div class="eyebrow small-eyebrow">CERTAINTY SCALE</div><div class="certainty-legend page-legend"></div><p class="panel-footnote">These probability ranges describe model estimates. They do not imply that an outcome is guaranteed.</p></section>`,
    responsible: `<div class="page-intro"><div><div class="eyebrow"><span class="eyebrow-line"></span> RESPONSIBLE USE</div><h1>Keep perspective<span class="title-period">.</span></h1><p class="subhead">Sports outcomes are uncertain. A probability is an estimate, not a promise.</p></div></div><section class="page-panel responsible-panel"><div class="responsible-symbol">♡</div><h2>For information and entertainment.</h2><p>NeoBet Intelligence is designed to explain model estimates and their limitations. It does not guarantee results or provide financial advice. Never stake money you cannot afford to lose, and take a break if betting stops being enjoyable.</p><p>Predictions can be wrong even when data is complete and the model is calibrated. NO BET means the available information does not meet our current reliability checks.</p></section>`,
    privacy: `<div class="page-intro"><div><div class="eyebrow"><span class="eyebrow-line"></span> LEGAL</div><h1>Privacy<span class="title-period">.</span></h1><p class="subhead">A starter privacy notice for the development preview.</p></div></div><section class="page-panel"><h2>Preview status</h2><p class="panel-copy">This static preview does not include accounts, tracking analytics, advertising, or a sports data connection. Hosting providers may process standard server logs. A complete privacy policy and any applicable consent controls must be reviewed before adding analytics, advertising, or user accounts.</p><p class="panel-footnote">This draft is not legal advice and must be updated for the deployed service and its actual providers.</p></section>`,
    terms: `<div class="page-intro"><div><div class="eyebrow"><span class="eyebrow-line"></span> LEGAL</div><h1>Terms of use<span class="title-period">.</span></h1><p class="subhead">A starter notice for this non-production preview.</p></div></div><section class="page-panel"><h2>Informational preview</h2><p class="panel-copy">This website is a development preview. No live predictions, odds, results, or betting service are currently provided. Future content will be estimates based on available data and may be inaccurate. It will not guarantee outcomes or constitute financial advice.</p><p class="panel-footnote">Complete terms should be reviewed before public launch.</p></section>`,
    admin: `<div class="page-intro"><div><div class="eyebrow"><span class="eyebrow-line"></span> PRIVATE OPERATIONS</div><h1>Admin dashboard<span class="title-period">.</span></h1><p class="subhead">Provider status, data quality, and system operations.</p></div></div>${emptyNotice("ADMIN SERVICES NOT CONFIGURED", "Operational controls are not connected.", "There is no admin authentication, database, provider adapter, or secret store in this preview. Do not expose an admin route publicly until access controls are implemented.")}`,
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
    content.querySelectorAll("[data-goto]").forEach((button) => button.addEventListener("click", () => showPage(button.dataset.goto)));
    content.querySelectorAll(".view-all").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); showPage(link.getAttribute("href").slice(1)); }));
    document.querySelector(".sidebar").classList.remove("menu-open");
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
  document.getElementById("refresh-button").addEventListener("click", () => showToast("No provider configured · No new data requested"));
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
    content.querySelectorAll("[data-goto]").forEach((button) => button.addEventListener("click", () => showPage(button.dataset.goto)));
    content.querySelectorAll(".view-all").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); showPage(link.getAttribute("href").slice(1)); }));
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
