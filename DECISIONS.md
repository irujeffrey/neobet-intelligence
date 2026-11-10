# Decisions

## 2026-11-06 — Start as static assets

The workspace had no existing app or dependency manifest, and npm was not available in the inspected shell. The first implementation is dependency-free HTML, CSS, and JavaScript, suitable for static asset hosting on Cloudflare Workers. This avoids a paid service and avoids requiring an install before the first preview. The API/data and model layer remains unconfigured.

## 2026-11-06 — Empty states until data is verified

The site does not invent fixtures, predictions, odds, quality scores, model performance, or audit history. Each becomes visible only after a licensed provider and a real calibrated model supply it.

## 2026-11-06 — Shared certainty classifier

Football and basketball use the same probability bands. A prediction is grey NO BET unless it has a finite probability in [0,1], a calibrated model, good data quality, fresh odds when required, and uncertainty no higher than 0.20. The uncertainty cut-off is an initial engineering guardrail and requires validation against model behavior before launch.
