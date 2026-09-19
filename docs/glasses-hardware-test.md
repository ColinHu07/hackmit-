# Glasses display test

The current hardware-test URL is **https://colinhu07.github.io/bondimals-display/**.

This uses the same GitHub Pages account as the working Game Pigeon app. The public deployment repository is [ColinHu07/bondimals-display](https://github.com/ColinHu07/bondimals-display); GitHub Pages serves the compiled static files from branch `codex/display`, directory `/`. The application source remains in this monorepo.

On the paired phone, edit the saved Bondimals web app and replace its URL with the URL above, including the trailing slash. Then reopen the glasses app grid. Expected behavior is a small animated Nova on a black 600×600 display. This is still an idle display test; real head tracking and world anchoring are not enabled.

## Why a second host

The user confirmed Bondimals was saved in Meta AI but absent from the actual glasses launcher, while Game Pigeon was present. Both original URLs returned HTTP 200 without a login in a desktop HTTP check. The ChatGPT Sites response included an injected Cloudflare browser-check script; the working GitHub Pages response did not. That difference is a possible compatibility factor, **not a confirmed root cause**. This deployment changes hosting and asset base paths while keeping the same application JavaScript and CSS for a controlled hardware comparison.

The older ChatGPT Sites URL remains available, but use the GitHub Pages URL for this test. Do not treat successful desktop loading or publishing as proof of on-glasses behavior.

## Rebuilding this deployment

From the monorepo root, build with the GitHub Pages project prefix:

```sh
npm run typecheck
npm exec --workspace @bondimals/glasses-web -- vite build --base=/bondimals-display/ --outDir=/tmp/bondimals-pages-preview
```

The output contains `index.html`, `favicon.svg`, and `assets/`. Keep `.nojekyll` in the deployment repository and publish the rebuilt static files to its `codex/display` branch. Do not upload `.env` files, credentials, or the entire development workspace.

Hardware result: awaiting user test.
