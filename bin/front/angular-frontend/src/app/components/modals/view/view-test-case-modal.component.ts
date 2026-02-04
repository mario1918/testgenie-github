import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TestCaseModalComponent } from '../base/test-case-modal.component';
import { TestCase } from '../../../models/test-case.model';
import { BadgeUtilsService } from '../../../services/badge-utils.service';

@Component({
  selector: 'app-view-test-case-modal',
  standalone: true,
  imports: [CommonModule, TestCaseModalComponent],
  templateUrl: './view-test-case-modal.component.html',
  styles: []
})
export class ViewTestCaseModalComponent {
  @Input() isVisible: boolean = false;
  @Input() testCase: TestCase | null = null;
  
  @Output() closeModal = new EventEmitter<void>();
  @Output() editTestCase = new EventEmitter<string>();

  constructor(public badgeUtils: BadgeUtilsService) {}

  close(): void {
    this.closeModal.emit();
  }

  editFromView(): void {
    if (this.testCase) {
      this.editTestCase.emit(this.testCase.id);
    }
  }

  formatDate(date: string | null | undefined): string {
    if (!date) return '—';
    try {
      return new Date(date).toLocaleDateString();
    } catch {
      return '—';
    }
  }
}
