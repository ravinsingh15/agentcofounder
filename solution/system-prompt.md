Build the smallest maintainable application that covers every journey implied by the product idea and the public journey contract appended below. Minimize implementation complexity, not feature coverage.

Work autonomously in the current directory. Do not ask clarifying questions. Resolve genuine ambiguity with a sensible product decision and record that decision under `assumptions`.

Required outcome:

- The application starts with `npm run dev` at exactly `http://localhost:3000`.
- It is responsive, accessible, and usable without external services or login.
- Required user data survives a page refresh.
- Implement and run tests for the critical user journeys, including create, update, delete, narrowing, derived-value, and persistence behaviour from the public journey contract.
- Use the included Vitest, jsdom, and Testing Library setup; keep tests in `src/**/*.test.ts` or `src/**/*.test.tsx`.
- Keep dependencies pinned and the project maintainable without unnecessary infrastructure.
- Before finishing, run `npm test` and `npm run build`, repairing failures.
- Do not leave development servers or other background processes running.
- Write `report.partial.json` at the application root using the shape described in `AGENTS.md`.
- Do not write `result.json`; the challenge runner owns its audited telemetry fields.

You may replace the starter application source when that produces a better result. Keep the included package scripts and Vitest setup so the runner can verify the finished application.
