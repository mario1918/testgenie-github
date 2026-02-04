import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-test-case-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './test-case-modal.component.html',
  styles: []
})
export class TestCaseModalComponent {
  @Input() isVisible: boolean = false;
  @Input() title: string = '';
  @Input() size: 'small' | 'medium' | 'large' = 'medium';
  
  @Output() closeModal = new EventEmitter<void>();

  get modalSizeClass(): string {
    const sizeClasses = {
      small: 'modal-sm',
      medium: 'modal-lg',
      large: 'modal-xl'
    };
    return sizeClasses[this.size];
  }

  close(): void {
    this.closeModal.emit();
  }
}
