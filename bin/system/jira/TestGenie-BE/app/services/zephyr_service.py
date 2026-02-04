"""
Zephyr Squad API Service

This module provides a clean interface to interact with Zephyr Squad API for test management.
It handles authentication, HTTP requests, and data parsing for various Zephyr operations.
"""

import httpx
import jwt
import time
import hashlib
import asyncio
from typing import List, Optional, Dict, Any, Union
from urllib.parse import urlsplit, parse_qsl, quote
from app.core.config import settings
from app.models.zephyr import (
    ZephyrTestCase,
    ZephyrTestCaseCreate,
    ZephyrTestCaseUpdate,
    ZephyrTestCaseWithSteps,
    ZephyrTestStepCreate,
    ZephyrTestStepResponse,
    ZephyrTestCaseCreateRequest,
)
import logging
from collections import defaultdict
from app.utils.retry import retry_on_network_error, async_retry, RetryConfig
from app.utils.zephyr_auth import ZephyrAuthHelper

logger = logging.getLogger(__name__)

# =============================================================================
# CONSTANTS
# =============================================================================

API_VERSION = "1.0"  # Zephyr API version to use
TIMEOUT_DEFAULT = 30.0  # Default HTTP request timeout in seconds
MAX_CONCURRENT_REQUESTS = 6  # Maximum concurrent API requests
DELETE_CONCURRENCY = 5  # Concurrent deletions for test steps

# Get PROJECT_ID from settings
from app.core.config import settings as app_settings
PROJECT_ID = app_settings.zephyr_project_id

# =============================================================================
# DEPRECATED: Use ZephyrAuthHelper instead
# =============================================================================

def _pct_encode(s: str) -> str:
    """Deprecated: Use ZephyrAuthHelper.canonicalize instead."""
    return ZephyrAuthHelper.canonicalize(s)

# =============================================================================
# MAIN SERVICE CLASS
# =============================================================================


