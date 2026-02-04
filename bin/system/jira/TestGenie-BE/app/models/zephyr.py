"""Zephyr Squad models for test cases, steps, cycles, and executions."""
from pydantic import BaseModel, Field, model_validator
from typing import Optional, List, Dict, Any, Union
from datetime import datetime
from enum import Enum


class CycleListParams(BaseModel):
    """Query parameters for listing test cycles."""
    version_id: int = Field(-1, description="Jira version ID (-1 for Unscheduled)")
    offset: int = Field(0, ge=0, description="Pagination offset")
    limit: int = Field(50, ge=1, le=500, description="Results per page")
    query: Optional[str] = Field(None, description="Filter by name")


class ZephyrTestCaseStatus(str, Enum):
    """Zephyr test case status values."""
    DRAFT = "Draft"
    APPROVED = "Approved"
    DEPRECATED = "Deprecated"

class ZephyrTestStep(BaseModel):
    """Zephyr test step with action, data, and expected result."""
    step: str = Field(..., min_length=1, description="Test step description")
    data: Optional[str] = Field(None, description="Test data")
    result: Optional[str] = Field(None, description="Expected result")

class ZephyrTestCaseCreate(BaseModel):
    """Request to create a new Zephyr test case."""
    name: str = Field(..., min_length=1, max_length=255, description="Test case name")
    objective: Optional[str] = Field(None, description="Test case objective")
    precondition: Optional[str] = Field(None, description="Test preconditions")
    estimatedTime: Optional[int] = Field(None, ge=0, description="Estimated time in seconds")
    labels: Optional[List[str]] = Field(default_factory=list, description="Test case labels")
    component: Optional[str] = Field(None, description="Component name")
    priority: Optional[str] = Field("Medium", description="Test case priority")
    status: Optional[ZephyrTestCaseStatus] = Field(ZephyrTestCaseStatus.DRAFT, description="Test case status")
    folder: Optional[str] = Field(None, description="Folder path")
    issueLinks: Optional[List[str]] = Field(default_factory=list, description="Linked Jira issues")

class ZephyrTestCaseUpdate(BaseModel):
    """Request to update an existing Zephyr test case."""
    name: Optional[str] = Field(None, min_length=1, max_length=255, description="Updated test case name")
    objective: Optional[str] = Field(None, description="Updated objective")
    precondition: Optional[str] = Field(None, description="Updated preconditions")
    estimatedTime: Optional[int] = Field(None, ge=0, description="Updated estimated time")
    labels: Optional[List[str]] = Field(None, description="Updated labels")
    component: Optional[str] = Field(None, description="Updated component")
    priority: Optional[str] = Field(None, description="Updated priority")
    status: Optional[ZephyrTestCaseStatus] = Field(None, description="Updated status")
    folder: Optional[str] = Field(None, description="Updated folder")
    issueLinks: Optional[List[str]] = Field(None, description="Updated issue links")

class ZephyrTestCase(BaseModel):
    """Zephyr test case with full details."""
    id: str = Field(..., description="Test case ID")
    key: str = Field(..., description="Test case key")
    name: str = Field(..., description="Test case name")
    objective: Optional[str] = Field(None, description="Test objective")
    precondition: Optional[str] = Field(None, description="Test preconditions")
    estimatedTime: Optional[int] = Field(None, description="Estimated time in seconds")
    labels: List[str] = Field(default_factory=list, description="Test labels")
    component: Optional[str] = Field(None, description="Component name")
    priority: str = Field("Medium", description="Priority level")
    status: ZephyrTestCaseStatus = Field(ZephyrTestCaseStatus.DRAFT, description="Test status")
    folder: Optional[str] = Field(None, description="Folder path")
    issueLinks: List[str] = Field(default_factory=list, description="Linked issues")
    createdOn: Optional[datetime] = Field(None, description="Creation timestamp")
    modifiedOn: Optional[datetime] = Field(None, description="Last modification timestamp")
    createdBy: Optional[str] = Field(None, description="Creator username")
    modifiedBy: Optional[str] = Field(None, description="Last modifier username")
    projectId: Optional[str] = Field(None, description="Project ID")

class ZephyrTestStepCreate(BaseModel):
    """Request to create a test step."""
    step: str = Field(..., min_length=1, description="Test step description")
    data: Optional[str] = Field(None, description="Test data")
    result: Optional[str] = Field(None, description="Expected result")

class ZephyrTestStepResponse(BaseModel):
    """Test step response with ID and order."""
    id: str = Field(..., description="Step ID")
    step: str = Field(..., description="Step description")
    data: Optional[str] = Field(None, description="Test data")
    result: Optional[str] = Field(None, description="Expected result")
    orderId: int = Field(..., description="Step order/position")

