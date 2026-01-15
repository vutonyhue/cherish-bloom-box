/**
 * SSE (Server-Sent Events) API Module
 * Handles realtime connections through API Gateway
 */

import { Message } from '@/types';

export interface TypingEvent {
  user_id: string;
  user_name: string;
  timestamp: number;
}

export interface PresenceEvent {
  user_id: string;
  status: 'online' | 'offline' | 'away';
  timestamp: number;
}

export interface SSECallbacks {
  onMessage: (msg: Message) => void;
  onTyping: (data: TypingEvent) => void;
  onPresence: (data: PresenceEvent) => void;
  onError: (error: Error) => void;
  onReconnect?: () => void;
}

export interface SSEConnection {
  close: () => void;
  isConnected: () => boolean;
}

/**
 * Create an SSE connection for realtime updates
 * Note: SSE through Cloudflare Workers has limitations (30s timeout on free tier)
 * This implementation includes auto-reconnect and fallback to polling
 */
export function createSSEConnection(
  baseUrl: string,
  conversationId: string,
  getAccessToken: () => Promise<string | null>,
  callbacks: SSECallbacks
): SSEConnection {
  let eventSource: EventSource | null = null;
  let reconnectAttempts = 0;
  let isClosedManually = false;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  const MAX_RECONNECT_ATTEMPTS = 5;
  const BASE_RECONNECT_DELAY = 1000;

  const connect = async () => {
    if (isClosedManually) return;

    try {
      const token = await getAccessToken();
      if (!token) {
        callbacks.onError(new Error('No access token available'));
        return;
      }

      // SSE doesn't support custom headers, so we need to pass token as query param
      // This is less secure but necessary for EventSource API
      const url = `${baseUrl}/v1/conversations/${conversationId}/stream?token=${encodeURIComponent(token)}`;
      
      eventSource = new EventSource(url);

      eventSource.onopen = () => {
        console.log('[SSE] Connection opened');
        reconnectAttempts = 0;
      };

      eventSource.addEventListener('message', (event) => {
        try {
          const data = JSON.parse(event.data);
          callbacks.onMessage(data);
        } catch (e) {
          console.error('[SSE] Failed to parse message:', e);
        }
      });

      eventSource.addEventListener('typing', (event) => {
        try {
          const data = JSON.parse(event.data);
          callbacks.onTyping(data);
        } catch (e) {
          console.error('[SSE] Failed to parse typing event:', e);
        }
      });

      eventSource.addEventListener('presence', (event) => {
        try {
          const data = JSON.parse(event.data);
          callbacks.onPresence(data);
        } catch (e) {
          console.error('[SSE] Failed to parse presence event:', e);
        }
      });

      eventSource.addEventListener('ping', () => {
        // Heartbeat received, connection is alive
      });

      eventSource.onerror = (error) => {
        console.error('[SSE] Connection error:', error);
        eventSource?.close();
        eventSource = null;

        if (!isClosedManually && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          const delay = BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts);
          reconnectAttempts++;
          console.log(`[SSE] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
          
          reconnectTimeout = setTimeout(() => {
            callbacks.onReconnect?.();
            connect();
          }, delay);
        } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          callbacks.onError(new Error('SSE connection failed after maximum retries'));
        }
      };
    } catch (error) {
      console.error('[SSE] Failed to create connection:', error);
      callbacks.onError(error as Error);
    }
  };

  // Start connection
  connect();

  return {
    close: () => {
      isClosedManually = true;
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
      eventSource?.close();
      eventSource = null;
    },
    isConnected: () => eventSource?.readyState === EventSource.OPEN,
  };
}

/**
 * Polling fallback for environments where SSE is not reliable
 */
export function createPollingConnection(
  fetchMessages: () => Promise<void>,
  callbacks: Pick<SSECallbacks, 'onError'>,
  intervalMs = 3000
): SSEConnection {
  let isRunning = true;
  let pollTimeout: ReturnType<typeof setTimeout> | null = null;

  const poll = async () => {
    if (!isRunning) return;

    try {
      await fetchMessages();
    } catch (error) {
      callbacks.onError(error as Error);
    }

    if (isRunning) {
      pollTimeout = setTimeout(poll, intervalMs);
    }
  };

  // Start polling
  poll();

  return {
    close: () => {
      isRunning = false;
      if (pollTimeout) {
        clearTimeout(pollTimeout);
        pollTimeout = null;
      }
    },
    isConnected: () => isRunning,
  };
}
