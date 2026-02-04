import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './services/theme.service';
import { JiraService } from './services/jira.service';
import { TestCaseService } from './services/test-case.service';
import { BadgeUtilsService } from './services/badge-utils.service';
import { ConnectionStatusService, ConnectionStatus } from './services/connection-status.service';
import { ApiConfigService } from './services/api-config.service';
import { ZephyrService } from './services/zephyr.service';
import { NotificationService } from './services/notification.service';
import { JiraIssue, JiraIssuesResponse, JiraComponent, JiraSprint } from './models/jira-issue.model';
import { TestCase } from './models/test-case.model';
import { CreateTestCaseModalComponent } from './components/modals/create/create-test-case-modal.component';
import { EditTestCaseModalComponent } from './components/modals/edit/edit-test-case-modal.component';
import { ViewTestCaseModalComponent } from './components/modals/view/view-test-case-modal.component';
import { CreateExecutionModalComponent } from './components/modals/create-execution/create-execution-modal.component';
import { TestCaseListComponent } from './components/test-case-list/test-case-list.component';
import { ToastNotificationComponent } from './components/shared/toast-notification/toast-notification.component';
import { FeedbackModalComponent, FeedbackType } from './components/feedback/feedback-modal.component';
import { FeedbackService } from './services/feedback.service';
import { AiJqlService } from './services/ai-jql.service';