class ZephyrTestCaseWithSteps(ZephyrTestCase):
    """Test case with its associated test steps."""
    testSteps: List[ZephyrTestStepResponse] = Field(default_factory=list, description="List of test steps")

class ZephyrTestCaseCreateRequest(BaseModel):
    """Complete request to create test case with steps."""
    testCase: ZephyrTestCaseCreate = Field(..., description="Test case details")
    testSteps: Optional[List[ZephyrTestStepCreate]] = Field(default_factory=list, description="Test steps")

class ZephyrTestCaseResponse(BaseModel):
    """Paginated response containing test cases."""
    testCases: List[ZephyrTestCase] = Field(..., description="List of test cases")
    total: int = Field(..., ge=0, description="Total number of test cases")
    startAt: int = Field(..., ge=0, description="Starting index")
    maxResults: int = Field(..., ge=1, description="Maximum results per page")

class ZephyrBulkOperationResponse(BaseModel):
    """Response for bulk operations on test cases."""
    success: bool = Field(..., description="Whether operation succeeded")
    message: str = Field(..., description="Operation result message")
    affectedIds: List[str] = Field(..., description="IDs of affected test cases")
    errors: Optional[List[str]] = Field(None, description="List of errors if any")
    
class AddTestStepsResponse(BaseModel):
    """Response after adding test steps to a test case."""
    issue_id: str = Field(..., description="Jira issue ID")
    project_id: int = Field(..., description="Project ID")
    steps_created: int = Field(..., ge=0, description="Number of steps created")
    created_ids: List[str] = Field(..., description="IDs of created steps")
    errors: List[str] = Field(default_factory=list, description="List of errors")

class StepIn(BaseModel):
    """Input model for a test step."""
    step: str = Field(..., min_length=1, description="Step text")
    data: Optional[str] = Field(None, description="Test data")
    result: Optional[str] = Field(None, description="Expected result")

class AddTestStepsBody(BaseModel):
    """Request body to add multiple test steps."""
    steps: List[StepIn] = Field(..., min_length=1, description="Ordered list of steps")
    
class AddToCycleBody(BaseModel):
    """Request to add a test to a cycle."""
    cycle_id: int = Field(..., description="Zephyr cycle ID")
    version_id: int = Field(..., description="Jira version ID (-1 for Unscheduled)")
    folder_id: Optional[int] = Field(None, description="Optional folder ID inside the cycle")

class AddToCycleResponse(BaseModel):
    """Response after adding test to cycle."""
    issue_id: str = Field(..., description="Jira issue ID")
    project_id: int = Field(..., description="Project ID")
    cycle_id: int = Field(..., description="Cycle ID")
    version_id: int = Field(..., description="Version ID")
    execution_id: Optional[str] = Field(None, description="Created execution ID")
    created: bool = Field(False, description="Whether new execution was created")
    error: Optional[str] = Field(None, description="Error message if failed")


class CreateCycleBody(BaseModel):
    """Request to create a new test cycle."""
    version_id: int = Field(..., description="Jira version ID (-1 for Unscheduled)")
    name: str = Field(..., min_length=1, max_length=255, description="Cycle name")
    description: Optional[str] = Field(None, description="Cycle description")
    build: Optional[str] = Field(None, description="Build version")
    environment: Optional[str] = Field(None, description="Test environment")
    start_date: Optional[str] = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$", description="Start date (YYYY-MM-DD)")
    end_date: Optional[str] = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$", description="End date (YYYY-MM-DD)")

class ExecuteBody(BaseModel):
    """Request to execute a test and set its status."""
    status: Optional[str] = Field(None, description="Status name (PASS/FAIL/WIP/BLOCKED/UNEXECUTED)")
    status_id: Optional[int] = Field(None, description="Zephyr execution status numeric ID")
    cycle_id: Optional[int] = Field(None, description="Cycle ID (use -1 for Ad hoc)")
    version_id: Optional[int] = Field(None, description="Version ID (required when cycle_id = -1)")
    
    @model_validator(mode="after")
    def need_status(self):
        """Ensure either status or status_id is provided."""
        if self.status is None and self.status_id is None:
            raise ValueError("Provide either 'status' or 'status_id'.")
        return self

class UpdateZephyrTestCaseRequest(BaseModel):
    """Request to update Zephyr test case steps and results."""
    steps: Optional[List[StepIn]] = Field(None, description="Updated test steps")
    expected_result: Optional[str] = Field(None, alias="expectedResult", description="Expected result")
    
    class Config:
        populate_by_name = True  # Allow both snake_case and camelCase