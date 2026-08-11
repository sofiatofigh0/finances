-- ============================================================================
-- Spendable — Row Level Security, as plain statements
-- ============================================================================
-- Identical in effect to 20260101000001_spendable_rls.sql, which expresses the
-- same thing as a loop. This flattened copy exists because the loop form gives
-- one all-or-nothing result when pasted into the Supabase SQL editor: if it is
-- refused, nothing is applied and nothing indicates which table was the
-- problem. Here each statement stands alone and reports for itself.
--
-- Safe to run more than once.
-- ============================================================================


alter table public.spendable_profiles enable row level security;
alter table public.spendable_profiles force row level security;
drop policy if exists spendable_profiles_owner on public.spendable_profiles;
create policy spendable_profiles_owner on public.spendable_profiles
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.spendable_plaid_items enable row level security;
alter table public.spendable_plaid_items force row level security;
drop policy if exists spendable_plaid_items_owner on public.spendable_plaid_items;
create policy spendable_plaid_items_owner on public.spendable_plaid_items
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.spendable_accounts enable row level security;
alter table public.spendable_accounts force row level security;
drop policy if exists spendable_accounts_owner on public.spendable_accounts;
create policy spendable_accounts_owner on public.spendable_accounts
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.spendable_transactions enable row level security;
alter table public.spendable_transactions force row level security;
drop policy if exists spendable_transactions_owner on public.spendable_transactions;
create policy spendable_transactions_owner on public.spendable_transactions
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.spendable_liabilities enable row level security;
alter table public.spendable_liabilities force row level security;
drop policy if exists spendable_liabilities_owner on public.spendable_liabilities;
create policy spendable_liabilities_owner on public.spendable_liabilities
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.spendable_manual_liabilities enable row level security;
alter table public.spendable_manual_liabilities force row level security;
drop policy if exists spendable_manual_liabilities_owner on public.spendable_manual_liabilities;
create policy spendable_manual_liabilities_owner on public.spendable_manual_liabilities
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.spendable_recurring_obligations enable row level security;
alter table public.spendable_recurring_obligations force row level security;
drop policy if exists spendable_recurring_obligations_owner on public.spendable_recurring_obligations;
create policy spendable_recurring_obligations_owner on public.spendable_recurring_obligations
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.spendable_recurring_candidates enable row level security;
alter table public.spendable_recurring_candidates force row level security;
drop policy if exists spendable_recurring_candidates_owner on public.spendable_recurring_candidates;
create policy spendable_recurring_candidates_owner on public.spendable_recurring_candidates
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.spendable_merchant_rules enable row level security;
alter table public.spendable_merchant_rules force row level security;
drop policy if exists spendable_merchant_rules_owner on public.spendable_merchant_rules;
create policy spendable_merchant_rules_owner on public.spendable_merchant_rules
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.spendable_income_sources enable row level security;
alter table public.spendable_income_sources force row level security;
drop policy if exists spendable_income_sources_owner on public.spendable_income_sources;
create policy spendable_income_sources_owner on public.spendable_income_sources
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.spendable_goals enable row level security;
alter table public.spendable_goals force row level security;
drop policy if exists spendable_goals_owner on public.spendable_goals;
create policy spendable_goals_owner on public.spendable_goals
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.spendable_monthly_plans enable row level security;
alter table public.spendable_monthly_plans force row level security;
drop policy if exists spendable_monthly_plans_owner on public.spendable_monthly_plans;
create policy spendable_monthly_plans_owner on public.spendable_monthly_plans
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.spendable_planned_expenses enable row level security;
alter table public.spendable_planned_expenses force row level security;
drop policy if exists spendable_planned_expenses_owner on public.spendable_planned_expenses;
create policy spendable_planned_expenses_owner on public.spendable_planned_expenses
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.spendable_financial_snapshots enable row level security;
alter table public.spendable_financial_snapshots force row level security;
drop policy if exists spendable_financial_snapshots_owner on public.spendable_financial_snapshots;
create policy spendable_financial_snapshots_owner on public.spendable_financial_snapshots
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.spendable_agent_threads enable row level security;
alter table public.spendable_agent_threads force row level security;
drop policy if exists spendable_agent_threads_owner on public.spendable_agent_threads;
create policy spendable_agent_threads_owner on public.spendable_agent_threads
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.spendable_agent_messages enable row level security;
alter table public.spendable_agent_messages force row level security;
drop policy if exists spendable_agent_messages_owner on public.spendable_agent_messages;
create policy spendable_agent_messages_owner on public.spendable_agent_messages
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.spendable_sync_runs enable row level security;
alter table public.spendable_sync_runs force row level security;
drop policy if exists spendable_sync_runs_owner on public.spendable_sync_runs;
create policy spendable_sync_runs_owner on public.spendable_sync_runs
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- The encrypted Plaid access token must never be selectable by the browser,
-- even by the row's owner. Column-level grants enforce that independently of
-- RLS. Writes to this table go through the service-role client, which is why
-- no insert grant is needed here.
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
