import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './useAuth';
import { api } from '@/lib/api';

export interface Reaction {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

export interface ReactionGroup {
  emoji: string;
  count: number;
  userIds: string[];
  hasReacted: boolean;
}

/**
 * useReactions hook - Manages message reactions
 * 
 * Refactored to use API Gateway instead of Supabase realtime.
 * Reactions are fetched via API and updated via polling.
 */
export function useReactions(conversationId: string | null) {
  const { user } = useAuth();
  const [reactions, setReactions] = useState<Map<string, Reaction[]>>(new Map());
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastFetchedMessageIds = useRef<string[]>([]);

  const fetchReactions = useCallback(async (messageIds: string[]) => {
    if (!messageIds.length) return;

    // Store for polling
    lastFetchedMessageIds.current = messageIds;

    try {
      const response = await api.reactions.getForMessages(messageIds);

      if (!response.ok || !response.data) {
        console.error('[useReactions] Error fetching:', response.error);
        return;
      }

      const reactionMap = new Map<string, Reaction[]>();
      (response.data.reactions || []).forEach((r: Reaction) => {
        const existing = reactionMap.get(r.message_id) || [];
        reactionMap.set(r.message_id, [...existing, r]);
      });

      setReactions(reactionMap);
    } catch (error) {
      console.error('[useReactions] Fetch error:', error);
    }
  }, []);

  // Setup polling for reaction updates
  useEffect(() => {
    if (!conversationId) return;

    // Poll for reaction updates every 5 seconds
    pollIntervalRef.current = setInterval(async () => {
      if (lastFetchedMessageIds.current.length > 0) {
        await fetchReactions(lastFetchedMessageIds.current);
      }
    }, 5000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [conversationId, fetchReactions]);

  const toggleReaction = async (messageId: string, emoji: string) => {
    if (!user) return;

    const messageReactions = reactions.get(messageId) || [];
    const existingReaction = messageReactions.find(
      r => r.emoji === emoji && r.user_id === user.id
    );

    if (existingReaction) {
      // Optimistic update - remove immediately
      setReactions(prev => {
        const updated = new Map(prev);
        const existing = updated.get(messageId) || [];
        updated.set(messageId, existing.filter(r => r.id !== existingReaction.id));
        return updated;
      });

      // Then delete via API
      try {
        const response = await api.reactions.remove(existingReaction.id);
        if (!response.ok) {
          console.error('[useReactions] Error removing:', response.error);
          // Rollback on error
          fetchReactions([messageId]);
        }
      } catch (error) {
        console.error('[useReactions] Remove error:', error);
        fetchReactions([messageId]);
      }
    } else {
      // Optimistic update - add immediately with temp ID
      const tempReaction: Reaction = {
        id: `temp-${Date.now()}`,
        message_id: messageId,
        user_id: user.id,
        emoji,
        created_at: new Date().toISOString(),
      };
      
      setReactions(prev => {
        const updated = new Map(prev);
        const existing = updated.get(messageId) || [];
        updated.set(messageId, [...existing, tempReaction]);
        return updated;
      });

      // Then add via API
      try {
        const response = await api.reactions.add(messageId, emoji);
        if (!response.ok) {
          console.error('[useReactions] Error adding:', response.error);
          // Rollback on error
          setReactions(prev => {
            const updated = new Map(prev);
            const existing = updated.get(messageId) || [];
            updated.set(messageId, existing.filter(r => r.id !== tempReaction.id));
            return updated;
          });
        } else if (response.data) {
          // Replace temp with real reaction
          setReactions(prev => {
            const updated = new Map(prev);
            const existing = updated.get(messageId) || [];
            updated.set(messageId, existing.map(r => 
              r.id === tempReaction.id ? { ...r, id: response.data!.id } : r
            ));
            return updated;
          });
        }
      } catch (error) {
        console.error('[useReactions] Add error:', error);
        setReactions(prev => {
          const updated = new Map(prev);
          const existing = updated.get(messageId) || [];
          updated.set(messageId, existing.filter(r => r.id !== tempReaction.id));
          return updated;
        });
      }
    }
  };

  const getReactionGroups = (messageId: string): ReactionGroup[] => {
    const messageReactions = reactions.get(messageId) || [];
    const groups = new Map<string, { count: number; userIds: string[] }>();

    messageReactions.forEach(r => {
      const existing = groups.get(r.emoji) || { count: 0, userIds: [] };
      groups.set(r.emoji, {
        count: existing.count + 1,
        userIds: [...existing.userIds, r.user_id],
      });
    });

    return Array.from(groups.entries()).map(([emoji, data]) => ({
      emoji,
      count: data.count,
      userIds: data.userIds,
      hasReacted: user ? data.userIds.includes(user.id) : false,
    }));
  };

  return {
    reactions,
    fetchReactions,
    toggleReaction,
    getReactionGroups,
  };
}
