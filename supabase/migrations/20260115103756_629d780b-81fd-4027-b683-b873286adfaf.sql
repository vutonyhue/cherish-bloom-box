-- Create function to get user conversations with full details (bypasses RLS)
CREATE OR REPLACE FUNCTION public.get_user_conversations(_user_id uuid)
RETURNS TABLE (
  id uuid,
  name text,
  is_group boolean,
  avatar_url text,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  members jsonb,
  last_message jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id,
    c.name,
    c.is_group,
    c.avatar_url,
    c.created_by,
    c.created_at,
    c.updated_at,
    (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'user_id', cm.user_id,
          'role', cm.role,
          'joined_at', cm.joined_at,
          'profile', jsonb_build_object(
            'id', p.id,
            'username', p.username,
            'display_name', p.display_name,
            'avatar_url', p.avatar_url,
            'status', p.status,
            'last_seen', p.last_seen
          )
        )
      ), '[]'::jsonb)
      FROM conversation_members cm
      LEFT JOIN profiles p ON p.id = cm.user_id
      WHERE cm.conversation_id = c.id
    ) as members,
    (
      SELECT jsonb_build_object(
        'id', m.id,
        'content', m.content,
        'message_type', m.message_type,
        'created_at', m.created_at,
        'sender_id', m.sender_id
      )
      FROM messages m
      WHERE m.conversation_id = c.id
        AND m.is_deleted = false
      ORDER BY m.created_at DESC
      LIMIT 1
    ) as last_message
  FROM conversations c
  WHERE c.id IN (
    SELECT conversation_id 
    FROM conversation_members 
    WHERE user_id = _user_id
  )
  ORDER BY c.updated_at DESC;
END;
$$;