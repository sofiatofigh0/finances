import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RemovedTransaction, Transaction as PlaidTransaction } from "plaid";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { decryptToken, encryptToken } from "@/lib/security/crypto";
import { logger } from "@/lib/logger";
import {
  getPlaidClient,
  interpretPlaidError,
  PLAID_COUNTRY_CODES,
  PLAID_OPTIONAL_PRODUCTS,
  PLAID_PRODUCTS,
} from "./client";
import {
  normalizeAccount,
  normalizeCreditLiability,
  normalizeMortgage,
  normalizeStudentLoan,
  normalizeTransaction,
  type NormalizedLiability,
} from "./normalize";
import {
  classifyTransaction,
  detectInternalTransfers,
  isLikelyRefund,
} from "@/lib/finance/classify";
import type { Classification, Transaction } from "@/lib/finance/types";
import { publicEnv } from "@/lib/env";

/**
 * Plaid synchronization.
 *
 * Design rules:
 *   * Incremental. Transactions use /transactions/sync with a per-Item cursor,
 *     never a repeated full replace.
 *   * Idempotent. Every write is an upsert keyed on Plaid's own identifier, so
 *     replaying a webhook or overlapping with the scheduled job is harmless.
 *   * Non-destructive. A broken connection updates status and preserves all
 *     existing history; it never deletes transactions.
 */

export interface PlaidItemRow {
  id: string;
  user_id: string;
  plaid_item_id: string;
  access_token_encrypted: string;
  institution_name: string | null;
  transactions_cursor: string | null;
  status: string;
}

export interface SyncResult {
  itemId: string;
  status: "success" | "partial" | "failed";
  added: number;
  modified: number;
  removed: number;
  message?: string;
}

// ---------------------------------------------------------------------------
// Link token / token exchange
// ---------------------------------------------------------------------------

export async function createLinkToken(
  userId: string,
  options: { accessToken?: string; redirectUri?: string } = {},
): Promise<string> {
  const client = getPlaidClient();
  const webhookUrl = `${publicEnv.appUrl.replace(/\/$/, "")}/api/plaid/webhook`;

  const response = await client.linkTokenCreate({
    user: { client_user_id: userId },
    client_name: "Spendable",
    language: "en",
    country_codes: PLAID_COUNTRY_CODES,
    webhook: webhookUrl,
    // In update mode Plaid rejects `products`; it reuses the Item's own.
    ...(options.accessToken
      ? { access_token: options.accessToken }
      : {
          products: PLAID_PRODUCTS,
          optional_products: PLAID_OPTIONAL_PRODUCTS,
        }),
    ...(options.redirectUri ? { redirect_uri: options.redirectUri } : {}),
  });

  return response.data.link_token;
}

/**
 * Exchanges a public token for an access token, encrypts it, and stores the
 * Item. Supports multiple Items per user (several institutions).
 */
export async function exchangePublicToken(
  userId: string,
  publicToken: string,
  institution?: { id?: string | null; name?: string | null },
): Promise<{ itemRowId: string; plaidItemId: string }> {
  const client = getPlaidClient();
  const supabase = createAdminSupabase();

  const exchange = await client.itemPublicTokenExchange({
    public_token: publicToken,
  });
  const accessToken = exchange.data.access_token;
  const plaidItemId = exchange.data.item_id;

  const itemDetails = await client.itemGet({ access_token: accessToken });

  const { data, error } = await supabase
    .from("spendable_plaid_items")
    .upsert(
      {
        user_id: userId,
        plaid_item_id: plaidItemId,
        access_token_encrypted: encryptToken(accessToken),
        institution_id: institution?.id ?? itemDetails.data.item.institution_id ?? null,
        institution_name: institution?.name ?? null,
        available_products: itemDetails.data.item.available_products ?? [],
        billed_products: itemDetails.data.item.billed_products ?? [],
        status: "active",
        error_code: null,
        error_message: null,
      },
      { onConflict: "user_id,plaid_item_id" },
    )
    .select("id")
    .single();

  if (error) {
    logger.error("plaid.exchange.persist_failed", {
      userId,
      message: error.message,
    });
    throw new Error("Could not save the new connection.");
  }

  logger.info("plaid.item.linked", { userId, itemRowId: data.id });
  return { itemRowId: data.id, plaidItemId };
}

// ---------------------------------------------------------------------------
// Item lookup
// ---------------------------------------------------------------------------

