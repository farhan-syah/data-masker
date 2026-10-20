# Contributing

## Rules that protect users

- The page must make no network request. A Content-Security-Policy blocks them. Tests check it. Never add a library that fetches data.
- Never put real personal data in a sample, a test, an issue or a screenshot. `samples/` has fictional data only.
- Write every message in plain English. Use short sentences and common words. Readers come from all over the world.
- Say each hint once. A hint that repeats on every card belongs in the legend.

## Set up

```sh
npm install
npx playwright install chromium
```

## Change the code

1. Modify files in `src/`. Never modify `index.html` by hand.
2. Run `npm run build`. Commit the rebuilt `index.html` with your change. CI fails when it is out of date.
3. Add a check to `tests/logic.test.mjs` for a change in detection or masking. Add one to `tests/e2e.mjs` only for a change in privacy, the match file or restore. Keep the tests few.
4. Run `npm test`. Both tests must pass.

| File | Holds |
|---|---|
| `src/shell.html` | Page structure, styles, Help text |
| `src/app.js` | Screens and flow |
| `src/logic.js` | Detection, masking, restore. No page access. |
| `src/core.js` | File reading and writing. Runs in a worker. |

## Pull requests

- Make one change per pull request.
- Say what the user sees before and after. Add a screenshot of the fictional sample when a screen changes.
- To report a bug, never attach the file that causes it. Describe the column layout and the value patterns.

## Releases

The version comes from the git tag. Nothing in the repo holds it.

1. Check that `main` is green.
2. Push a tag: `git tag v1.1.0 && git push origin v1.1.0`.
3. The Release workflow runs the tests on Linux, macOS and Windows. It builds `index.html` with the tag as its version. It publishes a GitHub Release with `index.html` and `SHA256SUMS`. It deploys the same file to GitHub Pages.

The `index.html` on `main` is a development build. To stamp a copy yourself, run `DM_VERSION=1.1.0 python3 build.py`.

## Reporting problems

Use the issue templates. Never attach real personal data. Report a leak of original values through a private security report. See `SECURITY.md`.
