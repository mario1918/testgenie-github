export interface CreateTestCaseForm {
  summary: string;
  description: string;
  steps: string;
  expectedResult: string;
  component: string;
  addCurrentSprint: boolean;
  version?: number | null;
  testCycle?: number | null;
  relatedTask: string;
  executionStatus: string;
}

export interface EditTestCaseForm {
  key: string;
  jiraID: string;
  summary: string;
  description: string;
  component: string;
  sprint: string;
  status: string;
  priority: string;
  relatedTask: string;
  steps: string;
  expectedResult: string;
  transition: string;
}

export interface FilterState {
  component: string;
  sprint: string;
  search: string;
  jql: string;
  status: string;
  assignee: string;
  assigneeCurrentUser: boolean;
  reporter: string;
  reporterCurrentUser: boolean;
}

export interface PaginationInfo {
  start: number;
  end: number;
  total: number;
  totalPages: number;
  currentPage: number;
}
