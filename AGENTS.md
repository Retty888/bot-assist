# Agent Notes

- Purpose: automate Hyperliquid trading via parsed textual signals and normalized order execution.
- Primary modules: `src/trading/tradeSignalParser.ts` (signal parsing) and `src/trading/hyperliquidTradingBot.ts` (order orchestration).
- Tests: run `npm test` (Vitest) for parser and bot behaviors.
- Docs: repository naming guidance in `docs/github_repository_naming.md`.
- Next steps: integrate real signal source, expand error handling, wire deployment pipeline.
