import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ThemeService } from '../../services/theme.service';

export type FeedbackType = 'compliment' | 'problem' | 'suggestion';

@Component({
  selector: 'app-feedback-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './feedback-modal.component.html',
  styles: [`
    .modal-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.5);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 1050;
    }

    .modal-content {
      border-radius: 8px;
      max-width: 500px;
      width: 90%;
      max-height: 90vh;
      overflow-y: auto;
    }

    .modal-content.light {
      background: white;
      color: #000;
    }

    .modal-content.dark {
      background: #2b3035;
      color: #fff;
    }

    .feedback-icon {
      font-size: 3rem;
      margin-bottom: 1rem;
    }

    .icon-compliment { color: #28a745; }
    .icon-problem { color: #dc3545; }
    .icon-suggestion { color: #17a2b8; }

    .dark .modal-header {
      border-bottom-color: #495057;
    }

    .dark .form-control {
      background-color: #343a40;
      border-color: #495057;
      color: #fff;
    }

    .dark .form-control:focus {
      background-color: #343a40;
      border-color: #6c757d;
      color: #fff;
    }

    .dark .form-label {
      color: #fff;
    }

    .dark .text-muted {
      color: #adb5bd !important;
    }

    .dark .btn-close {
      filter: invert(1);
    }
  `]
})
export class FeedbackModalComponent {
  themeService = inject(ThemeService);
  @Input() isVisible: boolean = false;
  @Input() feedbackType: FeedbackType = 'compliment';
  @Output() closeModal = new EventEmitter<void>();
  @Output() submitFeedback = new EventEmitter<{ type: FeedbackType; message: string; name?: string }>();

  message: string = '';
  name: string = '';
  isSubmitting: boolean = false;

  get modalTitle(): string {
    const titles = {
      'compliment': 'Give a Compliment',
      'problem': 'Report a Problem',
      'suggestion': 'Make a Suggestion'
    };
    return titles[this.feedbackType];
  }

  get modalLabel(): string {
    const labels = {
      'compliment': 'What did you like?',
      'problem': 'What did you dislike?',
      'suggestion': 'Write your suggestion'
    };
    return labels[this.feedbackType];
  }

  get modalIcon(): string {
    const icons = {
      'compliment': 'bi-emoji-smile',
      'problem': 'bi-exclamation-triangle',
      'suggestion': 'bi-lightbulb'
    };
    return icons[this.feedbackType];
  }

  get iconClass(): string {
    const classes = {
      'compliment': 'icon-compliment',
      'problem': 'icon-problem',
      'suggestion': 'icon-suggestion'
    };
    return classes[this.feedbackType];
  }

  close(): void {
    this.message = '';
    this.name = '';
    this.closeModal.emit();
  }

  async submit(): Promise<void> {
    if (!this.message.trim()) {
      return;
    }

    this.isSubmitting = true;
    this.submitFeedback.emit({
      type: this.feedbackType,
      message: this.message.trim(),
      name: this.name.trim() || undefined
    });

    // Reset form
    this.message = '';
    this.name = '';
    this.isSubmitting = false;
  }
}
