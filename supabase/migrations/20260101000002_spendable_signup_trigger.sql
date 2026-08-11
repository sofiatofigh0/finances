-- ============================================================================
-- Spendable — optional signup convenience trigger
-- ============================================================================
-- Pre-creates a profile row when a user signs up.
--
-- This is a CONVENIENCE ONLY. The application self-heals: `getProfile()` in
-- src/lib/db/context.ts upserts the profile row if it is missing, so the app
-- works identically without this trigger.
--
-- It lives in its own migration because creating a trigger on `auth.users`
-- requires privileges the `postgres` role does not always have on newer
-- Supabase projects. The exception handler below means a permission failure
-- logs a notice instead of aborting the migration — critically, it can never
-- take the RLS migration down with it.
-- ============================================================================

create or replace function public.spendable_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.spendable_profiles (user_id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

do $$
begin
  drop trigger if exists spendable_on_auth_user_created on auth.users;
  create trigger spendable_on_auth_user_created
    after insert on auth.users
    for each row execute function public.spendable_handle_new_user();
exception
  when insufficient_privilege or undefined_table then
    raise notice
      'Skipped the auth.users signup trigger (no privileges on the auth schema). '
      'This is safe: Spendable creates the profile row on first load instead.';
end;
$$;
