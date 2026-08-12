import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/** How long a guest sandbox survives before it is reclaimed. */
const GUEST_TTL_HOURS = 24;

/** Upper bound on deletions per run, so one pass cannot run long. */
const MAX_DELETIONS_PER_RUN = 200;

/**
 * Removes expired guest accounts created by the public demo.
 *
 * Each visitor to the demo gets a real anonymous user, and without this they
 * accumulate forever. Every Spendable table references auth.users with
 * `on delete cascade`, so deleting the account takes its seeded data with it.
 *
 * Deliberately conservative: only anonymous users are considered, and only
 * once they are well past the point of anyone still using the tab.
 */
export async function purgeExpiredGuests(): Promise<{
  deleted: number;
  failed: number;
}> {
  const supabase = createAdminSupabase();
  const cutoff = Date.now() - GUEST_TTL_HOURS * 60 * 60 * 1000;

  let deleted = 0;
  let failed = 0;
  let page = 1;

  while (deleted + failed < MAX_DELETIONS_PER_RUN) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 200,
    });

    if (error) {
      logger.error("guests.purge.list_failed", { message: error.message });
      break;
    }

    const users = data?.users ?? [];
    if (users.length === 0) break;

    const expired = users.filter(
      (user) =>
        user.is_anonymous === true &&
        new Date(user.created_at).getTime() < cutoff,
    );

    for (const user of expired) {
      if (deleted + failed >= MAX_DELETIONS_PER_RUN) break;
      const { error: deleteError } = await supabase.auth.admin.deleteUser(
        user.id,
      );
      if (deleteError) failed += 1;
      else deleted += 1;
    }

    if (users.length < 200) break;
    page += 1;
  }

  if (deleted > 0 || failed > 0) {
    logger.info("guests.purge.complete", { deleted, failed });
  }

  return { deleted, failed };
}
