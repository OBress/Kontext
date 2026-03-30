-- Fix infinite recursion in team_members RLS policies.
-- The "Users see co-members" policy queries team_members from within
-- a team_members policy, causing infinite recursion.
-- Same issue exists in the INSERT, UPDATE, and DELETE policies.

-- Step 1: Drop all recursive policies
DROP POLICY IF EXISTS "Users see co-members" ON public.team_members;
DROP POLICY IF EXISTS "Owners/admins manage team" ON public.team_members;
DROP POLICY IF EXISTS "Owners/admins update team" ON public.team_members;
DROP POLICY IF EXISTS "Owners/admins delete team" ON public.team_members;
DROP POLICY IF EXISTS "Users see own memberships" ON public.team_members;

-- Step 2: Recreate non-recursive policies.
-- The key insight: use auth.uid() directly instead of subquerying team_members.

-- SELECT: Users can see their own memberships (covers both "own" and "co-members")
CREATE POLICY "Users see own memberships" ON public.team_members
  FOR SELECT USING (auth.uid() = user_id);

-- SELECT: Users can see other members of repos they belong to.
-- Use a security definer function to avoid RLS recursion.
CREATE OR REPLACE FUNCTION public.user_is_team_member(p_repo text, p_user uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE repo_full_name = p_repo AND user_id = p_user
  );
$$;

CREATE POLICY "Users see co-members" ON public.team_members
  FOR SELECT USING (
    public.user_is_team_member(repo_full_name, auth.uid())
  );

-- Helper: check if user is owner/admin of a repo (security definer to avoid recursion)
CREATE OR REPLACE FUNCTION public.user_is_team_admin(p_repo text, p_user uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE repo_full_name = p_repo
      AND user_id = p_user
      AND role IN ('owner', 'admin')
  );
$$;

-- INSERT: owners/admins can add members, OR user can add themselves
CREATE POLICY "Owners/admins manage team" ON public.team_members
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    OR public.user_is_team_admin(repo_full_name, auth.uid())
  );

-- UPDATE: only owners/admins
CREATE POLICY "Owners/admins update team" ON public.team_members
  FOR UPDATE USING (
    public.user_is_team_admin(repo_full_name, auth.uid())
  );

-- DELETE: user can remove themselves, or owners/admins can remove others
CREATE POLICY "Owners/admins delete team" ON public.team_members
  FOR DELETE USING (
    auth.uid() = user_id
    OR public.user_is_team_admin(repo_full_name, auth.uid())
  );
