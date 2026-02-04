from fastapi import APIRouter, HTTPException, Query, Path, Depends
from typing import List, Optional
from app.models.zephyr import (
    ExecuteBody, ZephyrTestCase, ZephyrTestCaseCreate, ZephyrTestCaseUpdate,
    ZephyrTestCaseWithSteps, ZephyrTestCaseCreateRequest,
    ZephyrTestCaseResponse, ZephyrBulkOperationResponse, AddTestStepsResponse, AddTestStepsBody, StepIn, AddToCycleResponse, AddToCycleBody, CreateCycleBody, UpdateZephyrTestCaseRequest, CycleListParams
)
from app.services.zephyr_service import zephyr_service, PROJECT_ID
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/zephyr", tags=["zephyr"])

@router.get("/test-cases/{test_case_id}", response_model=ZephyrTestCaseWithSteps)
async def get_test_case(test_case_id: str):
    """Get a test case with its steps"""
    try:
        test_case = await zephyr_service.get_test_case(test_case_id)
        if not test_case:
            raise HTTPException(status_code=404, detail="Test case not found")
        return test_case
    except Exception as e:
        logger.error(f"Error in get_test_case endpoint: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch test case")

@router.post("/test-cases/{issue_id}/steps", response_model=AddTestStepsResponse)
async def add_zephyr_test_steps(
    issue_id: str = Path(..., description="Jira issueId of the Test (numeric id)"),
    body: AddTestStepsBody = ...,
    ):
    """
    Add Zephyr Squad steps (and expected results) to a Test.
    - POST /public/rest/api/{api_version}/teststep/{issueId}?projectId=...
    """
    if not body.steps:
        raise HTTPException(status_code=400, detail="Steps list cannot be empty.")

    # Convert Pydantic models to the dict shape expected by the service
    steps_payload = [s.model_dump() for s in body.steps]

    try:
        res = await zephyr_service.add_test_steps(
            issue_id=issue_id,
            project_id=PROJECT_ID,
            steps=steps_payload
        )
        return AddTestStepsResponse(
            issue_id=str(issue_id),
            project_id=PROJECT_ID,
            steps_created=res.get("steps_created", 0),
            created_ids=res.get("created_ids", []),
            errors=res.get("errors", []),
        )
    except Exception as e:
        # Log as needed; keep response concise
        raise HTTPException(status_code=502, detail=f"Failed to add steps: {e}")

@router.get("/cycles", response_model=dict)
async def list_cycles(params: CycleListParams = Depends()):
    """List test cycles with optional filtering."""
    try:
        return await zephyr_service.get_test_cycles(
            project_id=PROJECT_ID,
            version_id=params.version_id,
            offset=params.offset,
            limit=params.limit,
            query=params.query
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch cycles: {e}")
    
@router.post("/cycles", response_model=dict)
async def create_cycle(body: CreateCycleBody):
    """
    Create a Zephyr test cycle under the given version.
    Returns: {"id": <cycleId>, "raw": {...}}
    """
    try:
        return await zephyr_service.create_cycle(**body.model_dump())
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to create cycle: {e}")

@router.get("/execution-status", response_model=dict)
async def get_execution_status_id():
    """
    Get all available Zephyr execution statuses.
    Returns: List of status objects with name and id.
    """
    try:
        # Fetch all statuses
        data = await zephyr_service.get_execution_statuses()
        return data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to resolve status id: {e}")

@router.post("/test-cases/{issue_id}/cycle", response_model=AddToCycleResponse)
async def add_test_to_cycle(
    issue_id: str = Path(..., description="Jira issueId (numeric) of the Test"),
    body: AddToCycleBody = ...,
    ):
    """
    Create (or fetch existing) execution for the Test in the given Zephyr cycle.
    """
    try:
        res = await zephyr_service.add_test_to_cycle(
            issue_id=issue_id,
            project_id=PROJECT_ID,
            cycle_id=body.cycle_id,
            version_id=body.version_id,
            folder_id=body.folder_id,
        )
        return AddToCycleResponse(
            issue_id=str(issue_id),
            project_id=PROJECT_ID,
            cycle_id=body.cycle_id,
            version_id=body.version_id,
            execution_id=res.get("execution_id"),
            created=res.get("created", False),
            error=res.get("error"),
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to add test to cycle: {e}")

@router.put("/executions/{execution_id}", response_model=dict)
async def execute_test_route(
    execution_id: str = Path(..., description="Zephyr execution ID (UUID or string)"),
    issue_id: int = Query(..., description="Jira issue ID (numeric) of the Test"),
    body: ExecuteBody = ...,
):
    """
    Set execution status.
    Updates the status of a test execution in Zephyr.
    """
    try:
        # resolve status id
        if body.status_id is not None:
            status_id = body.status_id
            status_name = body.status or "<by-id>"
        else:
            raise HTTPException(status_code=400, detail="'status_id' must be provided.")

        await zephyr_service.execute_test(
            project_id=PROJECT_ID,
            issue_id=issue_id,
            execution_id=execution_id,
            status_id=status_id,
            cycle_id=body.cycle_id,
            version_id=body.version_id,
        )

        return {
            "ok": True,
            "execution_id": execution_id,
            "issue_id": issue_id,
            "status": status_name,
            "status_id": status_id,
            "cycle_id": body.cycle_id,
            "version_id": body.version_id,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to execute test: {e}")

@router.get("/executions", response_model=dict)
async def get_executions(
    issue_id: int = Query(..., description="Jira numeric issueId for the Test"),
    cycle_id: Optional[int] = Query(None, description="Optional cycle to filter (use -1 for Ad hoc)"),
):
    """
    Get all executions for a test case.
    Returns list of executions with their details.
    """
    try:
        items = await zephyr_service.list_executions(issue_id=issue_id, project_id=PROJECT_ID, cycle_id=cycle_id)
        return {"count": len(items), "items": items}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch executions: {e}")  
          
@router.get("/health", response_model=dict)
async def zephyr_health_check():
    """Check Zephyr API connectivity and accessibility."""
    try:
        res = await zephyr_service.get_test_cases(project_id=PROJECT_ID, max_results=1)
        return {
            "status": "healthy",
            "zephyr_accessible": True,
            "test_cases_accessible": True,
            "sample_count": res.get("total", 0)
        }
    except Exception as e:
        logger.error(f"Zephyr health check failed: {e}")
        return {"status": "unhealthy", "zephyr_accessible": False, "error": str(e)}


@router.put("/test-cases/{issue_id}", response_model=dict)
async def update_test_case(
    issue_id: str = Path(..., description="Jira issue ID"),
    payload: UpdateZephyrTestCaseRequest = ...,
):
    """Update Zephyr test case steps and expected results."""
    try:
        if payload.steps is None and payload.expected_result is None:
            return {"success": True, "message": "No fields to update"}
        
        updated_fields = []
        
        if payload.steps:
            steps_payload = [s.model_dump() for s in payload.steps]
            await zephyr_service.update_test_steps(
                issue_id=issue_id,
                project_id=PROJECT_ID,
                steps=steps_payload
            )
            updated_fields.append("steps")
        
        return {
            "success": True,
            "message": "Test case updated successfully",
            "updated_fields": updated_fields
        }
        
    except Exception as e:
        logger.error(f"Error updating Zephyr test case {issue_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update test case: {str(e)}")

