export interface TestCase {
  id: string;
  title: string;
  steps: string;
  expectedResult: string;
  priority: 'high' | 'medium' | 'low' | string;
  executionStatus?: 'not-executed' | 'passed' | 'failed' | 'blocked' | string;
  
  // Additional properties for Jira test cases (manual creation)
  jiraID?: string;
  summary?: string;
  description?: string;
  component?: string;
  sprint?: string;
  status?: string;
  relatedTask?: string;
  created?: string;
  createdBy?: string;
  executionId?: string;
  hasExecution?: boolean;
}

export interface GenerateTestCaseRequest {
  prompt: string;
  issue_key?: string;
  summary?: string;
  issue_type?: string;
  status?: string;
  existing_test_cases?: TestCase[];
  conversation_history?: ConversationMessage[];
  is_additional_generation?: boolean;
  special_comments?: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface GenerateTestCaseResponse {
  testCases?: TestCase[];
  data?: TestCase[];
  conversation_history?: ConversationMessage[];
}
