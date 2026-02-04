import { Component, EventEmitter, Output, inject, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LoadingSpinnerComponent } from '../shared/loading-spinner/loading-spinner.component';
import { WarningIconComponent } from '../shared/warning-icon/warning-icon.component';
import { TestCase } from '../../models/test-case.model';
import { ZephyrService } from '../../services/zephyr.service';
import { JiraService } from '../../services/jira.service';
import { BadgeUtilsService } from '../../services/badge-utils.service';
import { NotificationService } from '../../services/notification.service';

@Component({
  selector: 'app-test-case-list',
  standalone: true,
  imports: [CommonModule, FormsModule, WarningIconComponent],
  templateUrl: './test-case-list.component.html',
  styles: []
})
export class TestCaseListComponent {
  @Input() testCases: TestCase[] = [];
  @Input() isLoading: boolean = false;
  @Input() executionRowLoadingStates: Map<string, boolean> = new Map();
  
  // Pagination inputs
  @Input() paginationInfo: any = { start: 0, end: 0, total: 0, totalPages: 0, currentPage: 1 };
  @Input() pageNumbers: Array<number | 'ellipsis'> = [];
  
  @Output() viewTestCase = new EventEmitter<string>();
  @Output() editTestCase = new EventEmitter<string>();
  @Output() deleteTestCase = new EventEmitter<string>();
  @Output() createExecution = new EventEmitter<string>();
  @Output() refreshTestCases = new EventEmitter<void>();
  @Output() goToPage = new EventEmitter<number>();
  @Output() nextPage = new EventEmitter<void>();
  @Output() previousPage = new EventEmitter<void>();

  zephyrService = inject(ZephyrService);
  jiraService = inject(JiraService);
  badgeUtils = inject(BadgeUtilsService);
  notificationService = inject(NotificationService);

  /** Skeleton loading array */
  skeletonArray = Array(25).fill(0).map((_, i) => i);

  /** Selection state */
  selectedIds = new Set<string>();
  bulkStatus: 'UNEXECUTED' | 'PASS' | 'FAIL' | 'WIP' | 'BLOCKED' = 'UNEXECUTED';
  bulkJiraStatus: string = '';
  availableStatuses: string[] = ['To Do', 'In Progress', 'Closed'];

  /** Row loading states */
  rowLoadingStates = new Map<string, boolean>();
  statusLoadingStates = new Map<string, boolean>();

  /** Row actions */
  async updateExecutionStatus(executionId: string, issueId: string, status: string): Promise<void> {
    this.rowLoadingStates.set(issueId, true);
    const success = await this.zephyrService.updateExecutionStatus(executionId, issueId, status);
    this.rowLoadingStates.set(issueId, false);
    
    if (success) {
      // Update the test case locally - find by either jiraID or id
      const testCase = this.testCases.find(tc => tc.jiraID === issueId || tc.id === issueId);
      if (testCase) {
        // Update execution status with proper typing
        testCase.executionStatus = status as any;
      }
    }
  }

  /** Selection helpers */
  get selectedCount(): number {
    return this.selectedIds.size;
  }

  trackById = (_: number, tc: TestCase) => tc.jiraID || tc.id;

  toggleSelection(id: string, event: Event): void {
    const el = event.target as HTMLInputElement;
    if (el.checked) {
      this.selectedIds.add(id);
    } else {
      this.selectedIds.delete(id);
    }
  }

  clearSelection(): void {
    this.selectedIds.clear();
  }

  /** Page-level select-all (affects only currently visible rows) */
  isAllPageSelected(): boolean {
    return this.testCases.length > 0 && this.testCases.every(tc => this.selectedIds.has(tc.jiraID || tc.id));
  }

  isPageIndeterminate(): boolean {
    if (this.testCases.length === 0) return false;
    const selectedOnPage = this.testCases.filter(tc => this.selectedIds.has(tc.jiraID || tc.id)).length;
    return selectedOnPage > 0 && selectedOnPage < this.testCases.length;
  }

