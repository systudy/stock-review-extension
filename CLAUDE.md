# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Chrome Manifest V3 extension for A-share (Chinese stock market) daily review and alerting. No build step, no bundler, no third-party frontend framework. All code is plain vanilla JS loaded directly by the browser. Data is persisted entirely via `chrome.storage.local`.

## Loading / Testing

No build or compile step. To load the extension:

1. Open `chrome://extensions/` in Chrome (≥ 120)
2. Enable Developer Mode
3. Click "Load unpacked" → select the `chrome-extension/` folder

After editing any file, click the reload icon on the extension card at `chrome://extensions/`. For service worker changes, also click "Service Worker" → "Inspect" to confirm the new version loaded.

There is no automated test suite. Verification is manual via the browser extension UI.

## Architecture

All shared logic lives in `shared/` and is imported as ES modules by the three UI contexts (popup, dashboard, options) and the background service worker.

```
background/service-worker.js   ← scheduling hub (alarms, polling, notifications)
popup/                         ← toolbar popup: quick watchlist + today's ranking
dashboard/                     ← full-screen panel: K-line chart, watchlist management
options/                       ← settings page: rules, scoring, reminder config
shared/
  storage.js     ← all chrome.storage.local read/write helpers
  market-api.js  ← Sina (realtime) + EastMoney (daily K) HTTP fetchers + caching
  indicators.js  ← MA, BBI, MACD calculations; attachIndicators() enriches raw K data
  rules.js       ← rule engine: evaluateRule(), evaluateAlerts(), evaluateScores()
  defaults.js    ← RULE_TYPES enum + default config values
  report.js      ← Markdown / HTML report generation
  chart.js       ← canvas K-line + indicator rendering
  ui.js          ← shared DOM helpers
  utils.js       ← date, number, trading-day utilities
```

**Data flow:** `service-worker.js` fires on alarms → calls `market-api.js` to fetch/cache quotes → passes snapshots through `rules.js` → pushes notifications and stores results → UI pages read results from `storage.js` and render via `chart.js` / `ui.js`.

## Extending Rules

To add a new alert/scoring rule type:

1. Add the rule definition to `RULE_TYPES` in `shared/defaults.js`
2. Add the evaluation branch in `evaluateRule()` in `shared/rules.js`
3. If the rule needs a new indicator, add it to `shared/indicators.js` and call it from `attachIndicators()`

## Key Constraints

- **Module type**: `manifest.json` declares `"type": "module"` for the service worker, so all `shared/` files use ES module `import`/`export` syntax.
- **No CSP-unsafe eval**: Manifest V3 forbids `eval` and `new Function` in extension pages.
- **Single concurrent refresh**: `market-api.js` uses a lock to prevent parallel polling calls to the free Sina/EastMoney APIs.
- **Cache fallback**: On fetch failure, stale cached data is returned rather than throwing, to avoid blank UI states.
- **Storage key layout**: All storage keys and their schemas are defined/documented in `shared/storage.js` and `shared/defaults.js` — check there before adding new keys.
