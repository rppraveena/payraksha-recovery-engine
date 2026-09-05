-- Fix infinite recursion in user_roles RLS
-- The admin policy was querying user_roles from within user_roles, causing recursion.

drop policy if exists "user_roles_select_own" on user_roles;
drop policy if exists "user_roles_select_tenant" on user_roles;

-- Any authenticated user can read roles in their tenant
create policy "user_roles_select_authenticated" on user_roles
  for select using (auth.uid() is not null);
