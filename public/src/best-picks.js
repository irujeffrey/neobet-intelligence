/* NeoBet Intelligence — Combined Best Picks shortlist
 * Add this file after /src/app.js in public/index.html.
 * Experimental estimates remain NO BET until independently calibrated.
 */
(() => {
  "use strict";

  const ROOT_ID = "neo-best-picks-root";
  const TIME_ZONE = "America/New_York";
  const FOOTBALL_MIN_PROBABILITY = 0.62;
  const FOOTBALL_MIN_MARGIN = 0.10;
  const BASKETBALL_MIN_PROBABILITY = 0.62;
  const MAX_PER_SPORT = 3;

  const dayRange = (timeZone) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date()).map(x => [x.type, x.value]));
    const midnightUtc = (y, m, d) => {
      const guess = Date.UTC(y, m - 1, d);
      const local = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
        timeZone, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
      }).formatToParts(new Date(guess)).map(x => [x.type, x.value]));
      const represented = Date.UTC(+local.year, +local.month - 1, +local.day,
        +local.hour, +local.minute, +local.second);
      return guess - (represented - guess);
    };
    const next = new Date(Date.UTC(+p.year, +p.month - 1, +p.day + 1));
    return {
      from: new Date(midnightUtc(+p.year, +p.month, +p.day)).toISOString(),
      to: new Date(midnightUtc(next.getUTCFullYear(),
        next.getUTCMonth() + 1, next.getUTCDate())).toISOString()
    };
  };

  const el = (tag, className, value) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  };

  const localKickoff = (value) => {
    const time = new Date(value);
    return Number.isFinite(time.getTime())
      ? new Intl.DateTimeFormat("en-US", {
          weekday: "short", month: "short", day: "numeric",
          hour: "numeric", minute: "2-digit", timeZone: TIME_ZONE,
          timeZoneName: "short"
        }).format(time)
      : "Kickoff unavailable";
  };

  const fetchJson = async (path, params) => {
    const response = await fetch(`${path}?${params}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
    return response.json();
  };

  function getPageContent() {
    return document.getElementById("page-content");
  }

  function isBestPicksPage() {
    return window.location.hash.replace(/^#/, "") === "picks";
  }

  function makeCard(item) {
    const card = el("article", "page-panel neo-best-pick-card");
    const top = el("div", "neo-best-pick-top");
    top.append(
      el("span", "eyebrow small-eyebrow", item.sport.toUpperCase()),
      el("span", "fixture-no-bet shadow-no-bet", "NO BET · EXPERIMENTAL")
    );
    card.append(top);
    card.append(el("h2", "", item.teams));
    card.append(el("p", "panel-footnote", item.competition));
    card.append(el("p", "neo-best-pick-selection", `Model lean: ${item.selection}`));
    card.append(el("strong", "neo-best-pick-probability",
      `${(item.probability * 100).toFixed(1)}%`));
    card.append(el("time", "panel-footnote", localKickoff(item.scheduled_at)));
    card.lastChild.dateTime = item.scheduled_at || "";
    const explanation = item.sport === "Football"
      ? `Lead over the next 1X2 outcome: ${(item.margin * 100).toFixed(1)} percentage points.`
      : "Winner estimate from an uncalibrated NBA Elo shadow model.";
    card.append(el("p", "panel-footnote", `${explanation} Experimental only.`));
    return card;
  }

  async function loadBoard(root) {
    const content = root.querySelector("[data-neo-picks-content]");
    const refresh = root.querySelector("[data-neo-picks-refresh]");
    if (!content) return;
    if (refresh) {
      refresh.disabled = true;
      refresh.textContent = "Checking…";
    }
    content.replaceChildren(el("p", "fixture-message",
      "Checking eligible football and basketball estimates…"));

    const range = dayRange(TIME_ZONE);
    const params = new URLSearchParams(range);
    const [footballResponse, basketballResponse] = await Promise.allSettled([
      fetchJson("/api/shadow-lab", params),
      fetchJson("/api/basketball-shadow-lab", params)
    ]);

    content.replaceChildren();
    content.append(el("p", "panel-footnote",
      `Daily match window: ${new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium", timeZone: TIME_ZONE
      }).format(new Date(range.from))} · Eastern Time`));

    const candidates = [];
    const availabilityNotes = [];

    if (footballResponse.status === "fulfilled") {
      const leagues = Array.isArray(footballResponse.value.leagues)
        ? footballResponse.value.leagues : [];
      for (const league of leagues) {
        const matches = Array.isArray(league.upcoming) ? league.upcoming : [];
        for (const match of matches) {
          const probs = match.probabilities;
          const keys = ["home", "draw", "away"];
          if (!probs || !keys.every(k =>
            Number.isFinite(probs[k]) && probs[k] >= 0 && probs[k] <= 1)) continue;
          const total = keys.reduce((sum, k) => sum + probs[k], 0);
          if (Math.abs(total - 1) > 0.002) continue;
          const ordered = keys.map(k => probs[k]).sort((a, b) => b - a);
          const selection = match.experimental_selection;
          if (!keys.includes(selection)) continue;
          const probability = probs[selection];
          const margin = ordered[0] - ordered[1];
          if (probability < FOOTBALL_MIN_PROBABILITY ||
              margin < FOOTBALL_MIN_MARGIN) continue;
          const selectedName = selection === "home" ? match.home_team
            : selection === "away" ? match.away_team : "Draw";
          candidates.push({
            sport: "Football",
            competition: league.competition || "Football",
            teams: `${match.home_team} vs ${match.away_team}`,
            selection: selectedName,
            probability, margin, scheduled_at: match.scheduled_at
          });
        }
      }
    } else {
      availabilityNotes.push("Football estimates could not be loaded.");
    }

    if (basketballResponse.status === "fulfilled") {
      const result = basketballResponse.value;
      if (result.enabled === true && Array.isArray(result.upcoming)) {
        for (const match of result.upcoming) {
          const p = match.estimated_probability;
          if (!match.eligible || !Number.isFinite(p) ||
              p < BASKETBALL_MIN_PROBABILITY ||
              !["home", "away"].includes(match.estimated_selection)) continue;
          candidates.push({
            sport: "Basketball",
            competition: match.competition || "NBA",
            teams: `${match.home_team} vs ${match.away_team}`,
            selection: match.estimated_selection === "home"
              ? match.home_team : match.away_team,
            probability: p, margin: (p * 2) - 1,
            scheduled_at: match.scheduled_at
          });
        }
      } else {
        availabilityNotes.push(result.reason ||
          "Basketball estimates are hidden pending public-display permission from the provider.");
      }
    } else {
      availabilityNotes.push("Basketball estimates could not be loaded.");
    }

    const selected = ["Football", "Basketball"].flatMap(sport =>
      candidates.filter(x => x.sport === sport)
        .sort((a, b) => b.probability - a.probability)
        .slice(0, MAX_PER_SPORT)
    ).sort((a, b) => b.probability - a.probability);

    if (!selected.length) {
      const empty = el("section", "page-panel");
      empty.append(
        el("h2", "", "No selections passed the shortlist rules"),
        el("p", "panel-copy",
          "No eligible estimate met the minimum probability and separation thresholds for this match day. No picks are being forced.")
      );
      content.append(empty);
    } else {
      const grid = el("div", "neo-best-picks-grid");
      selected.forEach(item => grid.append(makeCard(item)));
      content.append(grid);
    }

    if (availabilityNotes.length) {
      const note = el("section", "page-panel shadow-disclosure");
      note.append(el("strong", "", "Sport availability"));
      availabilityNotes.forEach(message => note.append(el("p", "", message)));
      content.append(note);
    }

    content.append(el("p", "panel-footnote",
      "These are ranked experimental estimates, not calibrated confidence or betting advice. Grey NO BET status is intentional. Green/amber certainty labels must remain disabled until independent calibration and validation are complete."));

    if (refresh) {
      refresh.disabled = false;
      refresh.textContent = "↻ Refresh shortlist";
    }
  }

  function renderBoard() {
    if (!isBestPicksPage()) return;
    const page = getPageContent();
    if (!page || page.querySelector(`#${ROOT_ID}`)) return;

    const root = el("div");
    root.id = ROOT_ID;
    root.innerHTML = `
      <div class="page-intro neo-best-picks-heading">
        <div>
          <div class="eyebrow"><span class="eyebrow-line"></span> COMBINED SHORTLIST</div>
          <h1>Best picks<span class="title-period">.</span></h1>
          <p class="subhead">The strongest qualifying football and basketball model estimates.</p>
        </div>
        <button class="button button-quiet" type="button" data-neo-picks-refresh>↻ Refresh shortlist</button>
      </div>
      <section class="page-panel shadow-disclosure">
        <strong>Experimental model leans · not approved betting picks</strong>
        <p>Only leading outcomes that pass the shortlist thresholds are shown. Probabilities are uncalibrated estimates, not betting confidence. Every item remains NO BET until its model is calibrated, independently validated, and approved.</p>
        <p class="panel-footnote">Football: at least 62% for the leading 1X2 outcome and at least a 10-point lead over the next outcome. Basketball: at least 62% for the estimated winner. Maximum three candidates per sport. No minimum quota and no forced picks.</p>
      </section>
      <div data-neo-picks-content aria-live="polite"></div>`;
    page.replaceChildren(root);
    root.addEventListener("click", event => {
      if (event.target.closest("[data-neo-picks-refresh]")) loadBoard(root);
    });
    loadBoard(root).catch(error => {
      const target = root.querySelector("[data-neo-picks-content]");
      if (target) {
        target.replaceChildren(el("p", "fixture-message fixture-error",
          "The shortlist could not be loaded. Please refresh and try again."));
      }
      const button = root.querySelector("[data-neo-picks-refresh]");
      if (button) {
        button.disabled = false;
        button.textContent = "↻ Refresh shortlist";
      }
      console.error("NeoBet Best Picks:", error);
    });
  }

  const page = getPageContent();
  if (!page) return;
  const observer = new MutationObserver(() => renderBoard());
  observer.observe(page, { childList: true, subtree: true });
  window.addEventListener("hashchange", renderBoard);
  renderBoard();
})();
