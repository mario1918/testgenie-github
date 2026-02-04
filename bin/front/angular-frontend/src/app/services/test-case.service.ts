import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { TestCase, GenerateTestCaseRequest, ConversationMessage } from '../models/test-case.model';
import { JiraIssue } from '../models/jira-issue.model';
import { ApiConfigService } from './api-config.service';
import { NotificationService } from './notification.service';
import { ZephyrService } from './zephyr.service';
import { JiraService } from './jira.service';
import { CreateTestCaseForm, EditTestCaseForm, FilterState, PaginationInfo } from '../models/form.model';

@Injectable({
  providedIn: 'root'
})
export class TestCaseService {
  private notificationService = inject(NotificationService);
  private zephyrService = inject(ZephyrService);
  private jiraService = inject(JiraService);
  
  // AI-generated test cases (existing functionality)
  private testCasesSubject = new BehaviorSubject<TestCase[]>([]);
  private conversationHistorySubject = new BehaviorSubject<ConversationMessage[]>([]);

  public testCases$ = this.testCasesSubject.asObservable();
  public conversationHistory$ = this.conversationHistorySubject.asObservable();

  // Jira test cases with pagination (new functionality)
  private jiraTestCases = signal<TestCase[]>([]);
  private isLoading = signal(false);
  private isSaving = signal(false);
  private listLoading = signal(false);
  private executionLoading = signal(false);
  private rowExecutionLoading = signal<Record<string, boolean>>({});

  // Pagination (cursor-based)
  private currentPage = signal(0);
  private pageSize = signal(10);
  private totalResults = signal(0);
  private pageTokens = signal<(string | null)[]>([null]);
  private isLastPage = signal<boolean>(true);

  // Filter signals
  private filterState = signal<FilterState>({
    component: '',
    sprint: '',
    search: '',
    jql: '',
    status: '',
    assignee: '',
    assigneeCurrentUser: false,
    reporter: '',
    reporterCurrentUser: false
  });

  // Public readonly signals
  readonly jiraTestCasesData = this.jiraTestCases.asReadonly();
  readonly loading = this.isLoading.asReadonly();
  readonly saving = this.isSaving.asReadonly();
  readonly listLoadingState = this.listLoading.asReadonly();
  readonly executionLoadingState = this.executionLoading.asReadonly();
  readonly filters = this.filterState.asReadonly();

  // Computed pagination info
  readonly paginationInfo = computed((): PaginationInfo => {
    const current = this.currentPage();
    const size = this.pageSize();
    const total = this.totalResults();
    const knownTotal = typeof total === 'number' && total > 0;

    const totalPages = knownTotal ? Math.ceil(total / size) : (this.isLastPage() ? current + 1 : current + 2);
    const start = knownTotal ? (current * size + 1) : (current * size + 1);
    const end = knownTotal
      ? Math.min((current + 1) * size, total)
      : ((current + 1) * size);

    return {
      start,
      end,
      total: knownTotal ? total : 0,
      totalPages,
      currentPage: current + 1,
    };
  });

  // Computed page numbers for pagination
  readonly pageNumbers = computed((): Array<number | 'ellipsis'> => {
    const current = this.currentPage();
    const totalPages = this.paginationInfo().totalPages;
    const pages: Array<number | 'ellipsis'> = [];

    const maxButtons = 9;
    if (totalPages <= maxButtons) {
      for (let i = 0; i < totalPages; i++) pages.push(i);
      return pages;
    }

    pages.push(0);
    if (current > 3) pages.push('ellipsis');

    const start = Math.max(1, current - 1);
    const end = Math.min(totalPages - 2, current + 1);
    for (let i = start; i <= end; i++) pages.push(i);

    if (current < totalPages - 4) pages.push('ellipsis');
    pages.push(totalPages - 1);

    return pages;
  });

  constructor(
    private http: HttpClient,
    private apiConfig: ApiConfigService
  ) {}