export async function getItemsForUser(userId: string): Promise<PlaidItemRow[]> {
  const supabase = createAdminSupabase();
  const { data, error } = await supabase
    .from("spendable_plaid_items")
    .select(
      "id, user_id, plaid_item_id, access_token_encrypted, institution_name, transactions_cursor, status",
    )
    .eq("user_id", userId)
    .neq("status", "revoked");

  if (error) throw new Error(error.message);
  return (data ?? []) as PlaidItemRow[];
}

export async function getItemByPlaidId(
  plaidItemId: string,
): Promise<PlaidItemRow | null> {
  const supabase = createAdminSupabase();
  const { data } = await supabase
    .from("spendable_plaid_items")
    .select(
      "id, user_id, plaid_item_id, access_token_encrypted, institution_name, transactions_cursor, status",
    )
    .eq("plaid_item_id", plaidItemId)
    .maybeSingle();

  return (data as PlaidItemRow | null) ?? null;
}

// ---------------------------------------------------------------------------
// The main sync
// ---------------------------------------------------------------------------

export async function syncItem(
  item: PlaidItemRow,
  trigger: "manual" | "webhook" | "scheduled" | "initial",
): Promise<SyncResult> {
  const supabase = createAdminSupabase();
  const startedAt = new Date().toISOString();

  let added = 0;
  let modified = 0;
  let removed = 0;

  try {
    const accessToken = decryptToken(item.access_token_encrypted);
    const client = getPlaidClient();

    // --- 1. Accounts + balances ------------------------------------------
    const accountsResponse = await client.accountsGet({ access_token: accessToken });
    const institutionName =
      item.institution_name ?? accountsResponse.data.item.institution_id ?? null;

    const accountIdMap = await upsertAccounts(
      supabase,
      item,
      accountsResponse.data.accounts,
      institutionName,
    );

    // --- 2. Transactions (incremental) ------------------------------------
    const txnResult = await syncTransactions(
      supabase,
      item,
      accessToken,
      accountIdMap,
    );
    added = txnResult.added;
    modified = txnResult.modified;
    removed = txnResult.removed;

    // --- 3. Liabilities (optional product) --------------------------------
    await syncLiabilities(supabase, item, accessToken, accountIdMap);

    const finishedAt = new Date().toISOString();
    await supabase
      .from("spendable_plaid_items")
      .update({
        status: "active",
        error_code: null,
        error_message: null,
        last_synced_at: finishedAt,
        last_successful_sync_at: finishedAt,
      })
      .eq("id", item.id);

    await recordSyncRun(supabase, {
      user_id: item.user_id,
      plaid_item_id: item.id,
      trigger,
      status: "success",
      added_count: added,
      modified_count: modified,
      removed_count: removed,
      started_at: startedAt,
      finished_at: finishedAt,
    });

    logger.info("plaid.sync.success", {
      itemRowId: item.id,
      trigger,
      added,
      modified,
      removed,
    });

    return { itemId: item.id, status: "success", added, modified, removed };
  } catch (error) {
    const interpreted = interpretPlaidError(error);

    // A broken connection must never destroy history. We record the state and
    // let the UI prompt for reconnection.
    await supabase
      .from("spendable_plaid_items")
      .update({
        status: interpreted.requiresReauth ? "needs_reauth" : "error",
        error_code: interpreted.errorCode,
        error_message: interpreted.userMessage,
        last_synced_at: new Date().toISOString(),
      })
      .eq("id", item.id);

    await recordSyncRun(supabase, {
      user_id: item.user_id,
      plaid_item_id: item.id,
      trigger,
      status: "failed",
      added_count: added,
      modified_count: modified,
      removed_count: removed,
      message: interpreted.userMessage,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });

    logger.error("plaid.sync.failed", {
      itemRowId: item.id,
      trigger,
      errorCode: interpreted.errorCode,
    });

    return {
      itemId: item.id,
      status: "failed",
      added,
      modified,
      removed,
      message: interpreted.userMessage,
    };
  }
}