class ZephyrService:
    """
    Service for interacting with Zephyr Squad API.

    Handles authentication, HTTP requests, and data processing for test management
    operations including test cases, cycles, executions, and steps.
    """

    def __init__(self):
        """Initialize service with configuration from settings"""
        self.base_url = settings.zephyr_base_url
        self.access_key = settings.zephyr_access_key
        self.secret_key = settings.zephyr_secret_key
        self.account_id = settings.zephyr_account_id
        self._issue_locks: Dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    # =============================================================================
    # AUTHENTICATION & HTTP HELPERS
    # =============================================================================

    def _create_query_string_hash(
        self, method: str, uri: str, query_string: str
        ) -> str:
        """Create query string hash for JWT authentication"""
        return ZephyrAuthHelper.create_query_string_hash(
            base_url=self.base_url,
            method=method,
            uri=uri,
            query_string=query_string
        )

    def _generate_jwt_token(self, method: str, uri: str, query_params: str = "") -> str:
        """Generate JWT token for Zephyr Squad API authentication."""
        return ZephyrAuthHelper.generate_jwt_token(
            access_key=self.access_key,
            secret_key=self.secret_key,
            method=method,
            uri=uri,
            base_url=self.base_url,
            query_params=query_params,
            account_id=self.account_id
        )
        return token if isinstance(token, str) else token.decode("utf-8")

    def _get_headers(
        self, method: str, uri: str, query_params: str = "",  *, has_json: bool = False
        ) -> Dict[str, str]:
        """Get HTTP headers with JWT authentication"""
        token = self._generate_jwt_token(method, uri, query_params)
        headers = {
            "Authorization": f"JWT {token}",
            "zapiAccessKey": self.access_key,
            "zapiAccountId": self.account_id,
            # add Accept to be explicit, but skip Content-Type unless we send JSON
            "Accept": "application/json",
        }
        if has_json:
            headers["Content-Type"] = "application/json"
        return headers
    
    async def _make_request_without_retry(
        self,
        method: str,
        uri: str,
        query_params: str = "",
        json_data: Optional[Dict] = None,
        timeout: float = TIMEOUT_DEFAULT,
    ) -> Dict[str, Any]:
        """
        Internal HTTP request method without retry logic.
        Used by the retry wrapper to make actual requests.
        """
        has_json = (method in ("POST", "PUT") and json_data is not None)
        headers = self._get_headers(method, uri, query_params, has_json=has_json)

        url = f"{self.base_url}{uri}"
        if query_params:
            url += f"?{query_params}"

        async with httpx.AsyncClient(timeout=timeout) as client:
            if method == "GET":
                resp = await client.get(url, headers=headers)
            elif method == "POST":
                resp = await client.post(url, headers=headers, json=json_data)
            elif method == "PUT":
                resp = await client.put(url, headers=headers, json=json_data)
            elif method == "DELETE":
                resp = await client.delete(url, headers=headers)  # no body
            else:
                raise ValueError(f"Unsupported HTTP method: {method}")

        try:
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            # keep error log tiny and familiar
            snippet = ""
            if e.response is not None:
                try:
                    snippet = (e.response.text or "")[:300].replace("\n", " ")
                except Exception:
                    snippet = ""
            logger.error(
                "HTTP ERROR %s %s%s -> %s %s",
                method, uri, f"?{query_params}" if query_params else "",
                e.response.status_code if e.response else "?", snippet
            )
            raise

        if method == "DELETE" and resp.status_code == 204:
            return {}

        # prefer JSON; if not JSON, return {} to match prior behavior
        ctype = (resp.headers.get("content-type") or "").lower()
        if "application/json" in ctype:
            return resp.json() or {}
        try:
            return resp.json() or {}
        except Exception:
            return {}

    async def _make_request(
        self,
        method: str,
        uri: str,
        query_params: str = "",
        json_data: Optional[Dict] = None,
        timeout: float = TIMEOUT_DEFAULT,
    ) -> Dict[str, Any]:
        """
        HTTP wrapper for Zephyr API with retry logic for network failures.
        
        Automatically retries on network errors like DNS resolution failures,
        connection timeouts, and temporary service unavailability.
        
        Args:
            method: HTTP method (GET, POST, PUT, DELETE)
            uri: API endpoint URI
            query_params: Query parameters string
            json_data: JSON data for POST/PUT requests
            timeout: Request timeout in seconds
            
        Returns:
            Dict containing the API response
            
        Raises:
            Exception: If all retry attempts fail
        """
        # Configure retry behavior for Zephyr API
        retry_config = RetryConfig(
            max_attempts=3,
            base_delay=1.0,
            max_delay=10.0,
            exponential_base=2.0,
            jitter=True
        )
        
        try:
            return await async_retry(
                self._make_request_without_retry,
                retry_config,
                method,
                uri,
                query_params,
                json_data,
                timeout
            )
        except Exception as e:
            logger.error(
                f"Failed to complete Zephyr API request after {retry_config.max_attempts} attempts: "
                f"{method} {uri} - {e}"
            )
            raise
    
    async def _bounded_gather(coros, limit: int = MAX_CONCURRENT_REQUESTS):
        """
        Run coroutines with a concurrency limit. Returns list of results
        (exceptions are captured and returned).
        """
        sem = asyncio.Semaphore(limit)

        async def _run(coro):
            async with sem:
                try:
                    return await coro
                except Exception as e:
                    return e  # bubble back for caller to inspect

        tasks = [asyncio.create_task(_run(c)) for c in coros]
        return await asyncio.gather(*tasks)
    
    # =============================================================================
    # TEST CASE OPERATIONS
    # =============================================================================

    def _parse_test_steps(self, raw_data: Any) -> List[ZephyrTestStepResponse]:
        """
        Parse test steps from Zephyr API response.

        Handles different response formats and extracts step information
        """
        # Handle different response formats
        if isinstance(raw_data, dict):
            raw_data = (
                raw_data.get("testSteps")
                or raw_data.get("values")
                or raw_data.get("results")
                or []
            )

        test_steps = []
        for item in raw_data:
            # Unwrap the inner step object
            ts = item.get("teststep") or item.get("testStep") or item

            step_id = str(ts.get("id") or "")
            order_id = int(ts.get("orderId") or 0)
            step_text = ts.get("step") or ts.get("testStep") or ""
            data = ts.get("data") or ts.get("testData")
            result = ts.get("result") or ts.get("expectedResult")

            test_steps.append(
                ZephyrTestStepResponse(
                    id=step_id,
                    step=step_text,
                    data=data,
                    result=result,
                    orderId=order_id,
                )
            )

        # Sort by orderId to maintain Zephyr order
        test_steps.sort(key=lambda s: (s.orderId or 0, s.id))
        return test_steps

    async def get_test_case(self, issue_id: str) -> Optional[ZephyrTestCaseWithSteps]:
        """
        Get a test case with its steps from Zephyr Squad.

        Retrieves test case details and associated test steps
        """
        try:
            uri = f"/public/rest/api/{API_VERSION}/teststep/{issue_id}"
            query_params = f"projectId={PROJECT_ID}"

            raw_data = await self._make_request("GET", uri, query_params)
            test_steps = self._parse_test_steps(raw_data)

            return ZephyrTestCaseWithSteps(
                id=str(issue_id),
                key="",
                name="",
                objective=None,
                precondition=None,
                estimatedTime=None,
                labels=[],
                component=None,
                priority="Medium",
                status="Draft",
                folder=None,
                issueLinks=[],
                createdOn=None,
                modifiedOn=None,
                createdBy=None,
                modifiedBy=None,
                projectId=None,
                testSteps=test_steps,
            )

        except Exception as e:
            logger.error(f"Error getting test case {issue_id}: {e}")
            return None

    async def add_test_steps(
        self,
        *,
        issue_id: Union[str, int],
        project_id: int = PROJECT_ID,
        steps: List[Dict[str, Optional[str]]],
        timeout: float = TIMEOUT_DEFAULT,
    ) -> Dict[str, Any]:
        """
        Add test steps to a test case.

        Creates multiple test steps with step text, data, and expected results
        """
        if not steps:
            return {"steps_created": 0, "created_ids": [], "errors": []}

        issue_id_str = str(issue_id)
        uri = f"/public/rest/api/{API_VERSION}/teststep/{issue_id_str}"
        created_ids = []
        errors = []

        for i, step in enumerate(steps):
            is_last_step = i == len(steps) - 1
            result = await self._add_single_step(
                uri, project_id, step, timeout, is_last_step
            )
            if result["success"]:
                created_ids.append(result["id"])
            else:
                errors.append(result["error"])

        return {
            "steps_created": len(created_ids),
            "created_ids": created_ids,
            "errors": errors,
        }

    async def _add_single_step(
        self,
        uri: str,
        project_id: int,
        step: Dict[str, Optional[str]],
        timeout: float,
        is_last_step: bool,
    ) -> Dict[str, Any]:
        """
        Add a single test step to a test case.

        Helper method for adding individual test steps
        """
        payload = {
            "step": (step.get("step") or "").strip(),
            "data": step.get("data") if step.get("data") is not None else "",
            "result": step.get("result") if is_last_step else "",
        }

        if not payload["step"]:
            return {"success": False, "id": None, "error": "Empty step text"}

        try:
            query_params = f"projectId={project_id}"
            data = await self._make_request("POST", uri, query_params, payload, timeout)

            new_id = str(data.get("id") or "") or str(
                (data.get("teststep") or {}).get("id") or ""
            )

            return {"success": True, "id": new_id, "error": None}
        except Exception as e:
            error_msg = str(e)[:300]
            logger.error(f"Failed to add step: {error_msg}")
            return {"success": False, "id": None, "error": error_msg}
    
    # =============================================================================
    # TEST CYCLE OPERATIONS
    # =============================================================================

    def _parse_cycles_data(
        self, data: Any, project_id: int, version_id: int
        ) -> List[Dict[str, Any]]:
        """
        Parse cycles data from API response.

        Handles different response formats and extracts cycle information
        """
        items = []

        if isinstance(data, dict):
            for key, obj in data.items():
                if key == "recordsCount" or not isinstance(obj, dict):
                    continue
                items.append(self._format_cycle_item(obj, project_id, version_id))
        elif isinstance(data, list):
            for obj in data:
                items.append(self._format_cycle_item(obj, project_id, version_id))

        return items

    def _format_cycle_item(
        self, obj: Dict[str, Any], project_id: int, version_id: int
        ) -> Dict[str, Any]:
        """
        Format a single cycle item from raw API response.

        Standardizes cycle data structure
        """
        return {
            "id": obj.get("id") or obj.get("cycleId"),
            "name": obj.get("name") or obj.get("cycleName"),
            "projectId": obj.get("projectId") or project_id,
            "versionId": obj.get("versionId", version_id),
            "description": obj.get("description"),
            "build": obj.get("build"),
            "environment": obj.get("environment"),
            "startDate": obj.get("startDate") or obj.get("from"),
            "endDate": obj.get("endDate") or obj.get("to"),
            "folderId": obj.get("folderId"),
        }

    def _filter_cycles_by_query(
        self, cycles: List[Dict[str, Any]], query: str
        ) -> List[Dict[str, Any]]:
        """
        Filter cycles by name using client-side search.

        Performs case-insensitive search on cycle names
        """
        query_lower = query.strip().lower()
        return [
            c for c in cycles if (c.get("name") or "").lower().find(query_lower) >= 0
        ]

    async def get_test_cycles(
        self,
        *,
        project_id: int = PROJECT_ID,
        version_id: int,
        offset: int = 0,
        limit: int = 50,
        query: Optional[str] = None,
        timeout: float = TIMEOUT_DEFAULT,
        ) -> Dict[str, Any]:
        """
        Get test cycles for a project and version.

        Retrieves paginated list of test cycles with optional filtering
        """
        try:
            uri = f"/public/rest/api/{API_VERSION}/cycles/projectId/{project_id}/versionId/{version_id}"
            raw_data = await self._make_request("GET", uri, "", timeout=timeout)

            items = self._parse_cycles_data(raw_data, project_id, version_id)

            # Apply client-side filtering
            if query:
                items = self._filter_cycles_by_query(items, query)

            # Apply client-side paging
            total = len(items)
            if offset < 0:
                offset = 0
            end = offset + limit if limit is not None else None
            paged_items = items[offset:end]

            return {
                "items": paged_items,
                "total": total,
                "offset": offset,
                "limit": limit,
            }
        except Exception as e:
            logger.error(f"Error getting test cycles: {e}")
            raise

    async def create_cycle(
        self,
        *,
        project_id: int = PROJECT_ID,
        version_id: int,
        name: str,
        description: Optional[str] = None,
        build: Optional[str] = None,
        environment: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        timeout: float = TIMEOUT_DEFAULT,
        ) -> Dict[str, Any]:
        """
        Create a new test cycle.

        Creates a test cycle under the specified version with optional metadata
        """
        try:
            uri = "/public/rest/api/1.0/cycle"
            query_params = f"projectId={project_id}&versionId={version_id}"

            body = {"name": name}
            if description:
                body["description"] = description
            if build:
                body["build"] = build
            if environment:
                body["environment"] = environment
            if start_date:
                body["startDate"] = start_date
            if end_date:
                body["endDate"] = end_date

            data = await self._make_request("POST", uri, query_params, body, timeout)
            return {"id": data.get("id") or data.get("cycleId"), "raw": data}
        except Exception as e:
            logger.error(f"Error creating cycle: {e}")
            raise

    # =============================================================================
    # EXECUTION OPERATIONS
    # =============================================================================

    async def get_execution_statuses(self) -> List[Dict[str, Any]]:
        """
        Get execution status ID by name.

        Maps status names (PASS/FAIL/WIP/BLOCKED/UNEXECUTED) to their numeric IDs
        """
        try:
            uri = "/public/rest/api/1.0/execution/statuses"
            data = await self._make_request("GET", uri)
            statuses = []
            for item in data:
                statuses.append({"name": item.get("name"), "id": item.get("id")})
            return statuses
        except Exception as e:
            logger.error(f"Error getting execution status ID: {e}")
            return None

    async def add_test_to_cycle(
        self,
        *,
        issue_id: Union[str, int],
        project_id: int = PROJECT_ID,
        cycle_id: int,
        version_id: Optional[int] = None,
        folder_id: Optional[int] = None,
        timeout: float = TIMEOUT_DEFAULT,
        ) -> Dict[str, Any]:
        """
        Add a test to a cycle, creating or finding existing execution.

        Creates execution record for a test in a specific cycle
        """
        try:
            issue_id_str = str(issue_id)
            uri = "/public/rest/api/1.0/execution"
            query_params = f"issueId={issue_id_str}&projectId={project_id}"

            body = {
                "issueId": (
                    int(issue_id_str) if issue_id_str.isdigit() else issue_id_str
                ),
                "projectId": project_id,
                "versionId": version_id,
                "cycleId": cycle_id,
            }
            if folder_id is not None:
                body["folderId"] = folder_id

            data = await self._make_request("POST", uri, query_params, body, timeout)
            exec_id = data.get("id") or (data.get("execution") or {}).get("id")

            return {
                "execution_id": str(exec_id) if exec_id is not None else None,
                "created": True,
                "raw": data,
                "error": None,
            }
        except httpx.HTTPStatusError as e:
            return await self._handle_existing_execution(
                issue_id_str, project_id, cycle_id, e, timeout
            )
        except Exception as e:
            logger.error(f"Error adding test to cycle: {e}")
            return {
                "execution_id": None,
                "created": False,
                "raw": None,
                "error": str(e),
            }

    async def _handle_existing_execution(
        self,
        issue_id: str,
        project_id: int,
        cycle_id: int,
        http_error: httpx.HTTPStatusError,
        timeout: float,
        ) -> Dict[str, Any]:
        """
        Handle case where execution already exists.

        Attempts to find existing execution when creation fails due to duplicates
        """
        text = (
            (http_error.response.text or "")
            if http_error.response is not None
            else str(http_error)
        )

        if "already exist" in text.lower():
            try:
                existing_id = await self._find_execution(
                    issue_id, project_id, cycle_id, timeout
                )
                if existing_id:
                    return {
                        "execution_id": existing_id,
                        "created": False,
                        "raw": None,
                        "error": None,
                    }
            except Exception:
                pass

        logger.error(f"Create execution failed: {text[:500]}")
        return {
            "execution_id": None,
            "created": False,
            "raw": None,
            "error": text[:500],
        }
    
    async def _find_execution(
        self,
        issue_id: str | int,
        project_id: int,
        cycle_id: int | None,
        timeout: float,
        ) -> Optional[int]:
        """
        Look up an existing execution for a Test.
        Cloud endpoint: GET /public/rest/api/1.0/executions?issueId=&projectId=[&cycleId=]
        Returns the execution id if found, else None.
        """
        uri = "/public/rest/api/1.0/executions"
        pairs = [("issueId", str(issue_id)), ("projectId", str(project_id))]
        if cycle_id is not None:
            pairs.append(("cycleId", str(cycle_id)))
        # Let _canonicalize sort/encode; a plain joined qs string is fine here
        qs = "&".join(f"{k}={v}" for k, v in sorted(pairs, key=lambda kv: kv[0]))

        try:
            data = await self._make_request("GET", uri, qs, timeout=timeout)
        except Exception as e:
            logger.error("Find execution failed: %s", e)
            return None

        # Handle common shapes
        raw = (
            data.get("executions")
            or data.get("searchObjectList")
            or data.get("values")
            or data
            or []
        )

        if isinstance(raw, dict):
            raw = list(raw.values())

        # Try to locate one execution for this issue (and cycle, if provided)
        for item in raw or []:
            obj = item.get("execution") or item
            try_cycle = obj.get("cycleId") or obj.get("cycle", {}).get("id")
            if cycle_id is not None and try_cycle not in (None, str(cycle_id), cycle_id):
                continue
            exec_id = obj.get("id") or obj.get("executionId")
            if exec_id is not None:
                try:
                    return str(exec_id)
                except (ValueError, TypeError):
                    return None
        return None

    async def execute_test(
        self,
        *,
        project_id: int,
        issue_id: int,
        execution_id: str,              # UUID/string is fine
        status_id: int,
        cycle_id: Optional[int] = None, # pass -1 if Ad hoc (optional)
        version_id: Optional[int] = None,  # required if cycle_id == -1
        timeout: float = TIMEOUT_DEFAULT,
    ):
        """
        Set execution status for a Zephyr execution.
        Matches UI pattern:
        PUT /public/rest/api/{v}/execution/{execution_id}?issueId=&projectId=
        Body: {"status":{"id":...}, ["cycleId":...], ["versionId":...]}
        """
        try:
            uri = f"/public/rest/api/{API_VERSION}/execution/{execution_id}"
            # put query in the signed qs, not in the URI
            qs = f"issueId={issue_id}&projectId={project_id}"

            body: Dict[str, Any] = {"status": {"id": status_id}}
            if cycle_id is not None:
                body["cycleId"] = cycle_id
            if version_id is not None:
                body["versionId"] = version_id
            
            body["projectId"] = project_id
            body["id"]= execution_id
            body["issueId"] = issue_id

            await self._make_request("PUT", uri, qs, body, timeout)
        except Exception as e:
            logger.error(f"Error executing test {execution_id}: {e}")
            raise
    # =============================================================================
    # UTILITY METHODS
    # =============================================================================

    async def get_test_cases(
        self,
        project_id: int = PROJECT_ID,
        max_results: int = 100,
        timeout: float = TIMEOUT_DEFAULT,
        ) -> Dict[str, Any]:
        """
        Get test cases for a project.

        Placeholder implementation - needs to be implemented based on specific needs
        """
        # This would need to be implemented based on your specific needs
        # For now, returning a basic structure
        return {"total": 0, "items": [], "max_results": max_results}

    async def list_executions(
        self,
        *,
        issue_id: Union[str, int],
        project_id: int = PROJECT_ID,
        cycle_id: Optional[int] = None,
        timeout: float = TIMEOUT_DEFAULT,
    ) -> List[Dict[str, Any]]:
        """
        GET /public/rest/api/1.0/executions?issueId=&projectId=[&cycleId=]
        Returns normalized executions: execution_id, cycleId, versionId, statusName, statusId.
        """
        uri = "/public/rest/api/1.0/executions"
        pairs = [("issueId", str(issue_id)), ("projectId", str(project_id))]
        if cycle_id is not None:
            pairs.append(("cycleId", str(cycle_id)))
        qs = "&".join(f"{k}={v}" for k, v in sorted(pairs, key=lambda kv: kv[0]))

        data = await self._make_request("GET", uri, qs, timeout=timeout)

        raw = data.get("executions") or data.get("searchObjectList") or data.get("values") or data or []
        if isinstance(raw, dict):
            raw = list(raw.values())

        out: List[Dict[str, Any]] = []
        for item in raw or []:
            ex = item.get("execution") or item
            eid = ex.get("id") or ex.get("executionId")
            if not eid:
                continue
            out.append({
                "execution_id": str(eid),
                "cycleId": ex.get("cycleId") or (ex.get("cycle") or {}).get("id"),
                "versionId": ex.get("versionId") or (ex.get("version") or {}).get("id"),
                "statusId": (ex.get("status") or {}).get("id"),
                "statusName": (ex.get("status") or {}).get("name"),
                "issueId": ex.get("issueId"),
            })
        return out

    async def create_execution_and_optionally_execute(
        self,
        *,
        issue_id: Union[str, int],
        project_id: int,
        cycle_id: int,
        version_id: Optional[int] = None,   # accepted for parity with UI payload; not required by API
        status_id: Optional[int] = None,
        timeout: float = 30.0,
    ) -> Dict[str, Any]:
        """
        Create/find a Zephyr execution for a Test in a cycle, then (optionally) update its status.
        Returns: {"execution_id": "<str|uuid>", "created": bool, "status_updated": bool}
        """
        # 1) Create (or find) execution
        res = await self.add_test_to_cycle(
            issue_id=issue_id,
            project_id=project_id,
            version_id=version_id,
            cycle_id=cycle_id,
            folder_id=None,
            timeout=timeout,
        )
        exec_id = res.get("execution_id")
        created = bool(res.get("created"))

        status_updated = False
        if exec_id and status_id is not None:
            # execute requires int(issue_id)
            try:
                iid = int(str(issue_id))
            except ValueError:
                # if your execute_test strictly requires int, adjust execute_test signature
                iid = int(res.get("issue_id") or 0)  # best-effort fallback

            await self.execute_test(
                project_id=project_id,
                issue_id=iid,
                execution_id=str(exec_id),
                status_id=int(status_id),
                timeout=timeout,
            )
            status_updated = True

        return {
            "execution_id": str(exec_id) if exec_id else None,
            "created": created,
            "status_updated": status_updated,
        }

    async def update_test_steps(
    self,
    *,
    issue_id: Union[str, int],
    project_id: int = PROJECT_ID,
    steps: List[Dict[str, Optional[str]]],
    timeout: float = TIMEOUT_DEFAULT,
    delete_concurrency: int = 6,
    ) -> Dict[str, Any]:
        """
        Update test steps for a Zephyr test case.
        Sequence (unchanged in spirit):
        1) GET existing steps (snapshot)
        2) DELETE snapshot in parallel (bounded), then wait
        3) Re-GET to confirm clean slate; best-effort delete leftovers
        4) ADD new steps
        Serialized per-issue_id to avoid overlapping runs clobbering each other.
        """
        if not steps:
            return {"steps_deleted": 0, "steps_created": 0, "created_ids": [], "errors": []}

        issue_id_str = str(issue_id)
        lock = self._issue_locks[issue_id_str]  # serialize per issue
        errors: List[str] = []
        deleted_count = 0

        async with lock:  # <<==== key: only one run per issue_id at a time
            try:
                logger.info(f"Updating test steps for issue {issue_id_str}")

                # 1) GET current steps (snapshot IDs BEFORE deletion)
                test_case = await self.get_test_case(issue_id_str)
                existing = list(getattr(test_case, "testSteps", []) or [])
                snapshot_ids: List[str] = []
                for s in existing:
                    sid = getattr(s, "id", None)
                    if sid:
                        sid = str(sid).strip()
                        if sid:
                            snapshot_ids.append(sid)

                logger.info(f"Found {len(snapshot_ids)} existing steps to delete (snapshot)")

                # 2) DELETE snapshot in parallel (bounded), retry a bit on transient errors
                if snapshot_ids:
                    sem = asyncio.Semaphore(delete_concurrency)

                    async def _delete_one(step_id: str) -> bool:
                        attempts = 0
                        while attempts < 3:
                            attempts += 1
                            async with sem:
                                try:
                                    logger.debug(f"Deleting step {step_id} (attempt {attempts})")
                                    ok = await self.delete_test_step(issue_id_str, project_id, step_id, timeout)
                                    if ok:
                                        return True
                                    logger.warning(f"Delete returned False for step {step_id} (attempt {attempts})")
                                except Exception as e:
                                    logger.error(f"Delete error for step {step_id} (attempt {attempts}): {str(e)[:200]}")
                            await asyncio.sleep(0.2 * attempts)
                        return False

                    results = await asyncio.gather(*[asyncio.create_task(_delete_one(sid)) for sid in snapshot_ids])

                    for ok in results:
                        if ok:
                            deleted_count += 1
                        else:
                            errors.append("Failed to delete a step (returned False after retries)")

                logger.info(f"Deleted {deleted_count}/{len(snapshot_ids)} steps for issue {issue_id_str}")

                # 3) Re-GET & best-effort leftover cleanup (handles cross-user or prior runs' residue)
                post_delete_case = await self.get_test_case(issue_id_str)
                leftovers = [str(s.id).strip() for s in getattr(post_delete_case, "testSteps", []) or [] if getattr(s, "id", None)]
                if leftovers:
                    logger.warning(f"Leftover steps exist after delete for issue {issue_id_str}: {leftovers}")
                    # try once more (sequentially to keep it simple)
                    for sid in leftovers:
                        try:
                            ok = await self.delete_test_step(issue_id_str, project_id, sid, timeout)
                            if ok:
                                deleted_count += 1
                            else:
                                errors.append(f"Failed to delete leftover step {sid}")
                        except Exception as e:
                            errors.append(f"Exception deleting leftover step {sid}: {str(e)[:200]}")

                    # check again; if still present, we can either fail or proceed — here we proceed but warn
                    confirm_case = await self.get_test_case(issue_id_str)
                    still = [str(s.id).strip() for s in getattr(confirm_case, "testSteps", []) or [] if getattr(s, "id", None)]
                    if still:
                        warn = f"Steps still present after cleanup for issue {issue_id_str}: {still}"
                        logger.warning(warn)
                        errors.append(warn)

                # 4) ADD new steps
                logger.info(f"Adding {len(steps)} new steps for issue {issue_id_str}")
                add_result = await self.add_test_steps(
                    issue_id=issue_id_str,
                    project_id=project_id,
                    steps=steps,
                    timeout=timeout
                )

                return {
                    "steps_deleted": deleted_count,
                    "steps_created": add_result.get("steps_created", 0),
                    "created_ids": add_result.get("created_ids", []),
                    "errors": errors + add_result.get("errors", [])
                }

            except Exception as e:
                error_msg = f"Error updating test steps for issue {issue_id_str}: {str(e)[:300]}"
                logger.error(error_msg)
                errors.append(error_msg)
                return {
                    "steps_deleted": deleted_count,
                    "steps_created": 0,
                    "created_ids": [],
                    "errors": errors
                }

    # async def update_test_steps(
    #     self,
    #     *,
    #     issue_id: Union[str, int],
    #     project_id: int = PROJECT_ID,
    #     steps: List[Dict[str, Optional[str]]],
    #     timeout: float = TIMEOUT_DEFAULT,
    # ) -> Dict[str, Any]:
    #     """
    #     Update test steps for a Zephyr test case.
    #     This will replace existing steps with new ones.
        
    #     Args:
    #         issue_id: The test case issue ID
    #         project_id: The Zephyr project ID
    #         steps: List of step dictionaries with 'step', 'data', and 'result' keys
    #         timeout: Request timeout in seconds
            
    #     Returns:
    #         Dictionary with operation results including steps_deleted, steps_created, created_ids, and errors
    #     """
    #     if not steps:
    #         return {
    #             "steps_deleted": 0,
    #             "steps_created": 0,
    #             "created_ids": [],
    #             "errors": []
    #         }

    #     issue_id_str = str(issue_id)
    #     deleted_count = 0
    #     errors = []

    #     try:
    #         logger.info(f"Updating test steps for issue {issue_id_str}")
            
    #         # First, get existing steps to delete them
    #         test_case = await self.get_test_case(issue_id_str)
    #         print(f"test_case: {test_case}")
    #         print(f"test_case.testSteps: {test_case.testSteps}")
    #         if test_case and test_case.testSteps:
    #             logger.info(f"Found {len(test_case.testSteps)} existing steps to delete")
                
    #             # Delete existing steps
    #             for step in test_case.testSteps:
    #                 if step.id:
    #                     try:
    #                         logger.debug(f"Deleting step {step.id}")
    #                         await self.delete_test_step(issue_id_str, project_id, step.id, timeout)
    #                         deleted_count += 1
    #                     except Exception as e:
    #                         error_msg = f"Failed to delete step {step.id}: {str(e)[:200]}"
    #                         logger.error(error_msg)
    #                         errors.append(error_msg)
            
    #         logger.info(f"Deleted {deleted_count} existing steps for issue {issue_id_str}")
            
    #         # Add new steps using the existing add_test_steps method
    #         if steps:
    #             logger.info(f"Adding {len(steps)} new steps for issue {issue_id_str}")
    #             add_result = await self.add_test_steps(
    #                 issue_id=issue_id_str,
    #                 project_id=project_id,
    #                 steps=steps,
    #                 timeout=timeout
    #             )
                
    #             # Combine results
    #             return {
    #                 "steps_deleted": deleted_count,
    #                 "steps_created": add_result.get("steps_created", 0),
    #                 "created_ids": add_result.get("created_ids", []),
    #                 "errors": errors + add_result.get("errors", [])
    #             }
    #         else:
    #             # No new steps to add, just return deletion results
    #             return {
    #                 "steps_deleted": deleted_count,
    #                 "steps_created": 0,
    #                 "created_ids": [],
    #                 "errors": errors
    #             }
                
    #     except Exception as e:
    #         error_msg = f"Error updating test steps for issue {issue_id_str}: {str(e)[:300]}"
    #         logger.error(error_msg)
    #         errors.append(error_msg)
    #         return {
    #             "steps_deleted": deleted_count,
    #             "steps_created": 0,
    #             "created_ids": [],
    #             "errors": errors
    #         }
    
    # async def get_test_steps(
    #     self,
    #     issue_id: Union[str, int],
    #     project_id: int,
    #     timeout: float = 30.0
    # ) -> List[Dict[str, Any]]:
    #     """Get existing test steps for an issue"""
    #     try:
    #         url = f"{self.base_url}/public/rest/api/1.0/teststep/{issue_id}"
    #         query_params = {"projectId": project_id}
    #         print(f"URL: {url}")
    #         print(f"Query params: {query_params}")
    #         raw_data= await self._make_request("GET", url, query_params=query_params, timeout=timeout)
    #         print(f"Raw data: {raw_data}")
    #         return raw_data.get("steps") or []
                
    #     except Exception as e:
    #         logger.error(f"Error getting test steps for issue {issue_id}: {e}")
    #         return []

    # 3) keep your delete method on v1.0 and rely on 2xx as success
    async def delete_test_step(
        self, issue_id: Union[str, int], project_id: int, step_id: Union[str, int],
        timeout: float = TIMEOUT_DEFAULT
    ) -> bool:
        uri = f"/public/rest/api/1.0/teststep/{issue_id}/{step_id}"
        qs = f"projectId={project_id}"
        try:
            response= await self._make_request("DELETE", uri, qs, timeout=timeout)
            logger.info(f"Deleted test step {step_id} for issue {issue_id} response: {response}")
            return True
        except httpx.HTTPStatusError as e:
            body = e.response.text[:500] if e.response is not None else ""
            logger.error(
                "Error deleting test step %s for issue %s: HTTP %s %s",
                step_id, issue_id, e.response.status_code if e.response else "?", body
            )
            return False

# =============================================================================
# SINGLETON INSTANCE
# =============================================================================

# Create singleton instance for use across the application
zephyr_service = ZephyrService()
