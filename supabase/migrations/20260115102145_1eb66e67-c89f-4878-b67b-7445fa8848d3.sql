-- Drop existing problematic policies
DROP POLICY IF EXISTS "Users can view conversation members" ON conversation_members;
DROP POLICY IF EXISTS "Users can add members to conversations" ON conversation_members;

-- Recreate SELECT policy with correct logic (fix infinite recursion)
CREATE POLICY "Users can view conversation members" 
ON conversation_members FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM conversation_members cm 
    WHERE cm.conversation_id = conversation_members.conversation_id 
    AND cm.user_id = auth.uid()
  )
);

-- Recreate INSERT policy with correct logic
CREATE POLICY "Users can add members to conversations" 
ON conversation_members FOR INSERT
WITH CHECK (
  auth.uid() = user_id 
  OR EXISTS (
    SELECT 1 FROM conversation_members cm 
    WHERE cm.conversation_id = conversation_members.conversation_id 
    AND cm.user_id = auth.uid()
  )
);