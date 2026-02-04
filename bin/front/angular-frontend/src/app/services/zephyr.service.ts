import { Injectable, inject, signal } from '@angular/core';
import { NotificationService } from './notification.service';
import { ApiConfigService } from './api-config.service';
import { ExecutionStatus, CycleData } from '../models/zephyr.model';

@Injectable({
  providedIn: 'root'
})
export class ZephyrService {
  private notificationService = inject(NotificationService);
  private apiConfig = inject(ApiConfigService);

  // LocalStorage keys
  private readonly LS_EXEC_STATUSES = 'zephyrExecutionStatuses_perm';

  // State signals
  private executionStatuses = signal<ExecutionStatus[]>([]);
  private cycles = signal<CycleData[]>([]);

  // Public readonly signals
  readonly executionStatusesData = this.executionStatuses.asReadonly();
  readonly cyclesData = this.cycles.asReadonly();

  // Execution status mapping
  private EXEC_STATUS_ID_MAP: { [key: string]: number } = {};

  async preloadExecutionStatuses(): Promise<void> {
    try {
      const cached = JSON.parse(localStorage.getItem(this.LS_EXEC_STATUSES) || 'null');
      if (Array.isArray(cached)) {
        this.EXEC_STATUS_ID_MAP = Object.fromEntries(
          cached.map((s: any) => [String(s.name).toUpperCase(), Number(s.id)])
        );
        this.executionStatuses.set(cached);
      } else {
        const response = await fetch(`${this.apiConfig.zephyrAPIURL}/execution-status`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const statuses = await response.json();
        localStorage.setItem(this.LS_EXEC_STATUSES, JSON.stringify(statuses));
        this.EXEC_STATUS_ID_MAP = Object.fromEntries(
          statuses.map((s: any) => [String(s.name).toUpperCase(), Number(s.id)])
        );
        this.executionStatuses.set(statuses);
      }
    } catch (error) {
      console.warn('Failed to preload execution statuses:', error);
      // Fallback values
      this.EXEC_STATUS_ID_MAP = { UNEXECUTED: -1, PASS: 1, FAIL: 2, WIP: 3, BLOCKED: 4 };
      this.executionStatuses.set([
        { id: -1, name: 'UNEXECUTED' },
        { id: 1, name: 'PASS' },
        { id: 2, name: 'FAIL' },
        { id: 3, name: 'WIP' },
        { id: 4, name: 'BLOCKED' }
      ]);
    }
  }

  async loadCyclesForVersion(versionId: string): Promise<void> {
    if (!versionId) {
      this.cycles.set([]);
      return;
    }

    try {
      const url = `${this.apiConfig.zephyrAPIURL}/cycles?version_id=${encodeURIComponent(versionId)}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`cycles HTTP ${response.status}`);
      const data = await response.json();

      this.cycles.set(data.items || []);
    } catch (error) {
      console.error('Cycles load failed:', error);
      this.notificationService.showError('Failed to load cycles');
      this.cycles.set([]);
    }
  }

  async loadExecutionStatusForTestCase(issueId: string): Promise<{ executionId: string | null; executionStatus: string }> {
    try {
      const url = new URL(`${this.apiConfig.zephyrAPIURL}/executions`);
      url.searchParams.set('issue_id', issueId);

      const response = await fetch(url.toString());
      if (response.ok) {
        const data = await response.json();
        const item = (data.items && data.items[0]) || null;

        if (item) {
          return {
            executionId: item.execution_id ? String(item.execution_id) : null,
            executionStatus: (item.statusName || 'UNEXECUTED').toUpperCase()
          };
        }
      }
    } catch (error) {
      console.warn('Failed to load execution status for', issueId, error);
    }

    return {
      executionId: null,
      executionStatus: 'UNEXECUTED'
    };
  }

  async updateExecutionStatus(executionId: string, issueId: string, status: string): Promise<boolean> {
    try {
      const statusId = this.EXEC_STATUS_ID_MAP[status.toUpperCase()];
      if (statusId === undefined) {
        throw new Error(`Unknown execution status: ${status}`);
      }
  
      const payload = {
        status_id: statusId
      };
  
      const url = `${this.apiConfig.zephyrAPIURL}/executions/${executionId}?issue_id=${issueId}`;
  
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });
  
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || `HTTP ${response.status}`);
      }
  
      return true;
    } catch (error: any) {
      console.error('Error updating execution status:', error);
      this.notificationService.showError(`Failed to update execution status: ${error.message || error}`);
      return false;
    }
  }

  getExecutionStatusId(statusName: string): number | undefined {
    return this.EXEC_STATUS_ID_MAP[statusName.toUpperCase()];
  }

  async getCycles(): Promise<any[]> {
    try {
      const response = await fetch(`${this.apiConfig.zephyrAPIURL}/cycles`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('Failed to load cycles:', error);
      return [];
    }
  }

  // Update test case in Zephyr
  async updateTestCase(testCase: any): Promise<boolean> {
    try {
      const testSteps: any[] = [];
      if (testCase.steps) {
        testCase.steps.split('\n').filter((line: string) => line.trim()).forEach((line: string) => {
          const clean = line.replace(/^\d+\.\s*/, '').trim();
          if (clean) {
            testSteps.push({
              step: clean,
              data: null,
              result: testCase.expectedResult || 'Expected result as specified'
            });
          }
        });
      }
      
      const response = await fetch(`${this.apiConfig.zephyrAPIURL}/test-cases/${testCase.jiraID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          steps: testSteps
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || `HTTP ${response.status}`);
      }

      const result = await response.json();
      return result.success;
    } catch (error: any) {
      console.error('Failed to update test case in Zephyr:', error);
      this.notificationService.showError(`Failed to update Zephyr fields: ${error.message || error}`);
      return false;
    }
  }
}
