-- Create security definer function to check conversation membership
CREATE OR REPLACE FUNCTION public.is_conversation_member(
  _conversation_id uuid, 
  _user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM conversation_members
    WHERE conversation_id = _conversation_id
    AND user_id = _user_id
  )
$$;

-- Create security definer function to get user's conversation IDs
CREATE OR REPLACE FUNCTION public.get_user_conversation_ids(_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT conversation_id FROM conversation_members
  WHERE user_id = _user_id
$$;

-- Fix conversation_members RLS policies
DROP POLICY IF EXISTS "Users can view conversation members" ON conversation_members;
DROP POLICY IF EXISTS "Users can add members to conversations" ON conversation_members;

CREATE POLICY "Users can view conversation members" 
ON conversation_members FOR SELECT
USING (
  public.is_conversation_member(conversation_id, auth.uid())
);

CREATE POLICY "Users can add members to conversations" 
ON conversation_members FOR INSERT
WITH CHECK (
  auth.uid() = user_id 
  OR public.is_conversation_member(conversation_id, auth.uid())
);

-- Fix conversations RLS policies
DROP POLICY IF EXISTS "Users can view their conversations" ON conversations;
DROP POLICY IF EXISTS "Members can update conversations" ON conversations;

CREATE POLICY "Users can view their conversations" 
ON conversations FOR SELECT
USING (
  id IN (SELECT public.get_user_conversation_ids(auth.uid()))
);

CREATE POLICY "Members can update conversations" 
ON conversations FOR UPDATE
USING (
  public.is_conversation_member(id, auth.uid())
);