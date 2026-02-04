from fastapi import APIRouter, HTTPException, Path, Query, Depends
from typing import Dict, List, Optional, Any
from app.models.jira import JiraSprint, JiraProject, JiraBoard, JiraIssue, SprintResponse, ProjectResponse, UpdateTestCaseRequest, TestCaseFilterParams, UserSearchParams, VersionListParams, IssueFieldParams
from app.models.test_case import CreateTestCaseBody
from app.services.jira_service import jira_service
from app.utils.jira_helpers import parse_csv, build_test_case_jql_filter
from app.core.config import settings
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/jira", tags=["jira"])
@router.get(
    "/projects", 
    response_model=ProjectResponse,
    summary="Get all accessible projects",
    description="Retrieve a list of all Jira projects accessible to the current user"
)
async def list_projects():
    """
    Get all accessible Jira projects.
    
    Returns:
        ProjectResponse: List of projects with basic information including ID, key, and name
        
    Raises:
        HTTPException: If Jira API is unavailable or authentication fails
    """
    try:
        return await jira_service.get_projects()
    except Exception as e:
        logger.error(f"Failed to fetch projects: {e}")
        raise HTTPException(status_code=502, detail=f"Failed to fetch projects: {e}")


@router.get(
    "/boards", 
    response_model=List[JiraBoard],
    summary="Get Jira boards",
    description="Retrieve Jira boards, optionally filtered by project key"
)
async def list_boards(
    project_key: Optional[str] = Query(None, description="Filter boards by specific project key (e.g., 'SE2')")
):
    """
    Get Jira boards, optionally filtered by project.
    
    Args:
        project_key: Optional project key to filter boards
        
    Returns:
        List[JiraBoard]: List of boards with ID, name, type, and project information
        
    Raises:
        HTTPException: If Jira API is unavailable or authentication fails
    """
    try:
        return await jira_service.get_boards(project_key=project_key)
    except Exception as e:
        logger.error(f"Failed to fetch boards: {e}")
        raise HTTPException(status_code=502, detail=f"Failed to fetch boards: {e}")


@router.get(
    "/sprints/ordered", 
    response_model=SprintResponse,
    summary="Get ordered sprints",
    description="Retrieve sprints ordered with active sprints first, optionally filtered by board"
)
async def list_sprints_ordered(
    board_id: Optional[int] = Query(None, description="Board ID to filter sprints (if not provided, gets from all boards)")
):
    """
    Get sprints ordered with active sprints first.
    
    Args:
        board_id: Optional board ID to filter sprints
        
    Returns:
        SprintResponse: Ordered list of sprints with active ones first
        
    Raises:
        HTTPException: If Jira API is unavailable or authentication fails
    """
    try:
        if board_id:
            sprints = await jira_service.get_sprints_ordered(board_id)
        else:
            logger.info("Fetching all ordered sprints")
            sprints = await jira_service.get_all_sprints_ordered()
        
        return SprintResponse(sprints=sprints, total=len(sprints))
    except Exception as e:
        logger.error(f"Error in get_sprints_ordered endpoint: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch ordered sprints")

@router.get("/components", response_model=List[dict])
async def get_components(project_key: Optional[str] = Query(None, description="Filter by project key")):
    """Get components from a specific project or all projects"""
    try:
        if project_key:
            components = await jira_service.get_components(project_key)
        else:
            components = await jira_service.get_all_components()
        
        return components
    except Exception as e:
        logger.error(f"Error in get_components endpoint: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch components")

@router.get("/versions", response_model=List[dict])
async def list_versions(params: VersionListParams = Depends()):
    """List project versions with optional filtering."""
    if params.all:
        return await jira_service.get_project_versions_all(
            project_id_or_key=settings.jira_project_id,
            max_per_page=params.max_per_page,
            query=params.query,
            status=params.status,
            order_by=params.order_by,
        )
    else:
        return await jira_service.get_project_versions_limit(
            project_id_or_key=settings.jira_project_id,
            max_per_page=10,
            query=params.query,
            status=params.status,
            order_by=params.order_by,
        )

@router.get(
    "/users/picker",
    summary="Search users",
    description="Search for Jira users by name or email with configurable options"
)
async def search_users(params: UserSearchParams = Depends()):
    """
    Search for Jira users by name or email.
    All search parameters are grouped in UserSearchParams model.
    """
    try:
        users = await jira_service.search_users(
            query=params.query,
            max_results=params.max_results,
            show_avatar=params.show_avatar,
            avatar_size=params.avatar_size,
            exclude_account_ids=params.exclude_account_ids,
            exclude=params.exclude,
            exclude_connect_users=params.exclude_connect_users
        )
        return users
    except Exception as e:
        logger.error(f"Failed to search users: {e}")
        raise HTTPException(status_code=502, detail=f"Failed to search users: {e}")


@router.get(
    "/issues/{issue_id_or_key}",
    summary="Get issue details",
    description="Retrieve detailed information about a specific Jira issue by ID or key"
)
async def get_issue(
    issue_id_or_key: str = Path(..., description="Jira issue ID (e.g., '123456') or key (e.g., 'SE2-123')"),
    params: IssueFieldParams = Depends()
):
    """Get detailed information about a specific Jira issue."""
    try:
        issue = await jira_service.get_issue(
            issue_id_or_key,
            fields=parse_csv(params.fields) if params.fields else None,
            expand=parse_csv(params.expand) if params.expand else None,
            properties=parse_csv(params.properties) if params.properties else None,
        )
        return issue
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get issue {issue_id_or_key}: {e}")
        raise HTTPException(status_code=502, detail=f"Failed to fetch issue: {e}")


