import { Injectable, signal } from '@angular/core';

export type ToastType = 'success' | 'error';

export interface ToastMessage {
  message: string;
  type: ToastType;
  id: string;
}

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private toastMessage = signal('');
  private toastType = signal<ToastType>('success');
  private toastId = signal('');

  // Public readonly signals
  readonly message = this.toastMessage.asReadonly();
  readonly type = this.toastType.asReadonly();

  showToast(message: string, type: ToastType = 'success'): void {
    const id = Date.now().toString();
    this.toastMessage.set(message);
    this.toastType.set(type);
    this.toastId.set(id);
    
    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      // Only clear if this is still the current toast
      if (this.toastId() === id) {
        this.clearToast();
      }
    }, 5000);
  }

  showSuccess(message: string): void {
    this.showToast(message, 'success');
  }

  showError(message: string): void {
    this.showToast(message, 'error');
  }

  clearToast(): void {
    this.toastMessage.set('');
    this.toastId.set('');
  }

  hasToast(): boolean {
    return this.toastMessage() !== '';
  }
}
