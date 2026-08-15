import { eq } from "drizzle-orm";
import {
  db,
  clientBoardFlagsTable,
  CLIENT_BOARD_FLAG_DEFAULTS,
  type ClientBoardFlagSegment,
} from "@workspace/db";

export async function isClientBoardSegmentEnabled(
  segment: ClientBoardFlagSegment,
): Promise<boolean> {
  const [row] = await db
    .select({ enabled: clientBoardFlagsTable.enabled })
    .from(clientBoardFlagsTable)
    .where(eq(clientBoardFlagsTable.segment, segment))
    .limit(1);
  return row?.enabled ?? CLIENT_BOARD_FLAG_DEFAULTS[segment];
}
