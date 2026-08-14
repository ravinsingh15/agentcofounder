export interface PiUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  reasoning?: number;
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
}

export interface CallLogEntry {
  index: number;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  reasoning_tokens?: number;
  cost_total?: number;
}

export interface UsageSummary {
  model_calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  reasoning_tokens: number;
  cost_total: number;
  call_log: CallLogEntry[];
}

export interface TestRun {
  command: string;
  journey: string;
  result: "passed" | "failed";
}

export interface PartialRunResult {
  status: "success" | "partial" | "failed";
  app_url: string;
  start_command: string;
  summary: string;
  implemented_features: string[];
  assumptions: string[];
  tests_run: TestRun[];
}

export interface AppVerification {
  passed: boolean;
  testsRun: TestRun[];
}

export interface RunResult extends PartialRunResult, UsageSummary {
  reported_tests: TestRun[];
  pi_exit_code: number;
  telemetry_source: "pi-json-event-stream";
}
