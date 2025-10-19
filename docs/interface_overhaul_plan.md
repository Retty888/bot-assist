# Interface Overhaul Checklist

The dashboard now follows the refreshed workflows requested by the trading desk. Use this checklist to keep the UI aligned with the intended experience during follow-up iterations.

## Market context
- [x] Replace the legacy candlestick widget with an on-demand chart snapshot sourced from live market data.
- [x] Remove the heatmap panel and reallocate the space to signal-driven context controls.
- [x] Allow interval/range configuration for snapshots (15m, 1h, 4h, 1d) and expose a manual refresh control.
- [x] Sync the selected signal with the market symbol so operators can jump directly from the spotlight into execution.

## Signal workspace
- [x] Split curated playbook signals and potential (manual/algo) ideas into dedicated blocks.
- [x] Provide a spotlight panel to inspect descriptions, presets, and provenance before loading anything into the builder.
- [x] Keep the automation modules (trailing stops, grids, trailing entries) adjacent to the signal editor.
- [x] Preserve a dedicated textarea for raw copy/paste from external signal groups so parsing can run unassisted.

## Execution trackers
- [x] Rename the execution history card to “Open signals & trackers” to reflect the blended log + monitoring purpose.
- [x] Ensure execution records remain accessible while leaving room for future state (stop/TP tracking, etc.).

## Next steps
- [ ] Wire snapshot source selection (e.g., exchange toggle) when multiple venues are supported.
- [ ] Attach server-side caching for QuickChart snapshots to reduce rate-limit risk.
- [x] Introduce status badges for potential signals (e.g., “Needs review”, “Ready to execute”).
- [x] Surface tracker controls for open positions (manual resolve, auto-close hooks).
