-- ============================================================================
-- Spendable — Row Level Security
-- ============================================================================
-- Every Spendable table is user-owned. RLS is enabled on all of them and the
-- rule is uniform: a row is visible and writable only by the user whose id
-- matches `user_id`. A user can never reach another user's records, including
-- through joins, because the policy is enforced per-table.
--
-- One FOR ALL policy per table covers select/insert/update/delete, which keeps
-- this migration to a small number of statements — easier to apply by hand and
-- easier to verify.
--
-- The service-role key bypasses RLS by design. It is used only by server-side
-- code that has already authenticated the user and that scopes every query by
-- user_id itself (Plaid webhook handling and the scheduled sync job).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Owner-only access on every user-owned table
-- ---------------------------------------------------------------------------
do $$
declare
  tbl text;
  owned_tables text[] := array[
    'spendable_profiles',
    'spendable_plaid_items',
    'spendable_accounts',
    'spendable_transactions',
    'spendable_liabilities',
    'spendable_manual_liabilities',
    'spendable_recurring_obligations',
    'spendable_recurring_candidates',
    'spendable_merchant_rules',
    'spendable_income_sources',
    'spendable_goals',
    'spendable_monthly_plans',
    'spendable_planned_expenses',
    'spendable_financial_snapshots',
    'spendable_agent_threads',
    'spendable_agent_messages',
    'spendable_sync_runs'
  ];
begin
  foreach tbl in array owned_tables loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('alter table public.%I force row level security', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_owner', tbl);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      || 'using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      tbl || '_owner', tbl
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Hard guarantee: the encrypted Plaid access token is never selectable by the
-- browser, even for the row's owner. `anon` and `authenticated` get column
-- privileges on everything except that one column.
-- ---------------------------------------------------------------------------
revoke all on public.spendable_plaid_items from anon, authenticated;
grant select (
  id, user_id, plaid_item_id, institution_id, institution_name,
  available_products, billed_products, status, error_code, error_message,
  consent_expires_at, last_synced_at, last_successful_sync_at,
  created_at, updated_at
) on public.spendable_plaid_items to authenticated;
grant update (status, institution_name) on public.spendable_plaid_items to authenticated;
grant delete on public.spendable_plaid_items to authenticated;
