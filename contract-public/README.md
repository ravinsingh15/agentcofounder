# Public challenge contract

The public development idea is intentionally the only product-specific fixture in this repository.

The generated application must cover the domain-neutral [public journey contract](journeys.md). The runner appends that exact file to Pi's system prompt, keeping participant documentation and runtime guidance aligned.

`result.schema.json` validates the complete final result emitted by this starter harness, not only the minimum fields from the challenge specification. It deliberately requires the harness audit fields `reported_tests`, `reasoning_tokens`, `cost_total`, `pi_exit_code`, `telemetry_source`, and `port_reclamation`. A replacement runner may add fields but must preserve these fields and their semantics.

Official judging supplies a different idea and private browser journeys. No hidden prompt, selector, threshold, expected copy, or score implementation belongs in this public directory.
