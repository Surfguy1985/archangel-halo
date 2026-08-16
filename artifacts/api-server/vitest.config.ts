import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: { AGENT_HF: "0", MEM0_TELEMETRY: "false" },
    // Contract tests hit the real dev database — keep them serial so
    // seed/cleanup of the throwaway rows can't interleave.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
