-- ============================================================================
-- Spendable — Row Level Security
-- ============================================================================
-- Every Spendable table is user-owned. RLS is enabled on all of them and the
-- policy is uniform: a row is visible and writable only by the user whose id
-- matches `user_id`. A user can never reach another user's records, including
-- through joins, because the policy is enforced per-table.
--
-- The service-role key bypasses RLS by design. It is used only by server-side
-- code that has already authenticated the user and that scopes every query by
-- user_id itself (Plaid webhook handling and the scheduled sync job).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Generic owner policy applied to every user-owned table
-- ---------------------------------------------------------------------------
do $$
declare
  tbl text;
  owned_tables text[] := array[
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

    execute format('drop policy if exists %I on public.%I', tbl || '_select_own', tbl);
    execute format(
      'create policy %I on public.%I for select to authenticated using (auth.uid() = user_id)',
      tbl || '_select_own', tbl
    );

    execute format('drop policy if exists %I on public.%I', tbl || '_insert_own', tbl);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (auth.uid() = user_id)',
      tbl || '_insert_own', tbl
    );

    execute format('drop policy if exists %I on public.%I', tbl || '_update_own', tbl);
    execute format(
      'create policy %I on public.%I for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      tbl || '_update_own', tbl
    );

    execute format('drop policy if exists %I on public.%I', tbl || '_delete_own', tbl);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (auth.uid() = user_id)',
      tbl || '_delete_own', tbl
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles keys on user_id directly (no separate id column)
-- ---------------------------------------------------------------------------
alter table public.spendable_profiles enable row level security;
alter table public.spendable_profiles force row level security;

drop policy if exists spendable_profiles_select_own on public.spendable_profiles;
create policy spendable_profiles_select_own on public.spendable_profiles
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists spendable_profiles_insert_own on public.spendable_profiles;
create policy spendable_profiles_insert_own on public.spendable_profiles
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists spendable_profiles_update_own on public.spendable_profiles;
create policy spendable_profiles_update_own on public.spendable_profiles
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists spendable_profiles_delete_own on public.spendable_profiles;
create policy spendable_profiles_delete_own on public.spendable_profiles
  for delete to authenticated using (auth.uid() = user_id);

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

-- ---------------------------------------------------------------------------
-- Auto-provision a profile row when a user signs up, so the app always has
-- planning assumptions to read.
-- ---------------------------------------------------------------------------
create or replace function public.spendable_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.spendable_profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists spendable_on_auth_user_created on auth.users;
create trigger spendable_on_auth_user_created
  after insert on auth.users
  for each row execute function public.spendable_handle_new_user();
