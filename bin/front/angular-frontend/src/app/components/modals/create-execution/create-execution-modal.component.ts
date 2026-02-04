import { Component, inject, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TestCaseModalComponent } from '../base/test-case-modal.component';
import { LoadingSpinnerComponent } from '../../shared/loading-spinner/loading-spinner.component';
import { ZephyrService } from '../../../services/zephyr.service';
import { JiraService } from '../../../services/jira.service';
import { NotificationService } from '../../../services/notification.service';
import { ApiConfigService } from '../../../services/api-config.service';
import { CreateExecutionRequest } from '../../../models/zephyr.model';

@Component({
  selector: 'app-create-execution-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, TestCaseModalComponent, LoadingSpinnerComponent],
  templateUrl: './create-execution-modal.component.html',
  styles: []
})
export class CreateExecutionModalComponent implements OnInit {
  zephyrService = inject(ZephyrService);
  jiraService = inject(JiraService);
  private notificationService = inject(NotificationService);
  private apiConfig = inject(ApiConfigService);

  @Input() isVisible: boolean = false;
  @Input() testCaseId: string = '';
  @Output() closeModal = new EventEmitter<void>();
  @Output() executionCreated = new EventEmitter<string>(); // Emit testCaseId when created

  isLoading = false;

  formData = {
    version_id: '',
    cycle_id: '',
    execution_status_id: ''
  };

  async ngOnInit(): Promise<void> {
    if (this.isVisible) {
      this.onVersionChange({ target: { value: '' } });
    }
  }

  onVersionChange(event: any): void {
    const versionId = event.target.value;
    this.zephyrService.loadCyclesForVersion(versionId);
  }

  async handleSubmit(): Promise<void> {
    if (!this.formData.version_id || !this.formData.cycle_id) {
      return;
    }

    try {
      this.isLoading = true;

      const payload: CreateExecutionRequest = {
        issue_id: this.testCaseId,
        cycle_id: parseInt(this.formData.cycle_id),
        version_id: parseInt(this.formData.version_id)
      };

      if (this.formData.execution_status_id) {
        payload.execution_status = {
          id: parseInt(this.formData.execution_status_id)
        };
      }

      const response = await fetch(`${this.apiConfig.TCsAPIURL}/${this.testCaseId}/execution`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || `HTTP ${response.status}`);
      }

      this.notificationService.showSuccess('Execution created successfully!');
      this.executionCreated.emit(this.testCaseId); // Emit the testCaseId
      this.close();

    } catch (error: any) {
      console.error('Error creating execution:', error);
      this.notificationService.showError(`Failed to create execution: ${error.message || error}`);
    } finally {
      this.isLoading = false;
    }
  }

  close(): void {
    this.formData = {
      version_id: '',
      cycle_id: '',
      execution_status_id: ''
    };
    this.closeModal.emit();
  }
}
