export interface JiraIssue {
  key: string;
  summary: string;
  description: string;
  issue_type: string;
  status: string;
  priority: string;
  assignee?: string;
  reporter?: string;
  sprint?: string;
  component?: string;
  components?: string[]; // Array of component names
  created?: string;
  updated?: string;
}

export interface JiraIssuesResponse {
  issues: JiraIssue[];
  total: number;
  startAt?: number;
  maxResults?: number;
  nextPageToken?: string | null;
  isLast?: boolean;
}

export interface JiraComponent {
  id: string;
  name: string;
}

export interface JiraSprint {
  id: number;
  name: string;
  state: string;
  isActive?: boolean;
}
