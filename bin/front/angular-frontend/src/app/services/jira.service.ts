import { Injectable, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { JiraIssue, JiraIssuesResponse, JiraComponent, JiraSprint } from '../models/jira-issue.model';
import { ApiConfigService } from './api-config.service';

@Injectable({
  providedIn: 'root'
})
export class JiraService {
  // Signal-based state
  private components = signal<JiraComponent[]>([]);
  private sprints = signal<JiraSprint[]>([]);
  private versions = signal<any[]>([]);

  // Public readonly signals
  readonly componentsData = this.components.asReadonly();
  readonly sprintsData = this.sprints.asReadonly();
  readonly versionsData = this.versions.asReadonly();

  constructor(
    private http: HttpClient,
    private apiConfig: ApiConfigService
  ) {
    // Load initial data
    this.loadComponentsData();
    this.loadSprintsData();
    this.loadVersionsData();
  }

  getIssues(filters: {
    issueType?: string;
    component?: string;
    sprint?: string;
    status?: string;
    jqlQuery?: string;
    startAt?: number;
    maxResults?: number;
    pageToken?: string | null;
  } = {}): Observable<JiraIssuesResponse> {
    let params = new HttpParams()
      .set('project_key', this.apiConfig.jiraProjectKey)
      .set('max_results', (filters.maxResults || 25).toString());

    // Use next_page_token if provided (for cursor-based pagination)
    if (filters.pageToken) {
      params = params.set('next_page_token', filters.pageToken);
    } else if (filters.startAt !== undefined) {
      params = params.set('start_at', filters.startAt.toString());
    }

    if (filters.issueType) {
      params = params.set('issue_type', filters.issueType);
    }
    if (filters.component) {
      params = params.set('component', filters.component);
    }
    if (filters.sprint) {
      params = params.set('sprint', filters.sprint);
    }
    if (filters.status) {
      params = params.set('status', filters.status);
    }

    if (filters.jqlQuery) {
      params = params.set('jql_filter', filters.jqlQuery);
    } else {
      // Build JQL from individual filters
      const jqlFilter = [];
      if (filters.issueType) jqlFilter.push(`issuetype = "${filters.issueType}"`);
      if (filters.component) jqlFilter.push(`component = "${filters.component}"`);
      if (filters.sprint) jqlFilter.push(`sprint = "${filters.sprint}"`);
      if (filters.status) jqlFilter.push(`status = "${filters.status}"`);
      
      if (jqlFilter.length > 0) {
        params = params.set('jql_filter', jqlFilter.join(' AND '));
      }
    }

    return this.http.get<JiraIssuesResponse>(this.apiConfig.getFullUrl('jira', 'jiraIssues'), { params });
  }

  getComponents(): Observable<JiraComponent[]> {
    const params = new HttpParams().set('project_key', this.apiConfig.jiraProjectKey);
    return this.http.get<JiraComponent[]>(this.apiConfig.getFullUrl('jira', 'jiraComponents'), { params });
  }

  getSprints(boardId?: number): Observable<{ sprints: JiraSprint[] }> {
    const id = boardId || this.apiConfig.jiraBoardId;
    return this.http.get<{ sprints: JiraSprint[] }>(`${this.apiConfig.getFullUrl('jira', 'jiraSprints')}?board_id=${id}`);
  }

  getBoards(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiConfig.getFullUrl('jira', 'jiraBoards')}?project_key=${this.apiConfig.jiraProjectKey}`);
  }

  // Import test cases to Jira
  importTestCasesToJira(testCases: any[], options: {
    projectKey?: string;
    versionId?: string;
    cycleId?: string;
    folderId?: string;
    issueInfo?: {
      key?: string;
      sprintId?: number;
      sprint?: string;
      component?: string;
      components?: string[];
    };
  } = {}): Observable<any> {
    // Transform test cases to match the API schema
    const transformedTestCases = testCases.map(testCase => ({
      summary: testCase.title || testCase.summary || '',
      description: testCase.title || testCase.summary || '', // Use title as description too
      components: options.issueInfo?.components || (options.issueInfo?.component ? [options.issueInfo.component] : ["Supply Chain"]), // Use components array from issue
      related_issues: options.issueInfo?.key ? [options.issueInfo.key] : [], // Map issue key
      steps: this.parseStepsToArray(testCase.steps || ''),
      version_id: parseInt(options.versionId || '-1'),
      cycle_id: parseInt(options.cycleId || '-1'),
      sprint: options.issueInfo?.sprint || '', // Use sprint name from issue
      sprint_id: options.issueInfo?.sprintId || this.getSprintIdByName(options.issueInfo?.sprint || '') || 0, // Get sprint ID from name or use provided ID
      execution_status: {
        id: this.getExecutionStatusId(testCase.executionStatus || 'not-executed')
      }
    }));

    const payload = {
      TestCases: transformedTestCases,
      version_id: parseInt(options.versionId || '-1'),
      cycle_id: parseInt(options.cycleId || '-1')
    };

    return this.http.post<any>(`http://localhost:8000/api/test-cases/bulk/full-create`, payload);
  }

  // Helper method to parse steps string into array format
  private parseStepsToArray(stepsString: string): any[] {
    if (!stepsString) return [];
    
    // Split by numbered steps (1., 2., 3., etc.) or line breaks
    const stepLines = stepsString
      .split(/\d+\.\s*/)
      .filter(step => step.trim())
      .map(step => step.trim());
    
    if (stepLines.length === 0) {
      // If no numbered steps found, treat as single step
      return [{
        step: stepsString.trim(),
        stepDescription: stepsString.trim(),
        data: "",
        result: ""
      }];
    }
    
    // Convert each step to the expected format
    return stepLines.map(stepText => ({
      step: stepText,
      stepDescription: stepText,
      data: "",
      result: stepText.toLowerCase().includes('result') || stepText.toLowerCase().includes('should') ? stepText : ""
    }));
  }

  // Helper method to get execution status ID
  private getExecutionStatusId(status: string): number {
    const statusMap: { [key: string]: number } = {
      'not-executed': -1,
      'passed': 1,
      'failed': 2,
      'blocked': 4
    };
    return statusMap[status] || 1;
  }

  // Get project versions
  getVersions(): Observable<any[]> {
    const params = new HttpParams()
      .set('all', 'true')
      .set('max_per_page', '50')
      .set('order_by', '-releaseDate')
    return this.http.get<any[]>(`http://localhost:8000/api/jira/versions`, { params });
  }

  // Get Zephyr test cycles
  getTestCycles(versionId: number = -1): Observable<any> {
    const params = new HttpParams()
      .set('version_id', versionId.toString())
      .set('offset', '0')
      .set('limit', '50');
    return this.http.get<any>(`http://localhost:8000/api/zephyr/cycles`, { params });
  }

  // Load components data into signal
  loadComponentsData(): void {
    this.getComponents().subscribe({
      next: (components) => this.components.set(components),
      error: (error) => console.error('Failed to load components:', error)
    });
  }

  // Load sprints data into signal
  loadSprintsData(): void {
    this.getSprints().subscribe({
      next: (data) => this.sprints.set(data.sprints || []),
      error: (error) => console.error('Failed to load sprints:', error)
    });
  }

  // Load versions data into signal
  loadVersionsData(): void {
    this.getVersions().subscribe({
      next: (versions) => this.versions.set(versions),
      error: (error) => console.error('Failed to load versions:', error)
    });
  }

  // Get active sprint
  getActiveSprint(): JiraSprint | undefined {
    return this.sprints().find((sprint: JiraSprint) => sprint.isActive || sprint.state === 'active');
  }

  // Get sprint ID by sprint name
  getSprintIdByName(sprintName: string): number | undefined {
    if (!sprintName) return undefined;
    const sprint = this.sprints().find((s: JiraSprint) => s.name === sprintName);
    return sprint?.id;
  }

  

  // Transitions state
  private transitions = signal<any[]>([]);
  
  // Get transitions data
  getTransitionsData(): readonly any[] {
    return this.transitions() || [];
  }

  // List transitions for a Jira issue
  async listTransitions(jiraID: string): Promise<any[]> {
    try {
      const response = await fetch(`${this.apiConfig.apiUrl}/test-cases/${jiraID}/listTransitions`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const data = await response.json();
      const raw = Array.isArray(data) ? data : (data?.transitions ?? []);
      
      const list = raw
        .map((t: any) => ({
          id: String(t?.id ?? ''),
          name: String(t?.name ?? ''),
        }))
        .filter((t: { id: any; name: any; }) => t.id && t.name);
      
      this.transitions.set(list);
      return list;
    } catch (error) {
      console.error('Failed to list transitions:', error);
      return [];
    }
  }

  // Update test case in Jira
  async updateTestCase(testCase: any): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiConfig.apiUrl}/test-cases/${testCase.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: testCase.summary,
          description: testCase.description,
          component: testCase.component,
          sprint: testCase.sprint,
          status: testCase.status,
          priority: testCase.priority,
          related_task: testCase.relatedTask
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || `HTTP ${response.status}`);
      }

      const result = await response.json();
      return result.success;
    } catch (error: any) {
      console.error('Failed to update test case in Jira:', error);
      return false;
    }
  }

  // Get sub-tasks for a story
  getSubtasks(storyKey: string): Observable<any> {
    return this.http.get<any>(`http://localhost:8000/api/jira/stories/${storyKey}/subtasks`);
  }
}
