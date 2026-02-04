"""Jira-related models for projects, boards, sprints, and issues."""
from pydantic import BaseModel, Field, field_validator
from typing import Optional, List
from datetime import datetime
from enum import Enum


class SprintState(str, Enum):
    """Jira sprint states."""
    ACTIVE = "active"
    FUTURE = "future"
    CLOSED = "closed"


class JiraProject(BaseModel):
    """Jira project information."""
    id: str = Field(..., description="Project ID")
    key: str = Field(..., min_length=1, max_length=10, description="Project key (e.g., 'SE2')")
    name: str = Field(..., min_length=1, description="Project name")
    description: Optional[str] = Field(None, description="Project description")

    class Config:
        json_schema_extra = {
            "example": {
                "id": "24300",
                "key": "SE2",
                "name": "SE 2.0",
                "description": "Software Engineering 2.0 Project"
            }
        }


class JiraSprint(BaseModel):
    """Jira sprint information."""
    id: int = Field(..., description="Sprint ID")
    name: str = Field(..., min_length=1, description="Sprint name")
    state: SprintState = Field(..., description="Sprint state (active, future, closed)")
    start_date: Optional[datetime] = Field(None, description="Sprint start date")
    end_date: Optional[datetime] = Field(None, description="Sprint end date")
    complete_date: Optional[datetime] = Field(None, description="Sprint completion date")
    board_id: int = Field(..., description="Board ID this sprint belongs to")

    class Config:
        json_schema_extra = {
            "example": {
                "id": 1234,
                "name": "Sprint 1",
                "state": "active",
                "start_date": "2024-01-01T00:00:00Z",
                "end_date": "2024-01-14T23:59:59Z",
                "board_id": 1098
            }
        }


class JiraBoard(BaseModel):
    """Jira board information."""
    id: int = Field(..., description="Board ID")
    name: str = Field(..., min_length=1, description="Board name")
    type: str = Field(..., description="Board type (e.g., 'scrum', 'kanban')")
    project_key: str = Field(..., description="Project key this board belongs to")

    class Config:
        json_schema_extra = {
            "example": {
                "id": 1098,
                "name": "SE 2.0 Board",
                "type": "scrum",
                "project_key": "SE2"
            }
        }


class JiraIssue(BaseModel):
    """Jira issue with key fields."""
    id: str = Field(..., description="Issue ID")
    key: str = Field(..., pattern=r"^[A-Z0-9]+-\d+$", description="Issue key (e.g., 'SE2-123')")
    summary: str = Field(..., min_length=1, max_length=255, description="Issue summary")
    description: Optional[str] = Field(None, description="Issue description")
    issue_type: str = Field(..., description="Issue type (e.g., 'Test', 'Story', 'Bug')")
    status: str = Field(..., description="Current status")
    priority: str = Field(..., description="Priority level")
    assignee: Optional[str] = Field(None, description="Assignee display name")
    reporter: str = Field(..., description="Reporter display name")
    created: datetime = Field(..., description="Creation timestamp")
    updated: datetime = Field(..., description="Last update timestamp")
    components: List[str] = Field(default_factory=list, description="Component names")
    sprint: Optional[str] = Field(None, description="Sprint name if assigned")
    first_linked_issue: Optional[str] = Field(None, description="First linked issue key")

    @field_validator('key')
    @classmethod
    def validate_key_format(cls, v: str) -> str:
        """Ensure issue key follows Jira format (PROJECT-NUMBER)."""
        if not v or '-' not in v:
            raise ValueError('Issue key must be in format PROJECT-NUMBER')
        # Don't uppercase - preserve original case
        return v

    class Config:
        json_schema_extra = {
            "example": {
                "id": "12345",
                "key": "SE2-123",
                "summary": "Test login functionality",
                "description": "Verify user can log in successfully",
                "issue_type": "Test",
                "status": "To Do",
                "priority": "High",
                "assignee": "John Doe",
                "reporter": "Jane Smith",
                "created": "2024-01-01T00:00:00Z",
                "updated": "2024-01-02T00:00:00Z",
                "components": ["Login", "Authentication"],
                "sprint": "Sprint 1"
            }
        }


