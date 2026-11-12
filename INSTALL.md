# NeoBet Intelligence — Best Picks fix

This add-on creates one combined shortlist page for football and basketball. It does not replace the existing prediction engine or modify the database.

## Files

- `public/src/best-picks.js`
- `public/src/best-picks.css`

## Install

1. Open the repository: https://github.com/irujeffrey/neobet-intelligence
2. Open `public/index.html`.
3. In the `<head>`, directly after the existing `/src/styles.css` link, add:

   `<link rel="stylesheet" href="/src/best-picks.css" />`

4. Find the existing script tag for `/src/app.js`.
5. Directly after it, add:

   `<script src="/src/best-picks.js" defer></script>`

6. Upload the two supplied files into the repository folder `public/src/`.
7. Commit the changes. The existing deployment workflow remains manual; run the website validation workflow first, then deploy when validation passes.

## What the shortlist does

- Reads football candidates from `/api/shadow-lab`.
- Reads basketball candidates from `/api/basketball-shadow-lab`.
- Uses the Eastern Time calendar day (`America/New_York`) for both sports.
- Football threshold: leading 1X2 outcome >= 62%, with at least a 10 percentage-point gap over the second outcome.
- Basketball threshold: estimated winner >= 62%.
- Shows no more than three candidates per sport.
- Does not force a pick when nothing qualifies.
- Keeps every displayed item marked `NO BET · EXPERIMENTAL`.

## Important safeguards

The current football and NBA shadow models are uncalibrated. Their probabilities must not be presented as calibrated confidence, GREEN/AMBER certainty, or approved betting picks. The basketball endpoint may remain disabled until API Ninjas public-display permission is confirmed. This add-on does not bypass that provider restriction.

The existing main app renders the `#picks` route. This add-on watches that page and replaces only its Best Picks content; it does not change the football, basketball, Model Lab, performance, or audit pages.