  toggleSelectAll(event: Event): void {
    const el = event.target as HTMLInputElement;
    if (el.checked) {
      this.testCases.forEach(tc => this.selectedIds.add(tc.jiraID || tc.id));
    } else {
      // Unselect only the current page for intuitive behavior
      this.testCases.forEach(tc => this.selectedIds.delete(tc.jiraID || tc.id));
    }
  }

  /** Bulk execute uses per-row updateExecutionStatus */
  async bulkExecute(): Promise<void> {
    const selectedTestCases = Array.from(this.selectedIds)
      .map(id => this.testCases.find(t => (t.jiraID || t.id) === id))
      .filter(tc => tc?.executionId); // Only process test cases that have executions

    if (selectedTestCases.length === 0) {
      this.notificationService.showError('No test cases with executions selected');
      return;
    }

    // Update all selected test cases in parallel
    const updatePromises = selectedTestCases
      .filter(tc => tc && tc.executionId)
      .map(tc => {
        const rowId = tc!.jiraID || tc!.id;
        return this.updateExecutionStatus(tc!.executionId!, rowId, this.bulkStatus);
      });

    // Wait for all updates to complete
    await Promise.all(updatePromises);

    // Clear selection after bulk update
    this.clearSelection();
    
    // Don't reload the entire table - individual rows are already updated
  }

  /** Bulk update Jira status */
  async bulkUpdateStatus(): Promise<void> {
    if (!this.bulkJiraStatus) {
      this.notificationService.showError('Please select a status');
      return;
    }

    const selectedTestCases = Array.from(this.selectedIds)
      .map(id => this.testCases.find(t => (t.jiraID || t.id) === id))
      .filter(tc => tc != null);

    if (selectedTestCases.length === 0) {
      this.notificationService.showError('No test cases selected');
      return;
    }

    // Update all selected test cases in parallel
    const updatePromises = selectedTestCases.map(async (tc) => {
      const rowId = tc!.jiraID || tc!.id;
      this.statusLoadingStates.set(rowId, true);
      
      try {
        const success = await this.jiraService.updateTestCase({
          id: tc!.id,
          jiraID: tc!.jiraID,
          status: this.bulkJiraStatus
        });
        
        if (success) {
          // Update local test case status
          tc!.status = this.bulkJiraStatus;
        }
        return success;
      } catch (error) {
        console.error(`Failed to update test case ${rowId}:`, error);
        return false;
      } finally {
        this.statusLoadingStates.set(rowId, false);
      }
    });

    // Wait for all updates to complete
    const results = await Promise.all(updatePromises);
    const successCount = results.filter(r => r).length;
    
    if (successCount > 0) {
      this.notificationService.showSuccess(`Successfully updated ${successCount} test case(s)`);
    }
    
    if (successCount < selectedTestCases.length) {
      this.notificationService.showError(`Failed to update ${selectedTestCases.length - successCount} test case(s)`);
    }

    // Clear selection after bulk update
    this.clearSelection();
  }

  /** UI helpers */
  getSprintClass(sprintName: string | null | undefined): string {
    if (!sprintName) return '';
    const sprints = this.jiraService.sprintsData();
    const sprint = sprints.find(s => s.name === sprintName);
    return sprint?.isActive ? 'text-green-600 font-semibold' : 'text-gray-700 dark:text-gray-300';
  }

  getSprintDisplayText(sprintName: string | null | undefined): string {
    if (!sprintName) return 'No sprint';
    const sprints = this.jiraService.sprintsData();
    const sprint = sprints.find(s => s.name === sprintName);
    return sprint?.isActive ? `${sprintName} (active)` : (sprintName || 'No sprint');
  }

  formatDate(date: string | null | undefined): string {
    if (!date) return '—';
    try {
      return new Date(date).toLocaleDateString();
    } catch {
      return '—';
    }
  }

  showCreateExecutionModal(testCaseId: string): void {
    this.createExecution.emit(testCaseId);
  }

  isRowLoading(id: string): boolean {
    // Check both local row loading states (for status updates) and parent execution loading states
    return this.rowLoadingStates.get(id) || this.executionRowLoadingStates.get(id) || false;
  }
}
