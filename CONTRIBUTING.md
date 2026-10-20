# Contributing

## Rules that protect users

- The page must make no network request. A Content-Security-Policy blocks them, and tests check it. Do not add a library that fetches anything.
- Never put real personal data in a sample, a test, an issue, or a screenshot. `samples/` holds fictional data only.
- Keep UI text in plain English. Say each hint once. A hint that repeats on every card goes in the legend at the top of the page instead.

## Set up

```sh
npm install
npx playwright install chromium
```

## Change the code

1. Edit files in `src/`. Do not edit `index.html` by hand.
2. Run `npm run build`. Commit the rebuilt `index.html` with your change. CI fails when it is out of date.
3. Add a check to `tests/logic.test.mjs` for a change in detection or masking. Add one to `tests/e2e.mjs` only for a change that affects privacy, the match file or restore. Keep the tests few.
4. Run `npm test`. Both tests must pass.

| File | Holds |
|---|---|
| `src/shell.html` | Page structure, styles, Help text |
| `src/app.js` | User interface and flow |
| `src/logic.js` | Detection, masking, restore. No page access |
| `src/core.js` | File reading and writing, runs in a worker |

## Pull requests

- Keep one change per pull request.
- Describe what the user sees before and after. Add a screenshot of the fictional sample when the screen changes.
- Report a bug without attaching the file that triggers it. Describe the column layout and the value patterns instead.

## Releases

The version comes from the git tag. Nothing in the repo holds it.

1. Make sure `main` is green.
2. Push a tag, for example `git tag v1.1.0 && git push origin v1.1.0`.
3. The Release workflow runs the tests on Linux, macOS and Windows. It builds `index.html` with the tag as its version, publishes a GitHub Release with `index.html` and `SHA256SUMS`, and deploys that file to GitHub Pages.

The `index.html` in `main` is a development build and says so in its footer. Build a stamped copy yourself with `DM_VERSION=1.1.0 python3 build.py`.

## Reporting problems

Use the issue templates. Never attach real personal data. Report a leak of original values through a private security report (see `SECURITY.md`).
