# NeoBet Intelligence — Combined Best Picks update

## Files in this ZIP

- `public/index.html` — current homepage file with the Best Picks CSS and JavaScript already connected.
- `public/src/best-picks.js` — combined football + basketball shortlist logic.
- `public/src/best-picks.css` — styling for the shortlist.

## Install on GitHub

1. Open https://github.com/irujeffrey/neobet-intelligence
2. Open the `public` folder.
3. Replace `index.html` with the `public/index.html` file in this ZIP.
4. Open `public/src`.
5. Upload `best-picks.js` and `best-picks.css` from this ZIP (replace existing files if GitHub asks).
6. Commit the changes to your main branch.
7. Run the repository's validation workflow before deploying.

## Shortlist rules

- Football: 1X2 only. A candidate must have a leading outcome of at least 62%, and at least a 10 percentage-point lead over the second outcome.
- Basketball: match winner only, at least 62%.
- Maximum three candidates per sport. No forced picks.
- Uses the Eastern Time calendar day (`America/New_York`).
- Every displayed result remains `NO BET · EXPERIMENTAL` until the underlying model is calibrated and independently validated.

## Important

This is a frontend integration update. It does not change API endpoints, database schemas, provider permissions, or deploy the site. The existing basketball endpoint may still return a disabled status if provider public-display permission is not enabled.
