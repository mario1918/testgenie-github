"""Test case models for creating and managing test cases."""
from pydantic import BaseModel, Field
from typing import Any, Dict, Optional, List, Union


class CreateTestCaseBody(BaseModel):
    """
    Request body for creating a simple test case in Jira.
    Used by the basic test case creation endpoint.
    """
    project_key: Optional[str] = Field(
        None,
        description="Project key (defaults to configured project)"
    )
    summary: str = Field(
        ...,
        min_length=1,
        max_length=255,
        description="Summary of the test case"
    )
    description: Optional[str] = Field(
        None,
        description="Description of the test case"
    )
    components: List[str] = Field(
        default_factory=list,
        description="List of component names"
    )
    related_issues: List[str] = Field(
        default_factory=list,
        description="List of related issue keys"
    )
    sprint_id: Optional[int] = Field(
        None,
        description="Sprint ID to assign the test case to"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "summary": "Test user login functionality",
                "description": "Verify that users can successfully log in",
                "components": ["Authentication", "Login"],
                "related_issues": ["SE2-100"],
                "sprint_id": 1234
            }
        }

class ExecutionStatusIn(BaseModel):
    """
    Execution status for Zephyr test execution.
    Represents the result of running a test.
    """
    id: Optional[int] = Field(
        None,
        description="Zephyr execution status id (e.g., 1=PASS, 2=FAIL, -1=UNEXECUTED)"
    )

class CreateExecutionRequest(BaseModel):
    """
    Request to create a test execution in Zephyr.
    Links a test case to a specific cycle and optionally sets its status.
    """
    issue_id: str = Field(..., description="Jira issue ID (numeric) of the test")
    cycle_id: Optional[int] = Field(None, description="Zephyr cycle ID")
    version_id: Optional[int] = Field(None, description="Jira version ID")
    execution_status: Optional[ExecutionStatusIn] = Field(
        None,
        description="Optional initial execution status"
    )

class CreateExecutionResponse(BaseModel):
    """
    Response after creating a test execution.
    Contains details about the created execution.
    """
    issue_id: str = Field(..., description="Jira issue ID")
    project_id: int = Field(..., description="Project ID")
    cycle_id: Optional[int] = Field(None, description="Cycle ID")
    version_id: Optional[int] = Field(None, description="Version ID")
    execution_id: Optional[str] = Field(None, description="Created execution ID")
    created: bool = Field(False, description="Whether a new execution was created")
    status_updated: bool = Field(False, description="Whether status was updated")

class FullCreateBody(BaseModel):
    """
    Complete test case creation request.
    Creates a Jira issue, adds Zephyr steps, and creates an execution.
    """
    # Jira issue fields
    summary: str = Field(..., min_length=1, max_length=255, description="Test case summary")
    description: Optional[str] = Field(None, description="Test case description")
    components: Optional[List[str]] = Field(None, description="Component names")
    related_issues: Optional[List[str]] = Field(None, description="Related issue keys")
    sprint_id: Optional[int] = Field(None, description="Sprint ID")

    # Zephyr test steps
    steps: Optional[List[Dict[str, Optional[str]]]] = Field(
        None,
        description="Test steps [{step, data, result}]"
    )

    # Execution details
    version_id: Optional[int] = Field(None, description="Version ID for execution")
    cycle_id: Optional[int] = Field(None, description="Cycle ID for execution")
    execution_status: Optional[Dict[str, Any]] = Field(
        None,
        description="Execution status {id: 1} or {name: 'PASS'}"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "summary": "Test login with valid credentials",
                "description": "Verify successful login",
                "components": ["Authentication"],
                "related_issues": ["SE2-100"],
                "sprint_id": 1234,
                "steps": [
                    {"step": "Navigate to login page", "data": "", "result": "Login page displayed"},
                    {"step": "Enter credentials", "data": "user@test.com", "result": "Credentials accepted"},
                    {"step": "Click login", "data": "", "result": "User logged in successfully"}
                ],
                "version_id": 10000,
                "cycle_id": 5000,
                "execution_status": {"id": 1}
            }
        }


# Bulk operation models

class BulkFullCreateRequest(BaseModel):
    """
    Request for bulk test case creation.
    Creates multiple test cases with shared version/cycle settings.
    """
    TestCases: List[FullCreateBody] = Field(
        ...,
        min_length=1,
        description="List of test cases to create"
    )
    version_id: Optional[int] = Field(
        None,
        description="Version ID applied to all test cases"
    )
    cycle_id: Optional[int] = Field(
        None,
        description="Cycle ID applied to all test cases"
    )


class ItemSuccess(BaseModel):
    """Successful test case creation result."""
    jira: Dict[str, Any] = Field(..., description="Created Jira issue details")
    execution_id: Optional[Union[int, str]] = Field(
        None,
        description="Created execution ID if applicable"
    )


class ItemFailure(BaseModel):
    """Failed test case creation result."""
    error: str = Field(..., description="Error message")


class BulkItemResult(BaseModel):
    """Result for a single item in bulk operation."""
    index: int = Field(..., description="Index in the original request")
    input_summary: Optional[str] = Field(None, description="Summary from input")
    success: bool = Field(..., description="Whether operation succeeded")
    result: Optional[ItemSuccess] = Field(None, description="Success details")
    failure: Optional[ItemFailure] = Field(None, description="Failure details")


class BulkFullCreateResponse(BaseModel):
    """Response for bulk test case creation."""
    total: int = Field(..., ge=0, description="Total items processed")
    succeeded: int = Field(..., ge=0, description="Number of successful creations")
    failed: int = Field(..., ge=0, description="Number of failed creations")
    results: List[BulkItemResult] = Field(..., description="Detailed results for each item")