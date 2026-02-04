import { Injectable, inject } from '@angular/core';
import { ApiConfigService } from './api-config.service';

export interface FeedbackSubmission {
  type: 'compliment' | 'problem' | 'suggestion';
  message: string;
  name?: string;
  timestamp?: string;
}

@Injectable({
  providedIn: 'root'
})
export class FeedbackService {
  private apiConfig = inject(ApiConfigService);

  async submitFeedback(feedback: FeedbackSubmission): Promise<boolean> {
    try {
      const response = await fetch(`http://localhost:5000/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...feedback,
          timestamp: new Date().toISOString()
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return true;
    } catch (error) {
      console.error('Failed to submit feedback:', error);
      return false;
    }
  }
}
