import { Component, inject, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TestCaseModalComponent } from '../base/test-case-modal.component';
import { LoadingSpinnerComponent } from '../../shared/loading-spinner/loading-spinner.component';
import { JiraService } from '../../../services/jira.service';
import { ZephyrService } from '../../../services/zephyr.service';
import { TestCaseService } from '../../../services/test-case.service';
import { CreateTestCaseForm } from '../../../models/form.model';

@Component({
  selector: 'app-create-test-case-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, TestCaseModalComponent],
  templateUrl: './create-test-case-modal.component.html',
  styles: []
})
export class CreateTestCaseModalComponent {
  jiraService = inject(JiraService);
  zephyrService = inject(ZephyrService);
  testCaseService = inject(TestCaseService);

  @Input() isVisible: boolean = false;
  @Output() closeModal = new EventEmitter<void>();
 
  // Indicates whether the create action is in progress
  saving: boolean = false;

  formData: CreateTestCaseForm = {
    summary: '',
    description: '',
    steps: '',
    expectedResult: '',
    component: '',
    addCurrentSprint: false,
    version: null,
    testCycle: null,
    relatedTask: '',
    executionStatus: 'UNEXECUTED'
  };
  
  async handleSubmit(): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    try {
      const success = await this.testCaseService.createTestCase(this.formData);
      if (success) {
        this.resetForm();
        this.close();
      }
    } finally {
      this.saving = false;
    }
  }

  onVersionChange(event: any): void {
    const versionId = event.target.value;
    this.zephyrService.loadCyclesForVersion(versionId);
  }

  getActiveSprint() {
    return this.jiraService.getActiveSprint();
  }

  close(): void {
    this.closeModal.emit();
  }

  private resetForm(): void {
    this.formData = {
      summary: '',
      description: '',
      steps: '',
      expectedResult: '',
      component: '',
      addCurrentSprint: false,
      version: null,
      testCycle: null,
      relatedTask: '',
      executionStatus: 'UNEXECUTED'
    };
  }
}