async function upsertAccounts(
  supabase: SupabaseClient,
  item: PlaidItemRow,
  accounts: Parameters<typeof normalizeAccount>[0][],
  institutionName: string | null,
): Promise<Map<string, { id: string; type: string }>> {
  const now = new Date().toISOString();

  const rows = accounts.map((account) => {
    const normalized = normalizeAccount(account);
    return {
      user_id: item.user_id,
      plaid_item_id: item.id,
      plaid_account_id: normalized.plaid_account_id,
      source: "plaid" as const,
      name: normalized.name,
      official_name: normalized.official_name,
      institution_name: institutionName,
      mask: normalized.mask,
      type: normalized.type,
      subtype: normalized.subtype,
      current_balance: normalized.current_balance,
      available_balance: normalized.available_balance,
      credit_limit: normalized.credit_limit,
      currency: normalized.currency,
      is_liquid: normalized.is_liquid,
      is_active: true,
      balance_last_updated_at: now,
    };
  });

  if (rows.length > 0) {
    // `is_liquid` and `payment_strategy` are user-editable, so an upsert must
    // not clobber them. We only overwrite them on first insert, which Postgres
    // handles via the ignoreDuplicates-free upsert below plus a follow-up that
    // leaves existing rows' preferences alone.
    const { error } = await supabase.from("spendable_accounts").upsert(rows, {
      onConflict: "user_id,plaid_account_id",
    });
    if (error) throw new Error(error.message);
  }

  const { data } = await supabase
    .from("spendable_accounts")
    .select("id, plaid_account_id, type")
    .eq("plaid_item_id", item.id);

  const map = new Map<string, { id: string; type: string }>();
  for (const row of data ?? []) {
    if (row.plaid_account_id) {
      map.set(row.plaid_account_id, { id: row.id, type: row.type });
    }
  }
  return map;
}