class SprintResponse(BaseModel):
    """Response containing list of sprints."""
    sprints: List[JiraSprint] = Field(..., description="List of sprints")
    total: int = Field(..., ge=0, description="Total number of sprints")


class ProjectResponse(BaseModel):
    """Response containing list of projects."""
    projects: List[JiraProject] = Field(..., description="List of projects")
    total: int = Field(..., ge=0, description="Total number of projects")


class UserSearchParams(BaseModel):
    """Query parameters for searching Jira users."""
    query: str = Field(..., description="Search string to find users by name or email")
    max_results: int = Field(20, ge=1, le=100, description="Maximum number of users to return")
    show_avatar: bool = Field(True, description="Include avatar URLs in response")
    avatar_size: str = Field("24x24", description="Avatar size (e.g., '24x24', '48x48')")
    exclude_account_ids: Optional[List[str]] = Field(None, description="Account IDs to exclude")
    exclude: Optional[List[str]] = Field(None, description="Usernames to exclude")
    exclude_connect_users: bool = Field(True, description="Exclude Atlassian Connect users")


class VersionListParams(BaseModel):
    """Query parameters for listing project versions."""
    all: bool = Field(True, description="Fetch all pages")
    max_per_page: int = Field(50, ge=1, le=100, description="Results per page")
    query: Optional[str] = Field(None, description="Filter by version name")
    status: Optional[str] = Field(None, description="Filter by status (released, unreleased, archived)")
    order_by: Optional[str] = Field(None, description="Sort order")


class TestCaseFilterParams(BaseModel):
    """
    Query parameters for filtering test cases.
    Used with FastAPI Depends() to group related query parameters.
    """
    project_key: Optional[str] = Field(None, description="Project key (defaults to configured project)")
    jql_filter: Optional[str] = Field(None, description="Additional JQL filter")
    start_at: int = Field(0, ge=0, description="Start index for pagination")
    max_results: int = Field(50, ge=1, le=100, description="Maximum results per page")
    search: Optional[str] = Field(None, description="Search term for summary/description")
    component: Optional[str] = Field(None, description="Filter by component")
    sprint: Optional[str] = Field(None, description="Filter by sprint (id or name)")
    status: Optional[str] = Field(None, description="Filter by status")
    assignee: Optional[str] = Field(None, description="Filter by assignee (comma-separated, supports 'Unassigned')")
    assignee_current_user: Optional[bool] = Field(None, alias="assigneeCurrentUser", description="Filter by current user as assignee")
    reporter: Optional[str] = Field(None, description="Filter by reporter (comma-separated, supports 'Unassigned')")
    reporter_current_user: Optional[bool] = Field(None, alias="reporterCurrentUser", description="Filter by current user as reporter")
    issue_link: Optional[List[str]] = Field(None, alias="issueLink", description="Filter by linked issues (keys)")
    issue_type: Optional[str] = Field(None, alias="issueType", description="Issue type to filter")
    next_page_token: Optional[str] = Field(None, description="Next page token for pagination")

    class Config:
        populate_by_name = True  # Allow both snake_case and camelCase


class IssueFieldParams(BaseModel):
    """Query parameters for customizing issue field retrieval."""
    fields: Optional[str] = Field(None, description="Comma-separated list of fields")
    expand: Optional[str] = Field(None, description="Comma-separated list of expansions")
    properties: Optional[str] = Field(None, description="Comma-separated list of properties")


class UpdateTestCaseRequest(BaseModel):
    """Request to update a test case issue in Jira."""
    summary: Optional[str] = Field(None, min_length=1, max_length=255, description="Updated summary")
    description: Optional[str] = Field(None, description="Updated description")
    component: Optional[str] = Field(None, description="Component name")
    sprint: Optional[str] = Field(None, description="Sprint ID or name")
    status: Optional[str] = Field(None, description="Status name")
    priority: Optional[str] = Field(None, description="Priority level")
    related_task: Optional[str] = Field(default=None, alias="relatedTask", description="Related task key")

    class Config:
        populate_by_name = True  # Allow both snake_case and camelCase
        json_schema_extra = {
            "example": {
                "summary": "Updated test case summary",
                "description": "Updated description",
                "component": "Login",
                "status": "In Progress",
                "priority": "High"
            }
        }