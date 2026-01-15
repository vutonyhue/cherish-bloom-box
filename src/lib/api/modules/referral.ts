/**
 * Referral API Module
 * Handles referral code operations through API Gateway
 */

import { ApiClient } from '../apiClient';
import { ApiResponse } from '../types';

export interface ReferralCode {
  code: string;
  uses_count: number;
  max_uses: number;
  is_active: boolean;
  share_url: string;
}

export interface UseReferralResponse {
  success: boolean;
  referrer_username?: string;
  message?: string;
}

export function createReferralApi(client: ApiClient) {
  return {
    /**
     * Get current user's referral code
     */
    async getCode(): Promise<ApiResponse<ReferralCode>> {
      return client.get<ReferralCode>('/v1/referral/code');
    },

    /**
     * Use a referral code (for new users)
     */
    async useCode(code: string): Promise<ApiResponse<UseReferralResponse>> {
      return client.post<UseReferralResponse>('/v1/referral/use', { code });
    },

    /**
     * Get referral stats
     */
    async getStats(): Promise<ApiResponse<{
      total_referrals: number;
      successful_referrals: number;
      pending_rewards: number;
    }>> {
      return client.get('/v1/referral/stats');
    },
  };
}