@router.get(
    "/test-cases/paginated",
    summary="Get paginated test cases",
    description="Retrieve test cases with pagination and filtering options"
)
async def list_test_cases_paginated(
    filters: TestCaseFilterParams = Depends()
):
    """
    Get Test type issues with pagination and JQL filtering.
    
    All filter parameters are grouped in TestCaseFilterParams model for better maintainability.
    Supports both snake_case and camelCase parameter names.
    """
    try:
        # Use configured project key if not provided
        proj_key = filters.project_key or settings.jira_project_key
        
        # Build JQL filter using utility function
        combined_filter = build_test_case_jql_filter(
            project_key=proj_key,
            search=filters.search,
            component=filters.component,
            sprint=filters.sprint,
            status=filters.status,
            issue_type=filters.issue_type,
            assignee=filters.assignee,
            assignee_current_user=filters.assignee_current_user,
            reporter=filters.reporter,
            reporter_current_user=filters.reporter_current_user,
            issue_links=filters.issue_link,
            additional_jql=filters.jql_filter,
        )
        
        logger.info(f"Combined JQL filter: {combined_filter or '<none>'}")
        logger.info(f"Additional JQL filter: {filters.jql_filter or '<none>'}")

        result = await jira_service.get_test_issues_paginated(
            project_key=proj_key,
            jql_filter=combined_filter,
            start_at=filters.start_at,
            max_results=filters.max_results,
            next_page_token=filters.next_page_token
        )
        return result

    except Exception:
        logger.exception("Error in get_test_cases_paginated endpoint")
        raise HTTPException(status_code=500, detail="Failed to fetch paginated test cases")


@router.post("/test-cases", response_model=dict)
async def create_test_case(body: CreateTestCaseBody):
    """Create a new Test type issue in Jira"""
    try:
        new_issue = await jira_service.create_test_issue(
            project_key=body.project_key or settings.jira_project_id,
            summary=body.summary,
            description=body.description,
            components=body.components,
            related_issues=body.related_issues or None,
            custom_fields={settings.jira_sprint_field: body.sprint_id} if body.sprint_id else None
        )
        logger.info(f"Created new Jira Test issue: {new_issue}")
        return new_issue
    except Exception as e:
        logger.error(f"Error in create_test_case endpoint: {e}")
        raise HTTPException(status_code=500, detail="Failed to create test case")

@router.get("/health", response_model=dict)
async def jira_health_check():
    """FastAPI route to check if Jira API is accessible"""
    try:
        result = await jira_service.jira_health_check()
        return {"status": "ok", "data": result}
    except Exception as e:
        logger.error("Jira health check API failed: %s", e)
        return {"status": "error", "message": str(e)}


@router.put("/test-cases/{issue_id_or_key}", response_model=dict)
async def update_test_case(
    issue_id_or_key: str = Path(..., description="Jira issue ID or key"),
    payload: UpdateTestCaseRequest = ...,
):
    """Update Jira fields of a test case"""
    try:
        data = payload.model_dump(by_alias=False, exclude_none=True)
        logger.info("Update payload for %s: %s", issue_id_or_key, data)

        # Map request fields to Jira API format using service method
        update_fields = jira_service.map_update_fields_to_jira_format(data)
        
        # Handle status separately (it's already handled in update_issue)
        if "status" in data:
            update_fields["status"] = {"name": data["status"]}

        if not update_fields:
            return {"success": True, "message": "No fields to update"}

        # Call Jira service to update
        await jira_service.update_issue(issue_id_or_key, update_fields)

        return {
            "success": True,
            "message": "Test case updated successfully",
            "updated_fields": list(update_fields.keys()),
        }

    except Exception as e:
        logger.error("Error updating test case %s: %s", issue_id_or_key, e)
        raise HTTPException(status_code=500, detail=f"Failed to update test case: {e}")

@router.get("/test-cases/{issue_id_or_key}/listTransitions", response_model=List[dict])
async def transition_test_case(
    issue_id_or_key: str = Path(..., description="Jira issue ID or key")
):
    """List available transitions for a test case."""
    try:
        transitions = await jira_service.list_transitions(issue_id_or_key)  # returns a list
        # return a compact, UI-friendly shape
        
        simplified = [
            {
                "name": t.get("to").get("name"),
                "id": t.get("id")
            }
            for t in transitions
        ]
        logger.debug(f"Transitions for {issue_id_or_key}: {simplified}")
        return simplified
    except Exception as e:
        logger.exception("Error listing transitions for test case %s", issue_id_or_key)
        raise HTTPException(status_code=500, detail=f"Failed to list transitions: {e}")

@router.get(
    "/stories/{story_key}/subtasks",
    response_model=dict,
    summary="Get subtasks of a story",
    description="Retrieve all subtasks for a given story/parent issue by its key"
)
async def get_story_subtasks(
    story_key: str = Path(..., description="Jira story key (e.g., 'SE2-123')")
):
    """
    Get all subtasks for a specific story.
    
    Args:
        story_key: The Jira issue key of the parent story
        
    Returns:
        List of subtasks with their details including summary, status, assignee, etc.
        
    Raises:
        HTTPException: If story not found, access denied, or API error
    """
    try:
        subtasks = await jira_service.get_subtasks(story_key)
        return {
            "story_key": story_key,
            "subtasks": subtasks,
            "total": len(subtasks)
        }
    except Exception as e:
        logger.error(f"Failed to get subtasks for story {story_key}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch subtasks: {e}")

