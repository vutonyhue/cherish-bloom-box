import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './useAuth';
import { Message, Profile } from '@/types';
import { api, API_BASE_URL, getAccessToken, createSSEConnection, createPollingConnection, SSEConnection } from '@/lib/api';
import { toast } from 'sonner';

/**
 * useMessages hook - Manages chat messages for a conversation
 * 
 * Refactored to use API Gateway with SSE for realtime updates.
 * Falls back to polling if SSE connection fails.
 */
export function useMessages(conversationId: string | null) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<Profile | null>(null);
  const [useSSE, setUseSSE] = useState(true); // Try SSE first
  const connectionRef = useRef<SSEConnection | null>(null);
  const lastFetchRef = useRef<string | null>(null);
  const sseFailCountRef = useRef(0);

  // Fetch current user profile for optimistic updates
  useEffect(() => {
    if (!user?.id) return;
    
    const fetchProfile = async () => {
      try {
        const response = await api.users.getProfile(user.id);
        if (response.ok && response.data) {
          setUserProfile({
            id: response.data.id,
            username: response.data.username,
            display_name: response.data.display_name,
            avatar_url: response.data.avatar_url,
            wallet_address: response.data.wallet_address,
            status: response.data.status || 'online',
            last_seen: response.data.last_seen || new Date().toISOString(),
            created_at: response.data.created_at || new Date().toISOString(),
            updated_at: response.data.updated_at || new Date().toISOString(),
          });
        }
      } catch (error) {
        console.error('Failed to fetch user profile:', error);
      }
    };
    
    fetchProfile();
  }, [user?.id]);

  const fetchMessages = useCallback(async () => {
    if (!conversationId || !user) {
      setMessages([]);
      setLoading(false);
      return;
    }

    // Prevent duplicate fetches
    if (lastFetchRef.current === conversationId && messages.length > 0) {
      // Just refresh without clearing
    } else {
      setLoading(true);
    }
    lastFetchRef.current = conversationId;

    try {
      const response = await api.messages.list(conversationId);

      if (!response.ok || !response.data) {
        console.error('[useMessages] Error fetching:', response.error);
        setLoading(false);
        return;
      }

      // Transform API response, attach reply_to references
      // Handle both array response and object with messages property
      const rawMessages = Array.isArray(response.data) 
        ? response.data 
        : (response.data as any)?.messages || [];
      
      const messageMap = new Map<string, Message>();
      rawMessages.forEach((m: any) => {
        const msg = {
          ...m,
          sender: m.sender as Profile | undefined,
        } as Message;
        messageMap.set(m.id, msg);
      });

      // Attach reply_to references
      const messagesWithReplies = rawMessages.map((m: any) => {
        const msg = messageMap.get(m.id)!;
        if (m.reply_to_id && messageMap.has(m.reply_to_id)) {
          msg.reply_to = messageMap.get(m.reply_to_id);
        }
        return msg;
      });

      setMessages(messagesWithReplies);
    } catch (error) {
      console.error('[useMessages] Fetch error:', error);
    } finally {
      setLoading(false);
    }
  }, [conversationId, user]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // Helper to handle incoming message from SSE
  const handleIncomingMessage = useCallback((msg: Message) => {
    setMessages(prev => {
      // Prevent duplicates
      if (prev.some(m => m.id === msg.id)) return prev;
      
      // Handle optimistic message confirmation
      const optimisticIdx = prev.findIndex(m => 
        m._sending && 
        m.content === msg.content && 
        m.sender_id === msg.sender_id
      );
      
      if (optimisticIdx > -1) {
        // Replace optimistic with real message
        const updated = [...prev];
        updated[optimisticIdx] = { ...msg, _sending: false, _failed: false };
        return updated;
      }
      
      // Add new message
      return [...prev, msg];
    });
  }, []);

  // Setup SSE or polling for realtime updates
  useEffect(() => {
    if (!conversationId || !user) return;

    // Close any existing connection
    connectionRef.current?.close();
    connectionRef.current = null;

    if (useSSE) {
      // Use SSE for realtime updates
      console.log('[useMessages] Setting up SSE connection');
      
      connectionRef.current = createSSEConnection(
        API_BASE_URL,
        conversationId,
        getAccessToken,
        {
          onMessage: (msg) => {
            console.log('[useMessages] SSE message received:', msg.id);
            handleIncomingMessage(msg);
            sseFailCountRef.current = 0; // Reset fail count on successful message
          },
          onTyping: (data) => {
            // Handle typing indicator (can be integrated with useTypingIndicator)
            console.log('[useMessages] Typing:', data);
          },
          onPresence: (data) => {
            // Handle presence updates
            console.log('[useMessages] Presence:', data);
          },
          onError: (error) => {
            console.error('[useMessages] SSE error:', error);
            sseFailCountRef.current++;
            
            // Fallback to polling after multiple SSE failures
            if (sseFailCountRef.current >= 3) {
              console.log('[useMessages] Falling back to polling');
              setUseSSE(false);
            }
          },
          onReconnect: () => {
            console.log('[useMessages] SSE reconnecting...');
          },
        }
      );
    } else {
      // Fallback: Use polling for realtime updates
      console.log('[useMessages] Using polling fallback');
      
      connectionRef.current = createPollingConnection(
        async () => {
          // Only fetch if we already have messages (to detect new ones)
          if (messages.length > 0) {
            const response = await api.messages.list(conversationId, { limit: 20 });
            if (response.ok && response.data) {
              // Handle both array response and object with messages property
              const newMessages = Array.isArray(response.data) 
                ? response.data 
                : (response.data as any)?.messages || [];
              
              setMessages(prev => {
                // Find truly new messages
                const existingIds = new Set(prev.map(m => m.id));
                const additions = newMessages.filter(m => !existingIds.has(m.id));
                
                if (additions.length > 0) {
                  // Add new messages, maintaining optimistic ones
                  const optimisticMessages = prev.filter(m => m._sending);
                  const serverMessages = prev.filter(m => !m._sending);
                  
                  // Merge: server messages + new additions + optimistic
                  const merged = [...serverMessages];
                  additions.forEach(newMsg => {
                    // Check if this is a server confirmation of an optimistic message
                    const matchingOptimistic = optimisticMessages.find(opt => 
                      opt.content === newMsg.content && 
                      opt.sender_id === newMsg.sender_id
                    );
                    
                    if (matchingOptimistic) {
                      // Replace optimistic with real
                      const idx = optimisticMessages.indexOf(matchingOptimistic);
                      if (idx > -1) optimisticMessages.splice(idx, 1);
                    }
                    
                    if (!merged.some(m => m.id === newMsg.id)) {
                      merged.push(newMsg as Message);
                    }
                  });
                  
                  return [...merged, ...optimisticMessages];
                }
                
                return prev;
              });
            }
          }
        },
        {
          onError: (error) => console.error('[useMessages] Polling error:', error),
        },
        3000 // Poll every 3 seconds
      );
    }

    return () => {
      connectionRef.current?.close();
      connectionRef.current = null;
    };
  }, [conversationId, user, useSSE, handleIncomingMessage, messages.length]);

  // Send message with OPTIMISTIC UPDATE
  const sendMessage = async (content: string, messageType = 'text', metadata = {}, replyToId?: string) => {
    if (!user || !conversationId) return { error: new Error('Not ready') };

    // Create temporary message for optimistic update
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();
    
    const tempMessage: Message = {
      id: tempId,
      conversation_id: conversationId,
      sender_id: user.id,
      content,
      message_type: messageType,
      metadata,
      created_at: now,
      updated_at: now,
      is_deleted: false,
      deleted_at: null,
      sender: userProfile || {
        id: user.id,
        username: user.email?.split('@')[0] || 'user',
        display_name: user.email?.split('@')[0] || 'User',
        avatar_url: null,
        wallet_address: null,
        status: 'online',
        last_seen: now,
        created_at: now,
        updated_at: now,
      },
      reply_to_id: replyToId || null,
      _sending: true,
    };

    // Add message to UI immediately (optimistic update)
    setMessages(prev => [...prev, tempMessage]);

    try {
      const response = await api.messages.send(conversationId, {
        content,
        message_type: messageType,
        metadata,
        reply_to_id: replyToId,
      });

      if (!response.ok) {
        // Mark message as failed
        setMessages(prev => 
          prev.map(m => m.id === tempId ? { ...m, _sending: false, _failed: true } : m)
        );
        toast.error(response.error?.message || 'Không thể gửi tin nhắn');
        return { error: new Error(response.error?.message || 'Failed to send message') };
      }

      // Replace temp message with real one from server
      setMessages(prev => 
        prev.map(m => 
          m.id === tempId 
            ? { 
                ...m,
                id: response.data!.id,
                created_at: response.data!.created_at,
                updated_at: response.data!.updated_at || response.data!.created_at,
                _sending: false,
                _failed: false,
              } 
            : m
        )
      );

      return { data: response.data, error: null };
    } catch (error: any) {
      // Mark message as failed
      setMessages(prev => 
        prev.map(m => m.id === tempId ? { ...m, _sending: false, _failed: true } : m)
      );
      toast.error('Lỗi kết nối, không thể gửi tin nhắn');
      return { error };
    }
  };

  const sendCryptoMessage = async (
    toUserId: string,
    amount: number,
    currency: string,
    txHash?: string
  ) => {
    if (!user || !conversationId) return { error: new Error('Not ready') };

    const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();
    
    const tempMessage: Message = {
      id: tempId,
      conversation_id: conversationId,
      sender_id: user.id,
      content: `Đã gửi ${amount} ${currency}`,
      message_type: 'crypto',
      metadata: { amount, currency, tx_hash: txHash },
      created_at: now,
      updated_at: now,
      is_deleted: false,
      deleted_at: null,
      sender: userProfile || undefined,
      _sending: true,
    };

    setMessages(prev => [...prev, tempMessage]);

    try {
      const response = await api.messages.sendCrypto(conversationId, {
        to_user_id: toUserId,
        amount,
        currency,
        tx_hash: txHash,
      });

      if (!response.ok) {
        setMessages(prev => 
          prev.map(m => m.id === tempId ? { ...m, _sending: false, _failed: true } : m)
        );
        toast.error(response.error?.message || 'Không thể gửi crypto');
        return { error: new Error(response.error?.message || 'Failed to send crypto message') };
      }

      setMessages(prev => 
        prev.map(m => 
          m.id === tempId 
            ? { ...m, id: response.data!.id, _sending: false }
            : m
        )
      );

      return { data: response.data, error: null };
    } catch (error: any) {
      setMessages(prev => 
        prev.map(m => m.id === tempId ? { ...m, _sending: false, _failed: true } : m)
      );
      return { error };
    }
  };

  const sendImageMessage = async (file: File, caption?: string) => {
    if (!user || !conversationId) return { error: new Error('Not ready') };

    const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();
    const tempUrl = URL.createObjectURL(file);
    
    const tempMessage: Message = {
      id: tempId,
      conversation_id: conversationId,
      sender_id: user.id,
      content: caption || 'Đã gửi hình ảnh',
      message_type: 'image',
      metadata: { 
        file_url: tempUrl, 
        file_name: file.name, 
        file_size: file.size,
        file_type: file.type,
        caption 
      },
      created_at: now,
      updated_at: now,
      is_deleted: false,
      deleted_at: null,
      sender: userProfile || undefined,
      _sending: true,
    };

    setMessages(prev => [...prev, tempMessage]);

    try {
      // 1. Get presigned URL from API
      const presignResponse = await api.media.getPresignedUrl({
        filename: file.name,
        contentType: file.type,
        bucket: 'chat-attachments',
        path: `${user.id}/${conversationId}`,
      });

      if (!presignResponse.ok || !presignResponse.data) {
        throw new Error(presignResponse.error?.message || 'Failed to get upload URL');
      }

      // 2. Upload directly to presigned URL
      const uploadRes = await fetch(presignResponse.data.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      });

      if (!uploadRes.ok) {
        throw new Error('Failed to upload file');
      }

      // 3. Determine message type
      const isImage = file.type.startsWith('image/');
      const messageType = isImage ? 'image' : 'file';
      const content = caption || (isImage ? 'Đã gửi hình ảnh' : `Đã gửi file: ${file.name}`);

      // 4. Send message via API
      const response = await api.messages.send(conversationId, {
        content,
        message_type: messageType,
        metadata: {
          file_url: presignResponse.data.publicUrl,
          file_name: file.name,
          file_size: file.size,
          file_type: file.type,
          caption: caption || null,
        },
      });

      if (!response.ok) {
        throw new Error(response.error?.message || 'Failed to send message');
      }

      // Update message with real data
      setMessages(prev => 
        prev.map(m => 
          m.id === tempId 
            ? { 
                ...m, 
                id: response.data!.id,
                metadata: { 
                  ...m.metadata, 
                  file_url: presignResponse.data!.publicUrl 
                },
                _sending: false 
              }
            : m
        )
      );

      URL.revokeObjectURL(tempUrl);
      return { data: response.data, error: null };
    } catch (error: any) {
      setMessages(prev => 
        prev.map(m => m.id === tempId ? { ...m, _sending: false, _failed: true } : m)
      );
      URL.revokeObjectURL(tempUrl);
      toast.error('Không thể gửi hình ảnh');
      return { error };
    }
  };

  const sendVoiceMessage = async (audioBlob: Blob, duration: number) => {
    if (!user || !conversationId) return { error: new Error('Not ready') };

    const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();
    const tempUrl = URL.createObjectURL(audioBlob);
    
    const tempMessage: Message = {
      id: tempId,
      conversation_id: conversationId,
      sender_id: user.id,
      content: 'Tin nhắn thoại',
      message_type: 'voice',
      metadata: { file_url: tempUrl, duration, file_type: 'audio/webm' },
      created_at: now,
      updated_at: now,
      is_deleted: false,
      deleted_at: null,
      sender: userProfile || undefined,
      _sending: true,
    };

    setMessages(prev => [...prev, tempMessage]);

    try {
      // 1. Get presigned URL from API
      const filename = `${Date.now()}.webm`;
      const presignResponse = await api.media.getPresignedUrl({
        filename,
        contentType: 'audio/webm',
        bucket: 'chat-attachments',
        path: `${user.id}/${conversationId}`,
      });

      if (!presignResponse.ok || !presignResponse.data) {
        throw new Error(presignResponse.error?.message || 'Failed to get upload URL');
      }

      // 2. Upload directly to presigned URL
      const uploadRes = await fetch(presignResponse.data.uploadUrl, {
        method: 'PUT',
        body: audioBlob,
        headers: { 'Content-Type': 'audio/webm' },
      });

      if (!uploadRes.ok) {
        throw new Error('Failed to upload voice message');
      }

      // 3. Send message via API
      const response = await api.messages.send(conversationId, {
        content: 'Tin nhắn thoại',
        message_type: 'voice',
        metadata: {
          file_url: presignResponse.data.publicUrl,
          duration: duration,
          file_type: 'audio/webm',
        },
      });

      if (!response.ok) {
        throw new Error(response.error?.message || 'Failed to send voice message');
      }

      setMessages(prev => 
        prev.map(m => 
          m.id === tempId 
            ? { 
                ...m, 
                id: response.data!.id,
                metadata: { ...m.metadata, file_url: presignResponse.data!.publicUrl },
                _sending: false 
              }
            : m
        )
      );

      URL.revokeObjectURL(tempUrl);
      return { data: response.data, error: null };
    } catch (error: any) {
      setMessages(prev => 
        prev.map(m => m.id === tempId ? { ...m, _sending: false, _failed: true } : m)
      );
      URL.revokeObjectURL(tempUrl);
      toast.error('Không thể gửi tin nhắn thoại');
      return { error };
    }
  };

  const deleteMessage = async (messageId: string) => {
    if (!user) return { error: new Error('Not authenticated') };

    // Optimistic update - mark as deleted immediately
    setMessages(prev => 
      prev.map(m => 
        m.id === messageId 
          ? { ...m, is_deleted: true, deleted_at: new Date().toISOString() } 
          : m
      )
    );

    try {
      const response = await api.messages.delete(messageId);

      if (!response.ok) {
        // Rollback on failure
        setMessages(prev => 
          prev.map(m => 
            m.id === messageId 
              ? { ...m, is_deleted: false, deleted_at: null } 
              : m
          )
        );
        toast.error('Không thể xóa tin nhắn');
        return { error: new Error(response.error?.message || 'Failed to delete message') };
      }

      return { error: null };
    } catch (error: any) {
      // Rollback on error
      setMessages(prev => 
        prev.map(m => 
          m.id === messageId 
            ? { ...m, is_deleted: false, deleted_at: null } 
            : m
        )
      );
      return { error };
    }
  };

  // Retry failed message
  const retryMessage = async (tempMessageId: string) => {
    const failedMessage = messages.find(m => m.id === tempMessageId && m._failed);
    if (!failedMessage) return;

    // Remove failed message
    setMessages(prev => prev.filter(m => m.id !== tempMessageId));
    
    // Resend based on message type
    if (failedMessage.message_type === 'text') {
      await sendMessage(
        failedMessage.content || '', 
        failedMessage.message_type, 
        failedMessage.metadata,
        failedMessage.reply_to_id || undefined
      );
    }
  };

  return {
    messages,
    loading,
    sendMessage,
    sendCryptoMessage,
    sendImageMessage,
    sendVoiceMessage,
    deleteMessage,
    retryMessage,
    fetchMessages,
  };
}
