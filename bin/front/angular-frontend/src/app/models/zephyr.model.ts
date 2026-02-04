export interface ExecutionStatus {
  id: number;
  name: string;
}

export interface CycleVersion {
  id: number;
  name: string;
}

export interface CycleData {
  id: number;
  name: string;
  versionId?: number;
}

export interface CreateExecutionRequest {
  issue_id: string;
  cycle_id: number;
  version_id: number;
  execution_status?: {
    id: number;
  };
}

export interface ExecutionCreationModal {
  isVisible: boolean;
  testCaseId: string;
  cycles: CycleVersion[];
  versions: CycleVersion[];
}
