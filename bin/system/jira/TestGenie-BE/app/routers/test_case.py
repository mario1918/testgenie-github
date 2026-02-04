# routers/test_case.py (new orchestrator)
from fastapi import APIRouter, HTTPException, Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import asyncio

from app.models.test_case import FullCreateBody, CreateExecutionRequest, CreateExecutionResponse, BulkFullCreateResponse, BulkFullCreateRequest, BulkItemResult, ItemFailure, ItemSuccess
from app.services.jira_service import jira_service
from app.services.zephyr_service import zephyr_service
from app.core.config import settings
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/test-cases", tags=["test-cases"])


@router.post(
    "/full-create",
    response_model=dict,
    summary="Create complete test case",
    description="Create a full test case with Jira issue, Zephyr steps, and execution setup"
)
async def create_full_test_case(body: FullCreateBody):
    """
    Create a complete test case with all components.
    
    This endpoint performs the following operations:
    1. Create Jira Test issue with provided details
    2. Add Zephyr test steps to the created issue
    3. Add the test to specified version/cycle (create execution)
    4. Update execution status if specified
    
    Args:
        body: Complete test case creation request with issue details, steps, and execution info
        
    Returns:
        Dict containing created issue details, execution info, and operation results
        
    Raises:
        HTTPException: If any step in the creation process fails
    """
    try:
      # 1) Create Jira Test
      created = await jira_service.create_test_issue(
          project_key=settings.jira_project_id,
          summary=body.summary,
          description=body.description,
          components=body.components or [],
          related_issues=body.related_issues or [],
          custom_fields={settings.jira_sprint_field: body.sprint_id} if body.sprint_id else None
      )
      issue_id = str(created["id"])   # numeric id
      issue_key = created["key"]      # "SE2-xxxx"

      # Optional: assign sprint AFTER creation if you need it (Agile API)
      # 2) Add steps to Zephyr (if any)
      add_steps_task = None
      if body.steps:
          add_steps_task = asyncio.create_task(zephyr_service.add_test_steps(
              issue_id=issue_id,
              project_id=settings.zephyr_project_id,
              steps=body.steps
          ))
      # 3) Add to version/cycle (create execution) if both provided
      add_to_cycle_task = None
      if body.version_id is not None and body.cycle_id is not None:
          add_to_cycle_task = asyncio.create_task(zephyr_service.add_test_to_cycle(
              issue_id=issue_id,
              project_id=settings.zephyr_project_id,
              cycle_id=body.cycle_id,
              folder_id=None,
              version_id=body.version_id
          ))
      # Run (2) & (3) in parallel (whatever exists)
      exec_id = None
      if add_steps_task and add_to_cycle_task:
          steps_res, add_cycle_res = await asyncio.gather(add_steps_task, add_to_cycle_task)
          exec_id = (add_cycle_res or {}).get("execution_id")
      elif add_steps_task:
          await add_steps_task
      elif add_to_cycle_task:
          add_cycle_res = await add_to_cycle_task
          exec_id = (add_cycle_res or {}).get("execution_id")
      # 4) If we have an execution AND user asked for a status → execute it
      if exec_id and body.execution_status:
        status_id = body.execution_status.get("id")
        await zephyr_service.execute_test(
                  project_id=settings.zephyr_project_id,
                  issue_id=int(issue_id),
                  execution_id=str(exec_id),
                  status_id=int(status_id)
          )
      return {
          "jira": {"id": issue_id, "key": issue_key},
          "execution_id": exec_id or None
      }

    except HTTPException:
      raise
    except Exception as e:
      raise HTTPException(status_code=502, detail=f"Full create failed: {e}")

