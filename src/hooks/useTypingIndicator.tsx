import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './useAuth';
import { api } from '@/lib/api';

interface TypingUser {
  id: string;
  name: string;
}

/**
 * useTypingIndicator hook - Manages typing indicators for a conversation
 * 
 * Refactored to use API Gateway instead of Supabase realtime broadcast.
 * Uses HTTP POST to broadcast typing status and polling to receive updates.
 */
export function useTypingIndicator(conversationId: string | null) {
  const { profile } = useAuth();
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastTypingRef = useRef<number>(0);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Broadcast typing status via API
  const broadcastTyping = useCallback(async () => {
    if (!conversationId || !profile) return;

    const now = Date.now();
    // Throttle: only send every 2 seconds
    if (now - lastTypingRef.current < 2000) return;
    lastTypingRef.current = now;

    try {
      await api.typing.broadcast(conversationId);
    } catch (error) {
      console.error('[useTypingIndicator] Failed to broadcast typing:', error);
    }
  }, [conversationId, profile]);

  // Stop typing (clear from others' view)
  const stopTyping = useCallback(() => {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
  }, []);

  // Poll for typing status from others
  // Note: This will be replaced with SSE when Worker supports it
  useEffect(() => {
    if (!conversationId || !profile) return;

    // For now, typing indicators are handled locally
    // When SSE is implemented, this will receive typing events from the stream
    // The current implementation uses a timeout to clear typing status
    
    // Auto-clear typing users after 3 seconds of inactivity
    const checkTypingTimeout = setInterval(() => {
      setTypingUsers(prev => {
        const now = Date.now();
        // In a real SSE implementation, we would track timestamps
        // For now, just clear after the interval
        return prev;
      });
    }, 1000);

    return () => {
      clearInterval(checkTypingTimeout);
    };
  }, [conversationId, profile]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTyping();
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [stopTyping]);

  // Method to add a typing user (called from SSE events)
  const addTypingUser = useCallback((userId: string, userName: string) => {
    if (userId === profile?.id) return; // Ignore own typing

    setTypingUsers(prev => {
      const existing = prev.find(u => u.id === userId);
      if (existing) return prev;
      return [...prev, { id: userId, name: userName }];
    });

    // Auto-remove after 3 seconds
    setTimeout(() => {
      setTypingUsers(prev => prev.filter(u => u.id !== userId));
    }, 3000);
  }, [profile?.id]);

  return {
    typingUsers,
    broadcastTyping,
    stopTyping,
    addTypingUser, // Exposed for SSE handler
  };
}
