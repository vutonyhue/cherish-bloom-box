/**
 * Typing Indicator API Module
 * Handles typing broadcast through API Gateway
 */

import { ApiClient } from '../apiClient';
import { ApiResponse } from '../types';

export function createTypingApi(client: ApiClient) {
  return {
    /**
     * Broadcast typing status to a conversation
     */
    async broadcast(conversationId: string): Promise<ApiResponse<void>> {
      return client.post<void>(`/v1/conversations/${conversationId}/typing`);
    },

    /**
     * Stop typing indicator
     */
    async stop(conversationId: string): Promise<ApiResponse<void>> {
      return client.delete<void>(`/v1/conversations/${conversationId}/typing`);
    },
  };
}