  /** Reset cursor pagination state */
  private resetPaging(): void {
    this.currentPage.set(0);
    this.pageTokens.set([null]);
    this.isLastPage.set(true);
    this.totalResults.set(0);
  }

  /** Load test cases from Jira with cursor-based pagination */
  async loadTestCases(): Promise<void> {
    this.listLoading.set(true);
    try {
      const length = this.pageSize();
      const pageIdx = this.currentPage();
      const tokenForThisPage = this.pageTokens()[pageIdx] ?? null;
      const filters = this.filterState();

      const url = new URL(`${this.apiConfig.apiUrl}/test-cases/paginated`);
      url.searchParams.set('project_key', 'SE2');
      url.searchParams.set('max_results', length.toString());
      url.searchParams.set('issueType', 'Test');

      // Add next page token if available
      if (tokenForThisPage) {
        url.searchParams.set('next_page_token', tokenForThisPage);
      }

      // Apply filters
      if (filters.component) url.searchParams.set('component', filters.component);
      if (filters.sprint) url.searchParams.set('sprint', filters.sprint);
      if (filters.search) url.searchParams.set('search', filters.search);
      if (filters.jql) url.searchParams.set('jql_filter', filters.jql);
      if (filters.status) url.searchParams.set('status', filters.status);
      if (filters.assignee) url.searchParams.set('assignee', filters.assignee);
      if (filters.assigneeCurrentUser !== undefined) {
        url.searchParams.set('assigneeCurrentUser', String(filters.assigneeCurrentUser));
      }
      if (filters.reporter) url.searchParams.set('reporter', filters.reporter);
      if (filters.reporterCurrentUser !== undefined) {
        url.searchParams.set('reporterCurrentUser', String(filters.reporterCurrentUser));
      }

      const response = await fetch(url.toString());
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();

      const items = json.items ?? json.issues ?? [];
      const testCases = items.map((tc: any) => this.mapTestCaseFromApi(tc));

      this.jiraTestCases.set(testCases);

      // Update total if provided
      const total = json.paginated?.total ?? json.total ?? null;
      if (typeof total === 'number') {
        this.totalResults.set(total);
      }

      // Handle pagination tokens
      const nextToken: string | null = json.nextPageToken ?? null;
      const isLast: boolean = !!json.isLast || nextToken === null;
      this.isLastPage.set(isLast);

      // Store token for next page
      const tokens = this.pageTokens().slice();
      tokens[pageIdx + 1] = nextToken;
      this.pageTokens.set(tokens);

      // Auto step back if empty page and not first page
      if (testCases.length === 0 && pageIdx > 0) {
        this.currentPage.set(pageIdx - 1);
      }

      // Load execution statuses
      await this.loadExecutionStatusesForCurrentPage();

    } catch (error) {
      console.error('Failed to load test cases:', error);
      this.notificationService.showError('Failed to load test cases');
      this.jiraTestCases.set([]);
      this.isLastPage.set(true);
    } finally {
      this.listLoading.set(false);
    }
  }

  /** Map API response to TestCase model */
  private mapTestCaseFromApi(tc: any): TestCase {
    const comps = Array.isArray(tc.components)
      ? (typeof tc.components[0] === 'string' ? tc.components : tc.components.map((c: any) => c?.name).filter(Boolean))
      : [];
    const status = (typeof tc.status === 'string' ? tc.status : tc.status?.name) || 'Unknown';
    const priority = (typeof tc.priority === 'string' ? tc.priority : tc.priority?.name) || 'Medium';
    const reporter = (typeof tc.reporter === 'string' ? tc.reporter : (tc.reporter?.displayName || tc.reporter?.name)) || '—';
    const related = tc.first_linked_issue || (Array.isArray(tc.linkedKeys) ? tc.linkedKeys[0] : null);
    const steps = tc.steps || [];
    const expected = tc.expected_result || '';

    return {
      jiraID: tc.id,
      id: tc.key,
      title: tc.summary || '(no title)',
      summary: tc.summary || '(no title)',
      description: tc.description || '',
      component: comps.length ? comps.join(', ') : 'N/A',
      sprint: tc.sprint ?? undefined,
      status,
      priority,
      relatedTask: related,
      created: tc.created || undefined,
      createdBy: reporter,
      executionId: undefined,
      executionStatus: 'UNEXECUTED',
      steps,
      expectedResult: expected
    };
  }