@router.post(
    "/{issue_id}/execution", 
    response_model=CreateExecutionResponse,
    summary="Create test execution",
    description="Create or find a Zephyr execution for a test case in a specific cycle"
)
async def create_test_execution(
    issue_id: str = Path(..., description="Jira issue ID (numeric) of the test case"),
    body: CreateExecutionRequest = ...,
):
    """
    Create or find a Zephyr execution for a test case in the specified cycle.
    
    If execution_status.id is provided, the execution status will be set immediately.
    
    Args:
        issue_id: Numeric Jira issue ID of the test case
        body: Execution creation request with cycle, version, and optional status
        
    Returns:
        CreateExecutionResponse: Details of the created or found execution
        
    Raises:
        HTTPException: If execution creation fails or test case not found
    """
    try:
        # sanity-check: path and body issue_id should match, but trust path param
        if body.issue_id and str(body.issue_id) != str(issue_id):
            logger.warning("Body issue_id (%s) != path issue_id (%s); using path value.", body.issue_id, issue_id)

        status_id = body.execution_status.id if body.execution_status else None

        res = await zephyr_service.create_execution_and_optionally_execute(
            issue_id=issue_id,
            project_id=settings.zephyr_project_id,
            cycle_id=body.cycle_id,
            version_id=body.version_id,
            status_id=status_id,
        )

        if not res.get("execution_id"):
            # If the service couldn't produce/find an execution, treat it as a bad upstream outcome
            raise HTTPException(status_code=502, detail="Failed to create or locate execution")

        return CreateExecutionResponse(
            issue_id=str(issue_id),
            project_id=settings.zephyr_project_id,
            cycle_id=body.cycle_id,
            version_id=body.version_id,
            execution_id=str(res["execution_id"]),
            created=bool(res.get("created")),
            status_updated=bool(res.get("status_updated")),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Create execution failed: {e}")

# --- Your existing single-item flow as a helper ---
async def _full_create_one(body: FullCreateBody) -> Dict[str, Any]:
    created = await jira_service.create_test_issue(
        project_key=settings.jira_project_id,
        summary=body.summary,
        description=body.description,
        components=body.components or [],
        related_issues=body.related_issues or [],
        custom_fields={settings.jira_sprint_field: body.sprint_id} if body.sprint_id else None
    )
    issue_id = str(created["id"])
    issue_key = created["key"]

    add_steps_task = None
    if body.steps:
        add_steps_task = asyncio.create_task(
            zephyr_service.add_test_steps(
                issue_id=issue_id,
                project_id=settings.zephyr_project_id,
                steps=body.steps
            )
        )

    add_to_cycle_task = None
    exec_id = None
    if body.version_id is not None and body.cycle_id is not None:
        add_to_cycle_task = asyncio.create_task(
            zephyr_service.add_test_to_cycle(
                issue_id=issue_id,
                project_id=settings.zephyr_project_id,
                cycle_id=body.cycle_id,
                folder_id=None,
                version_id=body.version_id
            )
        )

    if add_steps_task and add_to_cycle_task:
        _, add_cycle_res = await asyncio.gather(add_steps_task, add_to_cycle_task)
        exec_id = (add_cycle_res or {}).get("execution_id")
    elif add_steps_task:
        await add_steps_task
    elif add_to_cycle_task:
        add_cycle_res = await add_to_cycle_task
        exec_id = (add_cycle_res or {}).get("execution_id")

    if exec_id and body.execution_status:
        status_id = body.execution_status.get("id")
        await zephyr_service.execute_test(
            project_id=settings.zephyr_project_id,
            issue_id=int(issue_id),
            execution_id=str(exec_id),
            status_id=int(status_id)
        )

    return {"jira": {"id": issue_id, "key": issue_key}, "execution_id": exec_id or None}

# --- Bulk endpoint with top-level version/cycle applied to every item ---
@router.post(
    "/bulk/full-create", 
    response_model=BulkFullCreateResponse,
    summary="Bulk create test cases",
    description="Create multiple complete test cases with shared version and cycle settings"
)
async def create_bulk_test_cases(payload: BulkFullCreateRequest):
    """
    Bulk creation of complete test cases.
    
    Creates multiple test cases with the same version and cycle settings applied to all.
    Each test case goes through the full creation process: Jira issue, Zephyr steps, and execution setup.
    
    Args:
        payload: Bulk creation request containing:
            - TestCases: List of test case creation requests
            - version_id: Version ID applied to all test cases
            - cycle_id: Cycle ID applied to all test cases
            
    Returns:
        BulkFullCreateResponse: Results for each test case creation with success/failure details
        
    Raises:
        HTTPException: If bulk operation fails or validation errors occur
        
    Note:
        Top-level version_id and cycle_id override any per-item values in the test cases.
    """
    items = payload.TestCases
    total = len(items)

    # Prepare items with enforced top-level version/cycle
    enforced_items: List[FullCreateBody] = []
    for tc in items:
        # force override on each item if top-level provided
        tc_dict = tc.model_dump()
        if payload.version_id is not None:
            tc_dict["version_id"] = payload.version_id
        if payload.cycle_id is not None:
            tc_dict["cycle_id"] = payload.cycle_id
        enforced_items.append(FullCreateBody(**tc_dict))

    CONCURRENCY = 5
    sem = asyncio.Semaphore(CONCURRENCY)

    async def run_one(idx: int, body: FullCreateBody) -> BulkItemResult:
        async with sem:
            try:
                result = await _full_create_one(body)
                return BulkItemResult(
                    index=idx,
                    input_summary=body.summary,
                    success=True,
                    result=ItemSuccess(**result),
                    failure=None,
                )
            except HTTPException as he:
                return BulkItemResult(
                    index=idx,
                    input_summary=body.summary,
                    success=False,
                    result=None,
                    failure=ItemFailure(error=f"HTTP {he.status_code}: {he.detail}"),
                )
            except Exception as e:
                return BulkItemResult(
                    index=idx,
                    input_summary=body.summary,
                    success=False,
                    result=None,
                    failure=ItemFailure(error=str(e)),
                )

    tasks = [asyncio.create_task(run_one(i, tc)) for i, tc in enumerate(enforced_items)]
    results = await asyncio.gather(*tasks)

    succeeded = sum(1 for r in results if r.success)
    failed = total - succeeded
    return BulkFullCreateResponse(
        total=total,
        succeeded=succeeded,
        failed=failed,
        results=results
    )