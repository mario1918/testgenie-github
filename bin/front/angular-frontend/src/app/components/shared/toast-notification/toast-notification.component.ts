import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NotificationService } from '../../../services/notification.service';

@Component({
  selector: 'app-toast-notification',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './toast-notification.component.html',
  styles: [`
    .toast {
      min-width: 300px;
      max-width: 500px;
      box-shadow: 0 0.5rem 1rem rgba(0, 0, 0, 0.15);
    }
    .toast-body {
      padding: 0.75rem;
    }
  `]
})
export class ToastNotificationComponent {
  notificationService = inject(NotificationService);

  get toastClass(): string {
    return this.notificationService.type() === 'success' ? 'bg-success' : 'bg-danger';
  }
}