declare var bootstrap: any;

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet, 
    CommonModule, 
    FormsModule,
    CreateTestCaseModalComponent,
    EditTestCaseModalComponent,
    ViewTestCaseModalComponent,
    CreateExecutionModalComponent,
    TestCaseListComponent,
    ToastNotificationComponent,
    FeedbackModalComponent
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit {
  title = 'TestCaseGenie';
  
  // Filter properties
  jqlFilter = '';
  issueTypeFilter = '';
  componentFilter = '';
  sprintFilter = '';
  statusFilter = '';
  
  // AI JQL Search properties
  aiSearchInput = '';
  isGeneratingJql = false;
  showAiSuggestions = false;
  aiSuggestions: string[] = [];
  isLoadingAiSuggestions = false;
  private aiSuggestionsTimeout: any;
  
  // Data properties
  jiraIssues: JiraIssue[] = [];
  components: JiraComponent[] = [];
  sprints: JiraSprint[] = [];
  testCases: TestCase[] = [];
  
  // Status options for filter
  statusOptions = ['Open', 'To-do', 'In Progress', 'Resolved', 'In QA', 'Closed'];
  
  // Issues Pagination (token-based)
  issuesCurrentPage = 0;
  issuesPageSize = 25;
  issuesTotalResults = 0;
  issuesPageTokens: (string | null)[] = [null];
  issuesIsLastPage = false;
  issuesNextPageToken: string | null = null;
  
  // Legacy pagination (kept for backward compatibility)
  currentStartAt = 0;
  totalResults = 0;
  maxResults = 25;
  
  // Loading states
  isLoadingIssues = false;
  isGeneratingTestCases = false;
  
  // Current issue for test case generation
  currentIssue: JiraIssue | null = null;
  specialComments: string = '';
  
  // Modal references
  issueDetailsModal: any;
  addTestCaseModal: any;
  editTestCaseModal: any;
  editGeneratedTestCaseModal: any;
  viewIssueModal: any;
  
  // Form data for modals
  newTestCase: Partial<TestCase> = {
    title: '',
    steps: '',
    expectedResult: '',
    priority: 'medium'
  };
  
  editingTestCase: TestCase | null = null;
  editingGeneratedTestCase: TestCase | null = null;


  // Import to Jira properties
  isImportingToJira = false;
  jiraVersions: any[] = [];
  testCycles: any[] = [];
  selectedVersionId: string = '';
  selectedCycleId: string = '';
  importToJiraModal: any;
  isLoadingVersions: boolean = false;
  isLoadingCycles: boolean = false;
  
  // Sub-tasks properties
  subtasks: any[] = [];
  selectedSubtaskKey: string = '';
  isLoadingSubtasks: boolean = false;

  // Tab management for Issues/Test Cases view
  activeTab: 'issues' | 'testCases' = 'issues';

  // Jira test cases (from manual creation)
  jiraTestCases: TestCase[] = [];
  isLoadingJiraTestCases = false;
  
  // Test Cases Pagination (cursor-based)
  testCasesCurrentPage = 0;
  testCasesPageSize = 10;
  testCasesTotalResults = 0;
  testCasesPageTokens: (string | null)[] = [null];
  testCasesIsLastPage = false;
  testCasesNextPageToken: string | null = null;
  // Migrated features - Manual test case creation
  showCreateTestCaseModal = false;
  showEditTestCaseModal = false;
  showViewTestCaseModal = false;
  showCreateExecutionModal = false;
  selectedTestCaseForExecution: string = '';
  viewingTestCase: TestCase | null = null;
  skeletonArray = Array(25).fill(0).map((_, i) => i);

  // Row loading states for execution status loading
  executionRowLoadingStates = new Map<string, boolean>();

  // Feedback system
  showFeedbackModal = false;
  currentFeedbackType: FeedbackType = 'compliment';

  // Services (modern inject pattern)
  private zephyrService = inject(ZephyrService);

  constructor(
    public themeService: ThemeService,
    private jiraService: JiraService,
    private testCaseService: TestCaseService,
    public badgeUtils: BadgeUtilsService,
    private connectionStatusService: ConnectionStatusService,
    public apiConfig: ApiConfigService,
    private notificationService: NotificationService,
    private feedbackService: FeedbackService,
    private aiJqlService: AiJqlService
  ) {}

  ngOnInit(): void {
    this.loadInitialData();
    this.subscribeToTestCases();
    this.initializeModals();
    this.initializeMigratedServices();
    this.subscribeToAiSuggestions();
  }

  private subscribeToAiSuggestions(): void {
    // Subscribe to AI suggestions from the service
    this.aiJqlService.suggestions$.subscribe(suggestions => {
      this.aiSuggestions = suggestions;
    });
    this.aiJqlService.loadingSuggestions$.subscribe(loading => {
      this.isLoadingAiSuggestions = loading;
    });
  }

  private initializeMigratedServices(): void {
    // Initialize Zephyr execution statuses
    this.zephyrService.preloadExecutionStatuses();
  }

  private loadInitialData(): void {
    this.loadJiraComponents();
    this.loadJiraSprints();
    this.loadJiraIssues();
  }

  private subscribeToTestCases(): void {
    this.testCaseService.testCases$.subscribe(testCases => {
      this.testCases = testCases;
    });
  }

  private initializeModals(): void {
    // Initialize Bootstrap modals after view init
    setTimeout(() => {
      const issueDetailsModalEl = document.getElementById('issueDetailsModal');
      const addTestCaseModalEl = document.getElementById('addTestCaseModal');
      const editGeneratedTestCaseModalEl = document.getElementById('editGeneratedTestCaseModal');
      const viewIssueModalEl = document.getElementById('viewIssueModal');
      const importToJiraModalEl = document.getElementById('importToJiraModal');
      
      if (issueDetailsModalEl) {
        this.issueDetailsModal = new bootstrap.Modal(issueDetailsModalEl);
      }
      if (addTestCaseModalEl) {
        this.addTestCaseModal = new bootstrap.Modal(addTestCaseModalEl);
      }
      if (editGeneratedTestCaseModalEl) {
        this.editGeneratedTestCaseModal = new bootstrap.Modal(editGeneratedTestCaseModalEl);
      }
      if (viewIssueModalEl) {
        this.viewIssueModal = new bootstrap.Modal(viewIssueModalEl);
      }
      if (importToJiraModalEl) {
        this.importToJiraModal = new bootstrap.Modal(importToJiraModalEl);
      }
    }, 100);
  }

  loadJiraComponents(): void {
    this.jiraService.getComponents().subscribe({
      next: (components) => {
        this.components = components;
      },
      error: (error) => {
        console.error('Error loading components:', error);
        this.notificationService.showError('Failed to load Jira components. Please ensure you are connected to the VPN and try again.');
      }
    });
  }

  loadJiraSprints(): void {
    this.jiraService.getSprints().subscribe({
      next: (data) => {
        this.sprints = data.sprints || [];
      },
      error: (error) => {
        console.error('Error loading sprints:', error);
        this.notificationService.showError('Failed to load Jira sprints. Please ensure you are connected to the VPN and try again.');
      }
    });
  }

  loadJiraIssues(): void {
    this.isLoadingIssues = true;
    
    const pageIdx = this.issuesCurrentPage;
    const tokenForThisPage = this.issuesPageTokens[pageIdx] ?? null;
    
    const filters = {
      issueType: this.issueTypeFilter,
      component: this.componentFilter,
      sprint: this.sprintFilter,
      status: this.statusFilter,
      jqlQuery: this.jqlFilter.trim(),
      pageToken: tokenForThisPage,
      maxResults: this.issuesPageSize
    };

    console.log('🔍 Loading Issues - Page:', pageIdx, 'Token:', tokenForThisPage);

    this.jiraService.getIssues(filters).subscribe({
      next: (response: JiraIssuesResponse) => {
        this.jiraIssues = response.issues || [];
        this.issuesTotalResults = response.total || 0;
        
        // Store next page token
        this.issuesNextPageToken = response.nextPageToken ?? null;
        this.issuesIsLastPage = !!response.isLast || this.issuesNextPageToken === null;
        
        // Store token for the next page
        const tokens = this.issuesPageTokens.slice();
        tokens[pageIdx + 1] = this.issuesNextPageToken;
        this.issuesPageTokens = tokens;
        
        // Update legacy properties for backward compatibility
        this.totalResults = this.issuesTotalResults;
        this.currentStartAt = pageIdx * this.issuesPageSize;
        
        console.log('✅ Issues Loaded:', {
          currentPage: this.issuesCurrentPage,
          pageSize: this.issuesPageSize,
          total: this.issuesTotalResults,
          isLastPage: this.issuesIsLastPage,
          nextToken: this.issuesNextPageToken
        });
        
        this.isLoadingIssues = false;
      },
      error: (error) => {
        console.error('Error loading issues:', error);
        this.jiraIssues = [];
        this.issuesTotalResults = 0;
        this.totalResults = 0;
        this.isLoadingIssues = false;
        this.notificationService.showError('Failed to load Jira issues. Please ensure you are connected to the VPN and try again.');
      }
    });
  }

  applyFilters(): void {
    // Reset pagination for both tables
    this.issuesCurrentPage = 0;
    this.issuesPageTokens = [null];
    this.issuesIsLastPage = false;
    this.currentStartAt = 0;
    
    this.testCasesCurrentPage = 0;
    this.testCasesPageTokens = [null];
    this.testCasesIsLastPage = false;
    
    // Reload both tables
    this.loadJiraIssues();
    this.loadJiraTestCases();
  }

  clearFilters(): void {
    this.issueTypeFilter = '';
    this.jqlFilter = '';
    this.componentFilter = '';
    this.sprintFilter = '';
    this.statusFilter = '';
    this.aiSearchInput = '';
    
    // Reset pagination for both tables
    this.issuesCurrentPage = 0;
    this.issuesPageTokens = [null];
    this.issuesIsLastPage = false;
    this.currentStartAt = 0;
    
    this.testCasesCurrentPage = 0;
    this.testCasesPageTokens = [null];
    this.testCasesIsLastPage = false;
    
    // Reload both tables
    this.loadJiraIssues();
    this.loadJiraTestCases();
  }

  // AI JQL Search Methods
  onAiSearchInputChange(event: Event): void {
    const input = (event.target as HTMLInputElement).value;
    // Trigger debounced API call for suggestions
    this.aiJqlService.searchSuggestions(input);
    this.showAiSuggestions = true;
  }

  selectAiSuggestion(suggestion: string): void {
    this.aiSearchInput = suggestion;
    this.showAiSuggestions = false;
    this.aiJqlService.clearSuggestions();
    this.generateJqlFromAi();
  }

  hideAiSuggestionsDelayed(): void {
    this.aiSuggestionsTimeout = setTimeout(() => {
      this.showAiSuggestions = false;
    }, 200);
  }

  generateJqlFromAi(): void {
    if (!this.aiSearchInput.trim() || this.isGeneratingJql) {
      return;
    }

    this.isGeneratingJql = true;
    this.showAiSuggestions = false;
    this.aiJqlService.clearSuggestions();

    this.aiJqlService.generateJQL(this.aiSearchInput.trim()).subscribe({
      next: (response) => {
        if (response.generated_jql) {
          // Set the JQL filter field with the generated JQL
          this.jqlFilter = response.generated_jql;
          
          // Show success notification
          this.notificationService.showSuccess('JQL generated successfully!');
          
          // Auto-apply the search
          this.applyFilters();
        } else if (response.error) {
          this.notificationService.showError(`Failed to generate JQL: ${response.error}`);
        }
        this.isGeneratingJql = false;
      },
      error: (error) => {
        console.error('Error generating JQL:', error);
        this.notificationService.showError('Failed to generate JQL. Please check your connection and try again.');
        this.isGeneratingJql = false;
      }
    });
  }

  // Issues Pagination Methods (Token-based)
  issuesNextPage(): void {
    if (this.issuesIsLastPage) return;
    const nextTokenKnown = this.issuesPageTokens[this.issuesCurrentPage + 1];
    if (nextTokenKnown === undefined) return;
    this.issuesCurrentPage++;
    this.loadJiraIssues();
  }

  issuesPreviousPage(): void {
    if (this.issuesCurrentPage === 0) return;
    this.issuesCurrentPage--;
    this.loadJiraIssues();
  }

  issuesGoToPage(pageIndex: number): void {
    const tokens = this.issuesPageTokens;
    if (pageIndex < 0 || pageIndex >= tokens.length) return;
    this.issuesCurrentPage = pageIndex;
    this.loadJiraIssues();
  }

  // Legacy pagination methods (kept for backward compatibility)
  previousPage(): void {
    this.issuesPreviousPage();
  }

  nextPage(): void {
    this.issuesNextPage();
  }

  showIssueDetails(issue: JiraIssue): void {
    this.currentIssue = issue;
    console.log('📌 Selected Issue:', issue);
    console.log('📦 Issue Components:', issue.components);
    console.log('🏃 Issue Sprint:', issue.sprint);
    // Keep special comments from previous session, don't clear automatically
    if (this.issueDetailsModal) {
      this.issueDetailsModal.show();
    }
  }

  clearSpecialComments(): void {
    this.specialComments = '';
  }

  generateTestCases(): void {
    if (!this.currentIssue) return;
    
    this.isGeneratingTestCases = true;
    
    this.testCaseService.generateTestCases(this.currentIssue, false, [], this.specialComments).subscribe({
      next: (response) => {
        const testCases = Array.isArray(response) ? response : (response.testCases || response.data || []);
        this.testCaseService.updateTestCases(testCases);
        
        // Update conversation history if available
        if (response.conversation_history) {
          this.testCaseService.updateConversationHistory(response.conversation_history);
        }
        
        this.isGeneratingTestCases = false;
        this.showSuccessToast(`Generated ${testCases.length} test cases successfully!`);
        
        // Close the modal
        if (this.issueDetailsModal) {
          this.issueDetailsModal.hide();
        }
      },
      error: (error) => {
        this.isGeneratingTestCases = false;
        console.error('Error generating test cases:', error);
        
        // Close the modal so the toast notification is visible
        if (this.issueDetailsModal) {
          this.issueDetailsModal.hide();
        }
        
        this.showErrorToast('Failed to generate test cases. Please ensure you are connected to the VPN and try again.');
      }
    });
  }
  generateMoreTestCases(): void {
    if (!this.currentIssue) return;
    
    this.isGeneratingTestCases = true;
    const existingTestCases = this.testCaseService.getCurrentTestCases();
    
    this.testCaseService.generateTestCases(this.currentIssue, true, existingTestCases, this.specialComments).subscribe({
      next: (response) => {
        const testCases = Array.isArray(response) ? response : (response.testCases || response.data || []);
        this.testCaseService.updateTestCases(testCases, true);
        
        if (response.conversation_history) {
          this.testCaseService.updateConversationHistory(response.conversation_history);
        }
        
        this.isGeneratingTestCases = false;
        this.showSuccessToast(`Successfully generated ${testCases.length} more test cases!`);
      },
      error: (error) => {
        console.error('Error generating more test cases:', error);
        this.isGeneratingTestCases = false;
        this.showErrorToast('Failed to generate more test cases. Please ensure you are connected to the VPN and try again.');
      }
    });
  }

  showAddTestCaseModal(): void {
    this.newTestCase = {
      title: '',
      steps: '',
      expectedResult: '',
      priority: 'medium'
    };
    if (this.addTestCaseModal) {
      this.addTestCaseModal.show();
    }
  }

  addTestCase(): void {
    if (this.newTestCase.title && this.newTestCase.steps && this.newTestCase.expectedResult) {
      // Generate incremental ID based on existing test cases
      const nextId = this.getNextTestCaseId();
      
      const testCase: TestCase = {
        id: nextId.toString(),
        title: this.newTestCase.title,
        steps: this.newTestCase.steps,
        expectedResult: this.newTestCase.expectedResult,
        priority: this.newTestCase.priority as 'high' | 'medium' | 'low',
        executionStatus: 'not-executed'
      };
      
      this.testCaseService.addTestCase(testCase);
      
      if (this.addTestCaseModal) {
        this.addTestCaseModal.hide();
      }
      
      this.showSuccessToast('Test case added successfully!');
    }
  }

  // Helper method to generate the next incremental test case ID
  private getNextTestCaseId(): number {
    if (this.testCases.length === 0) {
      return 1;
    }
    
    // Find the highest numeric ID from existing test cases
    let maxId = 0;
    this.testCases.forEach(testCase => {
      const numericId = parseInt(testCase.id);
      if (!isNaN(numericId) && numericId > maxId) {
        maxId = numericId;
      }
    });
    
    return maxId + 1;
  }



  // Methods for Generated Test Cases (local AI-generated test cases)
  showEditGeneratedTestCaseModal(testCase: TestCase): void {
    this.editingGeneratedTestCase = { ...testCase };
    if (this.editGeneratedTestCaseModal) {
      this.editGeneratedTestCaseModal.show();
    }
  }

  saveGeneratedTestCaseChanges(): void {
    if (this.editingGeneratedTestCase) {
      // Update the local test case in the array (for AI-generated test cases)
      this.testCaseService.updateTestCaseLocal(this.editingGeneratedTestCase);
      
      if (this.editGeneratedTestCaseModal) {
        this.editGeneratedTestCaseModal.hide();
      }
      
      this.showSuccessToast('Test case updated successfully!');
    }
  }

  deleteGeneratedTestCase(testCaseId: string): void {
    if (confirm('Are you sure you want to delete this test case?')) {
      // Use deleteTestCaseLocal for AI-generated test cases (local array)
      this.testCaseService.deleteTestCaseLocal(testCaseId);
      this.showSuccessToast('Test case deleted successfully!');
    }
  }

  // Legacy method kept for compatibility
  deleteTestCase(testCaseId: string): void {
    this.deleteGeneratedTestCase(testCaseId);
  }

  exportToExcel(): void {
    if (this.testCases.length > 0 && this.currentIssue) {
      this.testCaseService.exportToExcel(this.testCases, this.currentIssue.key);
    }
  }

  private showSuccessToast(message: string): void {
    this.notificationService.showSuccess(message);
  }

  private showErrorToast(message: string): void {
    this.notificationService.showError(message);
  }

  // Issues Pagination Info (Token-based)
  get issuesPaginationInfo(): any {
    const current = this.issuesCurrentPage;
    const size = this.issuesPageSize;
    const total = this.issuesTotalResults;
    const knownTotal = typeof total === 'number' && total > 0;
    
    const startItem = current * size + 1;
    const endItem = Math.min(startItem + this.jiraIssues.length - 1, total);
    
    return {
      currentPage: current,
      pageSize: size,
      total: total,
      startItem: startItem,
      endItem: endItem,
      totalPages: knownTotal ? Math.ceil(total / size) : '?',
      displayText: this.jiraIssues.length > 0 
        ? `${startItem}-${endItem} of ${knownTotal ? total : '?'} items`
        : '0 items'
    };
  }

  get issuesPageNumbers(): Array<number | 'ellipsis'> {
    const current = this.issuesCurrentPage;
    const totalPages = this.issuesPaginationInfo.totalPages;
    const pages: Array<number | 'ellipsis'> = [];

    if (typeof totalPages !== 'number') {
      // Don't show page numbers if we don't know total
      return [];
    }

    if (totalPages <= 7) {
      for (let i = 0; i < totalPages; i++) pages.push(i);
    } else {
      pages.push(0);
      if (current > 2) pages.push('ellipsis');
      for (let i = Math.max(1, current - 1); i <= Math.min(totalPages - 2, current + 1); i++) {
        pages.push(i);
      }
      if (current < totalPages - 3) pages.push('ellipsis');
      pages.push(totalPages - 1);
    }
    return pages;
  }

  // Legacy pagination getters (kept for backward compatibility)
  get canGoToPreviousPage(): boolean {
    return this.issuesCurrentPage > 0;
  }

  get canGoToNextPage(): boolean {
    return !this.issuesIsLastPage;
  }

  get paginationInfo(): string {
    return this.issuesPaginationInfo.displayText;
  }

  private initializeViewIssueModal(): void {
    setTimeout(() => {
      const viewIssueModalEl = document.getElementById('viewIssueModal');
      if (viewIssueModalEl) {
        this.viewIssueModal = new bootstrap.Modal(viewIssueModalEl);
      }
    }, 100);
  }

  viewIssueDetails(issue: JiraIssue): void {
    this.currentIssue = issue;
    if (!this.viewIssueModal) {
      this.initializeViewIssueModal();
      setTimeout(() => {
        if (this.viewIssueModal) {
          this.viewIssueModal.show();
        }
      }, 200);
    } else {
      this.viewIssueModal.show();
    }
  }

  generateTestCasesFromView(): void {
    if (this.viewIssueModal) {
      this.viewIssueModal.hide();
    }
    setTimeout(() => {
      this.generateTestCases();
    }, 300);
  }

  updateTestCaseStatus(testCase: TestCase): void {
    this.testCaseService.updateTestCaseLocal(testCase);
    this.showSuccessToast(`Test case status updated to ${testCase.executionStatus}`);
  }

  // TrackBy functions for performance
  trackByIssueKey(index: number, issue: JiraIssue): string {
    return issue.key;
  }

  trackByTestCaseId(index: number, testCase: TestCase): string {
    return testCase.id;
  }

  // Math reference for template
  Math = Math;

  // Import to Jira functionality
  showImportToJiraModal(): void {
    if (this.testCases.length === 0) {
      this.showErrorToast('No test cases to import. Please generate test cases first.');
      return;
    }

    // Reset selections
    this.selectedSubtaskKey = '';
    this.selectedVersionId = '';
    this.selectedCycleId = '';

    // Load Jira versions and test cycles
    this.loadJiraVersions();
    this.loadTestCycles(-1); // Load with default version_id=-1
    
    // Load subtasks if we have a current issue
    if (this.currentIssue && this.currentIssue.key) {
      this.loadSubtasks(this.currentIssue.key);
    }
    
    if (this.importToJiraModal) {
      this.importToJiraModal.show();
    }
  }

  loadSubtasks(storyKey: string): void {
    this.isLoadingSubtasks = true;
    this.subtasks = [];
    this.selectedSubtaskKey = '';
    
    this.jiraService.getSubtasks(storyKey).subscribe({
      next: (response) => {
        console.log('Loaded subtasks:', response);
        this.subtasks = response.subtasks || [];
        this.isLoadingSubtasks = false;
      },
      error: (error) => {
        console.error('Error loading subtasks:', error);
        this.subtasks = [];
        this.isLoadingSubtasks = false;
        // Don't show error toast as subtasks are optional
      }
    });
  }

  loadJiraVersions(): void {
    console.log('Loading Jira versions...');
    this.isLoadingVersions = true;
    this.jiraVersions = [];
    this.jiraService.getVersions().subscribe({
      next: (versions) => {
        console.log('Loaded versions:', versions);
        
        // Ensure we have an array
        if (Array.isArray(versions)) {
          // Sort versions by release date in descending order (newest first)
          this.jiraVersions = versions.sort((a, b) => {
            const dateA = a.releaseDate ? new Date(a.releaseDate).getTime() : 0;
            const dateB = b.releaseDate ? new Date(b.releaseDate).getTime() : 0;
            return dateB - dateA;
          });
        } else {
          console.warn('Unexpected versions response format:', versions);
          this.jiraVersions = [];
        }
        
        console.log('Sorted versions:', this.jiraVersions);
        this.isLoadingVersions = false;
      },
      error: (error) => {
        console.error('Error loading Jira versions:', error);
        this.jiraVersions = []; // Ensure it's always an array
        this.isLoadingVersions = false;
        this.showErrorToast('Failed to load Jira versions. Please ensure you are connected to the VPN and try again.');
      }
    });
  }

  loadTestCycles(versionId: number = -1): void {
    console.log('Loading test cycles for version ID:', versionId);
    this.isLoadingCycles = true;
    this.testCycles = [];
    this.jiraService.getTestCycles(versionId).subscribe({
      next: (response) => {
        console.log('Test cycles response:', response);
        
        // Handle the actual API response structure
        if (Array.isArray(response)) {
          this.testCycles = response;
        } else if (response && Array.isArray(response.items)) {
          // This is the correct structure based on your API response
          this.testCycles = response.items;
        } else if (response && Array.isArray(response.cycles)) {
          this.testCycles = response.cycles;
        } else if (response && Array.isArray(response.data)) {
          this.testCycles = response.data;
        } else {
          console.warn('Unexpected test cycles response format:', response);
          this.testCycles = [];
        }
        
        console.log('Processed test cycles:', this.testCycles);
        console.log('Test cycles count:', this.testCycles.length);
        this.isLoadingCycles = false;
      },
      error: (error) => {
        console.error('Error loading test cycles:', error);
        this.testCycles = []; // Ensure it's always an array
        this.isLoadingCycles = false;
        this.showErrorToast('Failed to load test cycles. Please ensure you are connected to the VPN and try again.');
      }
    });
  }

  onVersionChange(): void {
    console.log('Version changed to:', this.selectedVersionId);
    console.log('Is test cycle disabled?', this.isTestCycleDisabled);
    const versionId = this.selectedVersionId ? parseInt(this.selectedVersionId) : -1;
    this.selectedCycleId = ''; // Reset cycle selection
    this.loadTestCycles(versionId);
  }

  get isTestCycleDisabled(): boolean {
    const disabled = !this.selectedVersionId || this.selectedVersionId === '';
    return disabled;
  }

  importToJira(): void {
    if (this.testCases.length === 0) {
      this.showErrorToast('No test cases to import');
      return;
    }

    // Validate selections
    if (!this.selectedSubtaskKey) {
      this.showErrorToast('Please select a sub-task. Import is only allowed to sub-tasks.');
      return;
    }

    if (!this.selectedVersionId) {
      this.showErrorToast('Please select a version');
      return;
    }

    if (!this.selectedCycleId) {
      this.showErrorToast('Please select a test cycle');
      return;
    }

    this.isImportingToJira = true;

    // Only use the selected subtask key (import to subtasks only)
    const targetIssueKey = this.selectedSubtaskKey;

    // Get components array - prioritize components array, fallback to component string
    const componentsArray = this.currentIssue?.components && this.currentIssue.components.length > 0
      ? this.currentIssue.components
      : (this.currentIssue?.component ? [this.currentIssue.component] : undefined);

    const importOptions = {
      projectKey: this.apiConfig.jiraProjectKey,
      versionId: this.selectedVersionId,
      cycleId: this.selectedCycleId,
      issueInfo: targetIssueKey ? {
        key: targetIssueKey,
        sprintId: this.currentIssue?.sprint ? parseInt(this.currentIssue.sprint) : 0,
        sprint: this.currentIssue?.sprint || '',
        component: this.currentIssue?.component,
        components: componentsArray
      } : undefined
    };

    console.log('📋 Import Options:', importOptions);
    console.log('🔍 Current Issue:', this.currentIssue);
    console.log('📦 Components Array:', componentsArray);

    this.jiraService.importTestCasesToJira(this.testCases, importOptions).subscribe({
      next: (response) => {
        this.isImportingToJira = false;
        console.log('📥 Import Response:', response);
        
        // Check if import was successful (succeeded > 0 or failed === 0)
        const hasSucceeded = response.succeeded > 0 || (response.total > 0 && response.failed === 0);
        
        if (hasSucceeded) {
          const targetInfo = `sub-task ${this.selectedSubtaskKey}`;
          const message = `Successfully imported ${response.succeeded} test case${response.succeeded !== 1 ? 's' : ''} to ${targetInfo}!`;
          
          if (response.failed > 0) {
            this.showErrorToast(`${message} However, ${response.failed} test case${response.failed !== 1 ? 's' : ''} failed to import.`);
          } else {
            this.showSuccessToast(message);
          }
        } else {
          console.warn('⚠️ No test cases were successfully imported');
          this.showErrorToast('Failed to import test cases to Jira');
        }

        if (this.importToJiraModal) {
          this.importToJiraModal.hide();
        }
      },
      error: (error) => {
        this.isImportingToJira = false;
        console.error('Error importing to Jira:', error);
        this.showErrorToast('Failed to import test cases to Jira. Please ensure you are connected to the VPN and try again.');
      }
    });
  }

  get canImportToJira(): boolean {
    return this.testCases.length > 0;
  }

  get canConfirmImport(): boolean {
    return this.selectedVersionId !== '' && 
           this.selectedCycleId !== '' && 
           this.selectedSubtaskKey !== '' && 
           !this.isImportingToJira;
  }

  // Helper method to format steps for display
  formatSteps(steps: string): string {
    if (!steps) return '';
    
    // If steps already have line breaks, return as is
    if (steps.includes('\n')) {
      return steps;
    }
    
    // Check for numbered steps pattern - be more aggressive
    const numberedMatches = steps.match(/\d+\./g);
    if (numberedMatches && numberedMatches.length > 1) {
      
      // Split the string at each number followed by period
      let formatted = steps
        .replace(/(\s*)(\d+\.\s*)/g, '\n$2') // Add newline before each "number."
        .replace(/^\n/, '') // Remove leading newline
        .trim();
      
      return formatted;
    }
    
    return steps;
  }

  // Helper method to format steps as HTML
  formatStepsAsHtml(steps: string): string {
    const formatted = this.formatSteps(steps);
    return formatted.replace(/\n/g, '<br>');
  }

  // Tab switching
  switchTab(tab: 'issues' | 'testCases'): void {
    this.activeTab = tab;
    
    // Clear all filters when switching tabs
    this.clearFilters();
  }

  redirectToAutomation(): void {
    window.location.href = 'http://localhost:3000/';
  }

  redirectToRaiseBug(): void {
    window.location.href = 'http://localhost:5173/';
  }

  // Migrated features methods
  openCreateTestCaseModal(): void {
    console.log('🎯 Opening Create Test Case Modal');
    this.showCreateTestCaseModal = true;
    console.log('✅ showCreateTestCaseModal is now:', this.showCreateTestCaseModal);
  }

  closeCreateTestCaseModal(): void {
    this.showCreateTestCaseModal = false;
    this.loadJiraTestCases(); // Refresh list after creation
  }

  openViewTestCaseModal(testCase: TestCase): void {
    this.viewingTestCase = testCase;
    this.showViewTestCaseModal = true;
  }

  closeViewTestCaseModal(): void {
    this.showViewTestCaseModal = false;
    this.viewingTestCase = null;
  }

  openEditTestCaseModal(testCase: TestCase): void {
    this.editingTestCase = testCase;
    this.showEditTestCaseModal = true;
  }

  closeEditTestCaseModal(): void {
    this.showEditTestCaseModal = false;
    this.editingTestCase = null;
  }

  async editTestCaseFromView(testCaseId: string): Promise<void> {
    // Close view modal and open edit modal with the same test case
    const testCase = this.jiraTestCases.find(tc => tc.id === testCaseId || tc.jiraID === testCaseId);
    if (testCase) {
      this.closeViewTestCaseModal();
      // Load full test case details including steps
      const fullTestCase = await this.loadFullTestCaseDetails(testCase.jiraID || testCaseId);
      this.openEditTestCaseModal(fullTestCase || testCase);
    }
  }

  openCreateExecutionModal(testCaseId: string): void {
    this.selectedTestCaseForExecution = testCaseId;
    this.showCreateExecutionModal = true;
  }

  closeCreateExecutionModal(): void {
    this.showCreateExecutionModal = false;
    this.selectedTestCaseForExecution = '';
    // Don't reload table when just closing
  }

  async handleExecutionCreated(testCaseId: string): Promise<void> {
    // Reload only the specific row's execution status
    const testCaseIndex = this.jiraTestCases.findIndex(tc => tc.jiraID === testCaseId || tc.id === testCaseId);
    
    if (testCaseIndex !== -1) {
      const testCase = this.jiraTestCases[testCaseIndex];
      const numericId = testCase.jiraID;
      const rowId = testCase.jiraID || testCase.id;
      
      // Set row loading state
      this.executionRowLoadingStates.set(rowId, true);
      
      try {
        console.log("Reloading execution for numeric ID:", numericId);
        const executionData = await this.zephyrService.loadExecutionStatusForTestCase(numericId!);
        
        // Update the specific test case in the array
        this.jiraTestCases[testCaseIndex] = {
          ...testCase,
          executionId: executionData.executionId || undefined,
          executionStatus: executionData.executionStatus || 'UNEXECUTED'
        };
      } catch (error) {
        console.warn(`Failed to reload execution for ${numericId}:`, error);
      } finally {
        // Clear row loading state
        this.executionRowLoadingStates.set(rowId, false);
      }
    }
    
    // Close the modal
    this.closeCreateExecutionModal();
  }

  private async loadFullTestCaseDetails(testCaseId: string): Promise<TestCase | null> {
    try {
      // Find the test case in the current list to get basic info
      const localTestCase = this.jiraTestCases.find(
        tc => tc.jiraID === testCaseId || tc.id === testCaseId
      );

      if (!localTestCase) {
        throw new Error('Test case not found in current list');
      }

      // Fetch steps from Zephyr API using numeric ID
      const projectId = 24300; // Default project ID
      const issueId = localTestCase.jiraID;
      const zephyrUrl = `${this.apiConfig.zephyrAPIURL}/test-cases/${encodeURIComponent(issueId??localTestCase.id)}?projectId=${projectId}`;
      
      const response = await fetch(zephyrUrl);
      if (!response.ok) {
        console.warn(`Zephyr API returned ${response.status}, using local data without steps`);
        return localTestCase;
      }

      const zephyrData = await response.json();

      // Process steps exactly like the old repo
      const stepsArr = Array.isArray(zephyrData.testSteps) ? zephyrData.testSteps : [];
      const stepsText = stepsArr.length
        ? stepsArr.map((s: any, i: number) => {
            const parts = [`${i + 1}. ${s.step || ''}`];
            if (s.data) parts.push(`(Data: ${s.data})`);
            if (s.result) parts.push(`(Expected: ${s.result})`);
            return parts.join(' ');
          }).join('\n')
        : 'No steps available';

      const expectedLines = stepsArr.map((s: any) => s.result).filter(Boolean);
      const expectedText = expectedLines.length 
        ? expectedLines.join('\n') 
        : 'No expected result provided';

      // Return test case with steps from Zephyr
      return {
        ...localTestCase,
        steps: stepsText,
        expectedResult: expectedText
      };
    } catch (error) {
      console.error('Failed to load full test case details:', error);
      this.notificationService.showError('Failed to load test case details');
      return null;
    }
  }

  async loadJiraTestCases(): Promise<void> {
    this.isLoadingJiraTestCases = true;
    try {
      const pageIdx = this.testCasesCurrentPage;
      const tokenForThisPage = this.testCasesPageTokens[pageIdx] ?? null;
      
      const url = new URL(`${this.apiConfig.apiUrl}/test-cases/paginated`);
      url.searchParams.set('project_key', 'SE2');
      url.searchParams.set('max_results', this.testCasesPageSize.toString());
      url.searchParams.set('issueType', 'Test');
      
      // Apply filters from the filter panel
      if (this.componentFilter) {
        url.searchParams.set('component', this.componentFilter);
      }
      if (this.sprintFilter) {
        url.searchParams.set('sprint', this.sprintFilter);
      }
      if (this.statusFilter) {
        url.searchParams.set('status', this.statusFilter);
      }
      if (this.jqlFilter.trim()) {
        url.searchParams.set('jqlQuery', this.jqlFilter.trim());
      }
      
      // Add next_page_token if available (for pages after the first)
      if (tokenForThisPage) {
        url.searchParams.set('next_page_token', tokenForThisPage);
      }
      
      const response = await fetch(url.toString());
      if (!response.ok) {
        // Handle non-200 status codes
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('📦 API Response:', data);
      console.log('📊 Test Cases Count:', data.issues?.length || 0);
      
      // Map API response to TestCase model (API returns 'issues' not 'items')
      // IMPORTANT: id = Jira key (SE2-123), jiraID = numeric internal ID used for Zephyr API
      this.jiraTestCases = (data.issues || []).map((item: any) => {
          // Process components - handle both string arrays and object arrays
          const comps = Array.isArray(item.components)
            ? (typeof item.components[0] === 'string' ? item.components : item.components.map((c: any) => c?.name).filter(Boolean))
            : [];
          
          // Process status - handle both string and object format
          const status = (typeof item.status === 'string' ? item.status : item.status?.name) || 'Unknown';
          
          // Process priority - handle both string and object format
          const priority = (typeof item.priority === 'string' ? item.priority : item.priority?.name) || 'Medium';
          
          // Process reporter/creator - handle both string and object format
          const reporter = (typeof item.reporter === 'string' ? item.reporter : (item.reporter?.displayName || item.reporter?.name)) || '—';
          
          // Process related task
          const related = item.first_linked_issue || (Array.isArray(item.linkedKeys) ? item.linkedKeys[0] : null);
          
          return {
            id: item.key || '',                    // Jira key (SE2-123)
            jiraID: item.id || '',                 // Numeric internal ID - used for Zephyr API
            title: item.summary || item.fields?.summary || 'Untitled',
            summary: item.summary || item.fields?.summary || 'Untitled',
            description: item.description || item.fields?.description || '',
            steps: item.steps || '',
            expectedResult: item.expected_result || item.expectedResult || '',
            priority: priority,
            component: comps[0] || '',
            sprint: item.sprint || '',
            status: status,
            relatedTask: related || '',
            created: item.created || item.fields?.created || null,
            createdBy: reporter,
            executionStatus: item.executionStatus || item.execution_status || 'UNEXECUTED',
            executionId: item.executionId || item.execution_id || null,
            hasExecution: !!item.executionId || !!item.execution_id
          };
        });
        
        // Handle pagination metadata
        const total = data.total ?? data.paginated?.total ?? null;
        if (typeof total === 'number') {
          this.testCasesTotalResults = total;
        }
        
        // Store next page token
        this.testCasesNextPageToken = data.nextPageToken ?? null;
        this.testCasesIsLastPage = !!data.isLast || this.testCasesNextPageToken === null;
        
        // Store token for the next page
        const tokens = this.testCasesPageTokens.slice();
        tokens[pageIdx + 1] = this.testCasesNextPageToken;
        this.testCasesPageTokens = tokens;
        
        console.log('✅ Mapped Test Cases:', this.jiraTestCases);
        console.log('📄 Pagination:', {
          currentPage: this.testCasesCurrentPage,
          pageSize: this.testCasesPageSize,
          total: this.testCasesTotalResults,
          isLastPage: this.testCasesIsLastPage,
          nextToken: this.testCasesNextPageToken
        });
        
      // Show table immediately after paginated API responds
      this.isLoadingJiraTestCases = false;
      
      // Load execution statuses for the current page (per row, asynchronously)
      this.loadExecutionStatusesForTestCases();
    } catch (error) {
      console.error('Failed to load Jira test cases:', error);
      this.isLoadingJiraTestCases = false;
      this.notificationService.showError('Failed to load Jira test cases. Please ensure you are connected to the VPN and try again.');
    }
  }

  private loadExecutionStatusesForTestCases(): void {
    // Load execution statuses per row asynchronously
    this.jiraTestCases.forEach(async (testCase, index) => {
      const numericId = testCase.jiraID; // Use numeric internal ID for Zephyr API
      const rowId = testCase.jiraID || testCase.id;
      
      // Set row loading state
      this.executionRowLoadingStates.set(rowId, true);
      
      try {
        console.log("Loading execution for numeric ID:", numericId);
        const executionData = await this.zephyrService.loadExecutionStatusForTestCase(numericId!);
        
        // Update the specific test case in the array
        this.jiraTestCases[index] = {
          ...testCase,
          executionId: executionData.executionId || undefined,
          executionStatus: executionData.executionStatus || 'UNEXECUTED'
        };
      } catch (error) {
        console.warn(`Failed to load execution for ${numericId}:`, error);
      } finally {
        // Clear row loading state
        this.executionRowLoadingStates.set(rowId, false);
      }
    });
  }

  isExecutionRowLoading(rowId: string): boolean {
    return this.executionRowLoadingStates.get(rowId) || false;
  }

  async handleViewTestCase(testCaseId: string): Promise<void> {
    // Find test case and load full details with steps
    const testCase = this.jiraTestCases.find(tc => tc.id === testCaseId || tc.jiraID === testCaseId);
    if (testCase) {
      // Load full test case details including steps
      const fullTestCase = await this.loadFullTestCaseDetails(testCaseId);
      this.openViewTestCaseModal(fullTestCase || testCase);
    }
  }

  async handleEditTestCase(testCaseId: string): Promise<void> {
    // Find test case and load full details with steps
    const testCase = this.jiraTestCases.find(tc => tc.id === testCaseId || tc.jiraID === testCaseId);
    if (testCase) {
      // Load full test case details including steps
      const fullTestCase = await this.loadFullTestCaseDetails(testCaseId);
      this.openEditTestCaseModal(fullTestCase || testCase);
    }
  }

  async handleDeleteTestCase(testCaseId: string): Promise<void> {
    if (confirm(`Are you sure you want to delete test case ${testCaseId}?`)) {
      try {
        const response = await fetch(`${this.apiConfig.apiUrl}/test-cases/${testCaseId}`, {
          method: 'DELETE'
        });
        
        if (response.ok) {
          this.notificationService.showSuccess('Test case deleted successfully');
          this.loadJiraTestCases(); // Refresh the list
        } else {
          this.notificationService.showError('Failed to delete test case');
        }
      } catch (error) {
        console.error('Error deleting test case:', error);
        this.notificationService.showError('Failed to delete test case');
      }
    }
  }

  // Test Cases Pagination Methods
  get testCasesPaginationInfo(): any {
    const current = this.testCasesCurrentPage;
    const size = this.testCasesPageSize;
    const total = this.testCasesTotalResults;
    const knownTotal = typeof total === 'number' && total > 0;

    const totalPages = knownTotal ? Math.ceil(total / size) : (this.testCasesIsLastPage ? current + 1 : current + 2);
    const start = current * size + 1;
    const end = knownTotal
      ? Math.min((current + 1) * size, total)
      : (current + 1) * size;

    return {
      start,
      end,
      total: knownTotal ? total : 0,
      totalPages,
      currentPage: current + 1,
    };
  }

  get testCasesPageNumbers(): Array<number | 'ellipsis'> {
    const current = this.testCasesCurrentPage;
    const totalPages = this.testCasesPaginationInfo.totalPages;
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
  }

  testCasesGoToPage(pageIndex: number): void {
    const tokens = this.testCasesPageTokens;
    if (pageIndex < 0 || pageIndex >= tokens.length) return;
    this.testCasesCurrentPage = pageIndex;
    this.loadJiraTestCases();
  }

  testCasesNextPage(): void {
    if (this.testCasesIsLastPage) return;
    const nextTokenKnown = this.testCasesPageTokens[this.testCasesCurrentPage + 1];
    if (nextTokenKnown === undefined) return;
    this.testCasesCurrentPage++;
    this.loadJiraTestCases();
  }

  testCasesPreviousPage(): void {
    if (this.testCasesCurrentPage === 0) return;
    this.testCasesCurrentPage--;
    this.loadJiraTestCases();
  }

  private resetTestCasesPaging(): void {
    this.testCasesCurrentPage = 0;
    this.testCasesPageTokens = [null];
    this.testCasesIsLastPage = false;
    this.testCasesTotalResults = 0;
  }

  // Feedback System Methods
  openFeedbackModal(type: FeedbackType): void {
    this.currentFeedbackType = type;
    this.showFeedbackModal = true;
  }

  closeFeedbackModal(): void {
    this.showFeedbackModal = false;
  }

  async handleFeedbackSubmit(feedback: { type: FeedbackType; message: string; name?: string }): Promise<void> {
    const success = await this.feedbackService.submitFeedback(feedback);
    
    if (success) {
      this.notificationService.showSuccess('Thank you for your feedback!');
      this.closeFeedbackModal();
    } else {
      this.notificationService.showError('Failed to submit feedback. Please try again.');
    }
  }
}
