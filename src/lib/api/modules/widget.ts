/**
 * Widget API Module
 * Handles widget token generation through API Gateway
 */

import { ApiClient } from '../apiClient';
import { ApiResponse } from '../types';

export interface WidgetTokenResponse {
  token: string;
  expires_at?: string;
}

export function createWidgetApi(client: ApiClient) {
  return {
    /**
     * Generate a widget token for embedding chat in external sites
     */
    async generateToken(
      conversationId: string,
      scopes: string[]
    ): Promise<ApiResponse<WidgetTokenResponse>> {
      return client.post<WidgetTokenResponse>('/v1/widget/token', {
        conversation_id: conversationId,
        scopes,
      });
    },
  };
}