  /** Load execution statuses for current page */
  private async loadExecutionStatusesForCurrentPage(): Promise<void> {
    this.executionLoading.set(true);
    const testCases = this.jiraTestCases();
    const promises = testCases.map(async (testCase) => {
      this.setRowLoading(testCase.jiraID || testCase.id, true);
      try {
        const executionData = await this.zephyrService.loadExecutionStatusForTestCase(testCase.jiraID || testCase.id);
        return {
          ...testCase,
          executionId: executionData.executionId ?? undefined,
          executionStatus: executionData.executionStatus
        };
      } finally {
        this.setRowLoading(testCase.jiraID || testCase.id, false);
      }
    });

    const updatedTestCases = await Promise.all(promises);
    this.jiraTestCases.set(updatedTestCases);
    this.executionLoading.set(false);
  }

  /** Update execution status */
  async updateExecutionStatus(executionId: string, issueId: string, status: string): Promise<void> {
    this.setRowLoading(issueId, true);
    try {
      const success = await this.zephyrService.updateExecutionStatus(executionId, issueId, status);
      if (success) {
        const testCases = this.jiraTestCases();
        const updatedTestCases = testCases.map(tc =>
          tc.jiraID === issueId ? { ...tc, executionStatus: status.toUpperCase() } : tc
        );
        this.jiraTestCases.set(updatedTestCases);
        this.notificationService.showSuccess('Execution updated successfully!');
      } else {
        this.notificationService.showError('Execution failed!');
      }
    } finally {
      this.setRowLoading(issueId, false);
    }
  }

