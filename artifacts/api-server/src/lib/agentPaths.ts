import { join } from "node:path";
import { tmpdir } from "node:os";

export function agentDir(): string {
  return process.env.CLIENT_BOARD_AGENT_DIR || join(tmpdir(), "halo-agent-memory");
}
