# Generated application contract

- Keep the application self-contained and runnable with `npm run dev` at `http://localhost:3000`.
- Store durable single-user browser data locally when persistence is required.
- Prefer semantic HTML and accessible names so browser automation can use the interface without brittle selectors.
- Add tests for the product's critical user journeys and run them before claiming success.
- The seed intentionally contains no product tests. Add at least one `src/**/*.test.ts` or `src/**/*.test.tsx` test; the runner rejects a zero-test report.
- `report.partial.json` contains only `status`, `app_url`, `start_command`, `summary`, `implemented_features`, `assumptions`, and `tests_run`.
- The runner owns the final `app_url`, `start_command`, verified `tests_run`, and telemetry fields. Your product-journey test claims are preserved separately as `reported_tests`.
- Do not create or edit `result.json`; the outer challenge runner derives its telemetry from Pi.