  /** Create test case */
  async createTestCase(formData: CreateTestCaseForm): Promise<boolean> {
    try {
      this.isSaving.set(true);

      const testSteps: any[] = [];
      if (formData.steps) {
        formData.steps.split('\n').filter(line => line.trim()).forEach(line => {
          const clean = line.replace(/^\d+\.\s*/, '').trim();
          if (clean) {
            testSteps.push({
              step: clean,
              data: null,
              result: formData.expectedResult || 'Expected result as specified'
            });
          }
        });
      }

      let sprintId: number | null = null;
      if (formData.addCurrentSprint) {
        const activeSprint = this.jiraService.getActiveSprint();
        if (activeSprint && activeSprint.id) {
          sprintId = typeof activeSprint.id === 'number' ? activeSprint.id : parseInt(String(activeSprint.id));
        }
      }

      const payload: any = {
        summary: formData.summary,
        description: formData.description,
        components: formData.component ? [formData.component] : [],
        steps: testSteps,
        sprint_id: sprintId,
        related_issues: formData.relatedTask ? [formData.relatedTask] : [],
      };

      if (formData.version != null || formData.testCycle != null) {
        payload.version_id = formData.version;
        payload.cycle_id = formData.testCycle;
        const executionStatusId = this.zephyrService.getExecutionStatusId(formData.executionStatus) || 1;
        if (executionStatusId != null) {
          payload.execution_status = { id: executionStatusId, name: formData.executionStatus };
        }
      }

      const response = await fetch(`${this.apiConfig.TCsAPIURL}/full-create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP Error: ${response.status} - ${errorText}`);
      }

      this.resetPaging();
      await this.loadTestCases();

      this.notificationService.showSuccess('Test case created successfully!');
      return true;

    } catch (error: any) {
      console.error('Error creating test case:', error);
      this.notificationService.showError('Failed to create test case. Please try again.');
      return false;
    } finally {
      this.isSaving.set(false);
    }
  }

  /** Update test case */
  async updateTestCase(formData: EditTestCaseForm): Promise<boolean> {
    try {
      this.isSaving.set(true);

      const payload = {
        summary: formData.summary,
        description: formData.description,
        component: formData.component,
        sprint: formData.sprint,
        status: formData.status,
        priority: formData.priority,
        relatedTask: formData.relatedTask,
        steps: formData.steps,
        expectedResult: formData.expectedResult
      };

      const response = await fetch(`${this.apiConfig.TCsAPIURL}/${formData.jiraID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || `HTTP ${response.status}`);
      }

      await this.loadTestCases();
      this.notificationService.showSuccess('Test case updated successfully!');
      return true;

    } catch (error: any) {
      console.error('Error updating test case:', error);
      this.notificationService.showError(`Failed to update test case: ${error.message || error}`);
      return false;
    } finally {
      this.isSaving.set(false);
    }
  }

  /** Delete test case */
  async deleteTestCase(id: string): Promise<boolean> {
    try {
      this.isLoading.set(true);

      const response = await fetch(`${this.apiConfig.TCsAPIURL}/${id}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || `HTTP ${response.status}`);
      }

      await this.loadTestCases();
      this.notificationService.showSuccess('Test case deleted successfully!');
      return true;

    } catch (error: any) {
      console.error('Error deleting test case:', error);
      this.notificationService.showError(`Failed to delete test case: ${error.message || error}`);
      return false;
    } finally {
      this.isLoading.set(false);
    }
  }

  /** Get test case by ID */
  async getTestCaseById(id: string): Promise<TestCase | null> {
    try {
      const response = await fetch(`${this.apiConfig.TCsAPIURL}/${id}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || `HTTP ${response.status}`);
      }
      const data = await response.json();
      return this.mapTestCaseFromApi(data);
    } catch (error: any) {
      console.error('Error getting test case:', error);
      this.notificationService.showError(`Failed to get test case: ${error.message || error}`);
      return null;
    }
  }

  // Filter methods
  updateFilters(filters: Partial<FilterState>, triggerLoad: boolean = true): void {
    this.filterState.set({ ...this.filterState(), ...filters });
    if (triggerLoad) {
      this.resetPaging();
      void this.loadTestCases();
    }
  }

  clearFilters(): void {
    this.filterState.set({
      component: '',
      sprint: '',
      search: '',
      jql: '',
      status: '',
      assignee: '',
      assigneeCurrentUser: false,
      reporter: '',
      reporterCurrentUser: false
    });
    this.resetPaging();
    void this.loadTestCases();
  }

  // Pagination methods
  goToPage(pageIndex: number): void {
    const tokens = this.pageTokens();
    if (pageIndex < 0 || pageIndex >= tokens.length) return;
    this.currentPage.set(pageIndex);
    void this.loadTestCases();
  }

  nextPage(): void {
    if (this.isLastPage()) return;
    const nextTokenKnown = this.pageTokens()[this.currentPage() + 1];
    if (nextTokenKnown === undefined) return;
    this.currentPage.update(v => v + 1);
    void this.loadTestCases();
  }

  previousPage(): void {
    if (this.currentPage() === 0) return;
    this.currentPage.update(v => v - 1);
    void this.loadTestCases();
  }

  // Utility methods
  isRowLoading(id: string): boolean {
    return !!this.rowExecutionLoading()[id];
  }

  private setRowLoading(id: string, loading: boolean): void {
    const map = { ...this.rowExecutionLoading() };
    map[id] = loading;
    this.rowExecutionLoading.set(map);
  }

  // ===== AI Test Case Generation (Existing Functionality) =====
  
  generateTestCases(issue: JiraIssue, isAdditional: boolean = false, existingTestCases: TestCase[] = [], specialComments?: string): Observable<any> {
    const payload: GenerateTestCaseRequest = {
      prompt: issue.description || '',
      issue_key: issue.key,
      summary: issue.summary || '',
      issue_type: issue.issue_type || '',
      status: issue.status || '',
      existing_test_cases: existingTestCases,
      conversation_history: this.conversationHistorySubject.value,
      special_comments: specialComments
    };

    return this.http.post<any>(this.apiConfig.getFullUrl('backend', 'generateTestCases'), payload).pipe(
      catchError((error) => {
        // Re-throw the error to be handled by the component
        return throwError(() => error);
      })
    );
  }

  updateTestCases(testCases: TestCase[], append: boolean = false): void {
    const testCasesWithStatus = testCases.map(testCase => ({
      ...testCase,
      executionStatus: testCase.executionStatus || 'not-executed' as 'not-executed'
    }));

    if (append) {
      const currentTestCases = this.testCasesSubject.value;
      this.testCasesSubject.next([...currentTestCases, ...testCasesWithStatus]);
    } else {
      this.testCasesSubject.next(testCasesWithStatus);
    }
  }

  addTestCase(testCase: TestCase): void {
    const currentTestCases = this.testCasesSubject.value;
    const newTestCase = {
      ...testCase,
      executionStatus: testCase.executionStatus || 'not-executed' as 'not-executed'
    };
    this.testCasesSubject.next([...currentTestCases, newTestCase]);
  }

  updateTestCaseLocal(updatedTestCase: TestCase): void {
    const currentTestCases = this.testCasesSubject.value;
    const index = currentTestCases.findIndex(tc => tc.id === updatedTestCase.id);
    if (index !== -1) {
      currentTestCases[index] = updatedTestCase;
      this.testCasesSubject.next([...currentTestCases]);
    }
  }

  deleteTestCaseLocal(testCaseId: string): void {
    const currentTestCases = this.testCasesSubject.value;
    const filteredTestCases = currentTestCases.filter(tc => tc.id !== testCaseId);
    this.testCasesSubject.next(filteredTestCases);
  }

  updateConversationHistory(history: ConversationMessage[]): void {
    this.conversationHistorySubject.next(history);
  }

  clearConversationHistory(): void {
    this.conversationHistorySubject.next([]);
  }

  getCurrentTestCases(): TestCase[] {
    return this.testCasesSubject.value;
  }

  getCurrentConversationHistory(): ConversationMessage[] {
    return this.conversationHistorySubject.value;
  }

  exportToExcel(testCases: TestCase[], issueKey: string): void {
    import('xlsx').then(XLSX => {
      const worksheet = XLSX.utils.json_to_sheet(
        testCases.map((tc, index) => ({
          'ID': tc.id,
          'Title': tc.title,
          'Steps': tc.steps,
          'Expected Result': tc.expectedResult,
          'Priority': tc.priority,
          'Execution Status': tc.executionStatus || 'not-executed'
        }))
      );

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Test Cases');

      const fileName = `test-cases-${issueKey}-${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(workbook, fileName);
    });
  }

  async createManualTestCase(formData: CreateTestCaseForm): Promise<boolean> {
    try {
      const payload = {
        summary: formData.summary,
        description: formData.description,
        steps: formData.steps,
        expectedResult: formData.expectedResult,
        component: formData.component,
        addCurrentSprint: formData.addCurrentSprint,
        version_id: formData.version,
        cycle_id: formData.testCycle,
        relatedTask: formData.relatedTask,
        executionStatus: formData.executionStatus
      };

      const response = await fetch(`${this.apiConfig.TCsAPIURL}/full-create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || `HTTP ${response.status}`);
      }

      this.notificationService.showSuccess('Test case created successfully!');
      return true;
    } catch (error: any) {
      console.error('Error creating test case:', error);
      this.notificationService.showError(`Failed to create test case: ${error.message || error}`);
      return false;
    }
  }
}
