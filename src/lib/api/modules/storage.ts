/**
 * Storage API Module
 * Handles file uploads through API Gateway presigned URLs
 */

import { ApiClient } from '../apiClient';
import { ApiResponse, PresignedUrlRequest, PresignedUrlResponse } from '../types';

export function createStorageApi(client: ApiClient) {
  return {
    /**
     * Get presigned URL for direct upload
     */
    async getPresignedUrl(params: PresignedUrlRequest): Promise<ApiResponse<PresignedUrlResponse>> {
      return client.post<PresignedUrlResponse>('/v1/media/presign', params);
    },

    /**
     * Upload file using presigned URL
     * Returns the public URL of the uploaded file
     */
    async uploadFile(file: File, bucket: string, path?: string): Promise<{ url: string; error?: Error }> {
      try {
        // 1. Get presigned URL
        const presignResponse = await this.getPresignedUrl({
          filename: file.name,
          contentType: file.type,
          bucket,
          path,
        });

        if (!presignResponse.ok || !presignResponse.data) {
          return { url: '', error: new Error(presignResponse.error?.message || 'Failed to get upload URL') };
        }

        // 2. Upload to presigned URL
        const uploadResponse = await fetch(presignResponse.data.uploadUrl, {
          method: 'PUT',
          body: file,
          headers: {
            'Content-Type': file.type,
          },
        });

        if (!uploadResponse.ok) {
          return { url: '', error: new Error('Failed to upload file') };
        }

        return { url: presignResponse.data.publicUrl };
      } catch (error) {
        return { url: '', error: error as Error };
      }
    },

    /**
     * Upload avatar image
     */
    async uploadAvatar(userId: string, file: File): Promise<{ url: string; error?: Error }> {
      const ext = file.name.split('.').pop();
      const filename = `avatar.${ext}`;
      
      try {
        const presignResponse = await this.getPresignedUrl({
          filename,
          contentType: file.type,
          bucket: 'avatars',
          path: userId,
        });

        if (!presignResponse.ok || !presignResponse.data) {
          return { url: '', error: new Error(presignResponse.error?.message || 'Failed to get upload URL') };
        }

        const uploadResponse = await fetch(presignResponse.data.uploadUrl, {
          method: 'PUT',
          body: file,
          headers: {
            'Content-Type': file.type,
          },
        });

        if (!uploadResponse.ok) {
          return { url: '', error: new Error('Failed to upload avatar') };
        }

        // Add cache-busting timestamp
        const publicUrl = `${presignResponse.data.publicUrl}?t=${Date.now()}`;
        return { url: publicUrl };
      } catch (error) {
        return { url: '', error: error as Error };
      }
    },
  };
}