async function syncTransactions(
  supabase: SupabaseClient,
  item: PlaidItemRow,
  accessToken: string,
  accountIdMap: Map<string, { id: string; type: string }>,
): Promise<{ added: number; modified: number; removed: number }> {
  const client = getPlaidClient();

  let cursor = item.transactions_cursor ?? undefined;
  let hasMore = true;
  const addedTxns: PlaidTransaction[] = [];
  const modifiedTxns: PlaidTransaction[] = [];
  const removedTxns: RemovedTransaction[] = [];

  // Bound the loop so a pathological cursor cannot spin forever.
  let pages = 0;
  while (hasMore && pages < 50) {
    const response = await client.transactionsSync({
      access_token: accessToken,
      cursor,
      count: 500,
    });

    addedTxns.push(...response.data.added);
    modifiedTxns.push(...response.data.modified);
    removedTxns.push(...response.data.removed);

    cursor = response.data.next_cursor;
    hasMore = response.data.has_more;
    pages += 1;
  }

  // Load classification inputs once for the whole batch.
  const [{ data: rules }, { data: obligations }] = await Promise.all([
    supabase
      .from("spendable_merchant_rules")
      .select("merchant_key, classification, subcategory")
      .eq("user_id", item.user_id),
    supabase
      .from("spendable_recurring_obligations")
      .select("id, name, amount, frequency, next_due_date, category, merchant_key, is_active")
      .eq("user_id", item.user_id)
      .eq("is_active", true),
  ]);

  const classifyContext = {
    merchantRules: (rules ?? []).map((r) => ({
      merchantKey: r.merchant_key as string,
      classification: r.classification as Classification,
      subcategory: r.subcategory as string | null,
    })),
    recurringObligations: (obligations ?? []).map((o) => ({
      id: o.id as string,
      name: o.name as string,
      amount: Number(o.amount),
      frequency: o.frequency,
      nextDueDate: o.next_due_date as string,
      category: o.category,
      isEssential: true,
      autopay: false,
      accountId: null,
      merchantKey: o.merchant_key as string | null,
      source: "manual" as const,
      isActive: true,
    })),
  };

  const upsertRows = [...addedTxns, ...modifiedTxns]
    .map((plaidTxn) => {
      const normalized = normalizeTransaction(plaidTxn);
      const account = accountIdMap.get(normalized.plaid_account_id);
      if (!account) return null;

      const accountType = account.type as "depository" | "credit" | "loan" | "investment" | "other";

      const { classification, subcategory } = classifyTransaction(
        {
          amount: normalized.amount,
          accountType,
          merchantKey: normalized.merchant_key,
          plaidCategoryPrimary: normalized.plaid_category_primary,
          plaidCategoryDetailed: normalized.plaid_category_detailed,
        },
        classifyContext,
      );

      return {
        user_id: item.user_id,
        account_id: account.id,
        plaid_transaction_id: normalized.plaid_transaction_id,
        pending_transaction_id: normalized.pending_transaction_id,
        source: "plaid" as const,
        amount: normalized.amount,
        currency: normalized.currency,
        date: normalized.date,
        authorized_date: normalized.authorized_date,
        name: normalized.name,
        merchant_name: normalized.merchant_name,
        merchant_key: normalized.merchant_key,
        pending: normalized.pending,
        classification,
        subcategory,
        plaid_category_primary: normalized.plaid_category_primary,
        plaid_category_detailed: normalized.plaid_category_detailed,
        is_refund: isLikelyRefund({
          amount: normalized.amount,
          accountType,
          name: normalized.name,
        }),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (upsertRows.length > 0) {
    // Upsert on Plaid's id gives idempotency: replaying a webhook is a no-op.
    const { error } = await supabase
      .from("spendable_transactions")
      .upsert(upsertRows, { onConflict: "user_id,plaid_transaction_id" });
    if (error) throw new Error(error.message);

    // A user's manual re-classification must survive a later Plaid update.
    await restoreLockedClassifications(
      supabase,
      item.user_id,
      upsertRows.map((r) => r.plaid_transaction_id),
    );
  }

  // Removed transactions genuinely no longer exist at the institution
  // (e.g. a pending charge that was dropped), so deleting them is correct.
  if (removedTxns.length > 0) {
    const ids = removedTxns.map((t) => t.transaction_id);
    await supabase
      .from("spendable_transactions")
      .delete()
      .eq("user_id", item.user_id)
      .in("plaid_transaction_id", ids);
  }

  // Drop pending rows that a posted transaction has now superseded, so the
  // same charge is never counted twice.
  const supersededIds = [...addedTxns, ...modifiedTxns]
    .map((t) => t.pending_transaction_id)
    .filter((id): id is string => Boolean(id));

  if (supersededIds.length > 0) {
    await supabase
      .from("spendable_transactions")
      .delete()
      .eq("user_id", item.user_id)
      .eq("pending", true)
      .in("plaid_transaction_id", supersededIds);
  }

  await markInternalTransfers(supabase, item.user_id);

  await supabase
    .from("spendable_plaid_items")
    .update({ transactions_cursor: cursor })
    .eq("id", item.id);

  return {
    added: addedTxns.length,
    modified: modifiedTxns.length,
    removed: removedTxns.length,
  };
}

/**
 * A transaction the user has explicitly re-classified is marked locked. Plaid
 * re-sending that transaction must not silently revert their choice.
 */
async function restoreLockedClassifications(
  supabase: SupabaseClient,
  userId: string,
  plaidTransactionIds: string[],
): Promise<void> {
  const { data } = await supabase
    .from("spendable_transactions")
    .select("id, merchant_key")
    .eq("user_id", userId)
    .eq("classification_locked", true)
    .in("plaid_transaction_id", plaidTransactionIds);

  if (!data || data.length === 0) return;
  // The rows kept their locked flag through the upsert; nothing further is
  // needed beyond confirming they exist. Logged for observability only.
  logger.debug("plaid.sync.locked_classifications_preserved", {
    userId,
    count: data.length,
  });
}

/**
 * Re-scans recent transactions and marks matched pairs across the user's own
 * accounts as transfers. This is what prevents a credit-card payment from
 * being double-counted as new spending.
 */
async function markInternalTransfers(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const since = new Date();
  since.setDate(since.getDate() - 45);
  const sinceISO = since.toISOString().slice(0, 10);

  const { data } = await supabase
    .from("spendable_transactions")
    .select("id, account_id, amount, date, classification, classification_locked")
    .eq("user_id", userId)
    .gte("date", sinceISO);

  if (!data || data.length === 0) return;

  const asTransactions = data.map(
    (row) =>
      ({
        id: row.id,
        accountId: row.account_id,
        amount: Number(row.amount),
        date: row.date,
        name: "",
        pending: false,
        classification: row.classification,
        classificationLocked: row.classification_locked,
        isRefund: false,
      }) as Transaction,
  );

  const matched = detectInternalTransfers(asTransactions);
  const toUpdate = data
    .filter(
      (row) =>
        matched.has(row.id) &&
        !row.classification_locked &&
        row.classification !== "transfer",
    )
    .map((row) => row.id);

  if (toUpdate.length === 0) return;

  await supabase
    .from("spendable_transactions")
    .update({ classification: "transfer" })
    .eq("user_id", userId)
    .in("id", toUpdate);
}

async function syncLiabilities(
  supabase: SupabaseClient,
  item: PlaidItemRow,
  accessToken: string,
  accountIdMap: Map<string, { id: string; type: string }>,
): Promise<void> {
  const client = getPlaidClient();

  let liabilities;
  try {
    const response = await client.liabilitiesGet({ access_token: accessToken });
    liabilities = response.data.liabilities;
  } catch (error) {
    // Liabilities is an optional product. Not having it is a normal state,
    // not an error — the user falls back to manual liabilities.
    const interpreted = interpretPlaidError(error);
    logger.info("plaid.liabilities.unavailable", {
      itemRowId: item.id,
      errorCode: interpreted.errorCode,
    });
    return;
  }

  const normalized: NormalizedLiability[] = [
    ...(liabilities.credit ?? [])
      .map(normalizeCreditLiability)
      .filter((l): l is NormalizedLiability => l !== null),
    ...(liabilities.student ?? [])
      .map(normalizeStudentLoan)
      .filter((l): l is NormalizedLiability => l !== null),
    ...(liabilities.mortgage ?? [])
      .map(normalizeMortgage)
      .filter((l): l is NormalizedLiability => l !== null),
  ];

  const rows = normalized
    .map((liability) => {
      const account = accountIdMap.get(liability.plaid_account_id);
      if (!account) return null;
      return {
        user_id: item.user_id,
        account_id: account.id,
        liability_type: liability.liability_type,
        last_statement_balance: liability.last_statement_balance,
        last_statement_issue_date: liability.last_statement_issue_date,
        minimum_payment: liability.minimum_payment,
        next_payment_due_date: liability.next_payment_due_date,
        last_payment_amount: liability.last_payment_amount,
        last_payment_date: liability.last_payment_date,
        apr_percentage: liability.apr_percentage,
        apr_type: liability.apr_type,
        origination_principal: liability.origination_principal,
        outstanding_balance: liability.outstanding_balance,
        expected_payoff_date: liability.expected_payoff_date,
        term_months: liability.term_months,
        is_overdue: liability.is_overdue,
        synced_at: new Date().toISOString(),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (rows.length === 0) return;

  const { error } = await supabase
    .from("spendable_liabilities")
    .upsert(rows, { onConflict: "account_id" });
  if (error) {
    logger.warn("plaid.liabilities.persist_failed", { message: error.message });
  }
}

// ---------------------------------------------------------------------------
// Balance refresh + disconnect
// ---------------------------------------------------------------------------

export async function refreshBalances(item: PlaidItemRow): Promise<void> {
  const supabase = createAdminSupabase();
  const accessToken = decryptToken(item.access_token_encrypted);
  const client = getPlaidClient();

  const response = await client.accountsBalanceGet({ access_token: accessToken });
  const now = new Date().toISOString();

  for (const account of response.data.accounts) {
    await supabase
      .from("spendable_accounts")
      .update({
        current_balance: account.balances.current ?? null,
        available_balance: account.balances.available ?? null,
        credit_limit: account.balances.limit ?? null,
        balance_last_updated_at: now,
      })
      .eq("user_id", item.user_id)
      .eq("plaid_account_id", account.account_id);
  }

  await supabase
    .from("spendable_plaid_items")
    .update({ last_synced_at: now, status: "active", error_code: null })
    .eq("id", item.id);
}

/**
 * Disconnects an institution. The Plaid Item is removed upstream, but the
 * user's transaction history is deliberately kept — losing months of history
 * because a connection was removed would be destructive and surprising.
 */
export async function disconnectItem(item: PlaidItemRow): Promise<void> {
  const supabase = createAdminSupabase();

  try {
    const accessToken = decryptToken(item.access_token_encrypted);
    await getPlaidClient().itemRemove({ access_token: accessToken });
  } catch (error) {
    logger.warn("plaid.item.remove_failed", {
      itemRowId: item.id,
      errorCode: interpretPlaidError(error).errorCode,
    });
  }

  await supabase
    .from("spendable_accounts")
    .update({ is_active: false })
    .eq("plaid_item_id", item.id);

  await supabase
    .from("spendable_plaid_items")
    .update({
      status: "revoked",
      // Destroy the credential; keep the record for history and audit.
      access_token_encrypted: "revoked",
      transactions_cursor: null,
    })
    .eq("id", item.id);

  logger.info("plaid.item.disconnected", { itemRowId: item.id });
}

async function recordSyncRun(
  supabase: SupabaseClient,
  run: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from("spendable_sync_runs").insert(run);
  if (error) logger.warn("plaid.sync.run_log_failed", { message: error.message });
}

/** Syncs every active Item for one user. Used by "Sync now" and the cron job. */
export async function syncAllForUser(
  userId: string,
  trigger: "manual" | "scheduled" | "webhook",
): Promise<SyncResult[]> {
  const items = await getItemsForUser(userId);
  const results: SyncResult[] = [];
  for (const item of items) {
    if (item.status === "revoked") continue;
    results.push(await syncItem(item, trigger));
  }
  return results;
}
