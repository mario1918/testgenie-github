# =============================================================
# Jira Service
# - Projects / Boards / Sprints
# - Components / Versions
# - Issues (search, create, link)
# =============================================================
import httpx
import base64
from typing import List, Optional, Dict, Any, Union
from datetime import datetime
from app.core.config import settings
from app.models.jira import JiraSprint, JiraProject, JiraBoard, JiraIssue
from app.utils.adf_converter import text_to_adf, adf_to_text
from app.utils.jira_helpers import canonicalize_name
import logging

logger = logging.getLogger(__name__)


class JiraService:
    """
    Service for interacting with Jira Cloud API.
    Handles projects, boards, sprints, issues, and test case management.
    """
    
    # Constants
    DEFAULT_TIMEOUT = 30.0
    DEFAULT_MAX_RESULTS = 50
    DEFAULT_LINK_TYPE = "Relates"
    
    def __init__(self):
        """Initialize Jira service with configuration from settings."""
        self.base_url = settings.jira_base_url.rstrip('/')
        self.username = settings.jira_username
        self.api_token = settings.jira_api_token
        self.default_assignee_account_id = settings.zephyr_account_id
        
        # Create basic auth header
        self.headers = self._create_auth_headers()
        self._client: Optional[httpx.AsyncClient] = None
    
    def _create_auth_headers(self) -> Dict[str, str]:
        """Create authentication headers for Jira API."""
        credentials = f"{self.username}:{self.api_token}"
        encoded_credentials = base64.b64encode(credentials.encode()).decode()
        return {
            "Authorization": f"Basic {encoded_credentials}",
            "Accept": "application/json",
            "Content-Type": "application/json"
        }
    
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create reusable HTTP client."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=self.DEFAULT_TIMEOUT,
                headers=self.headers
            )
        return self._client
    
    async def close(self):
        """Close HTTP client and cleanup resources."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None
    
    def _parse_iso(self, dt: Optional[str]) -> Optional[datetime]:
        if not dt:
            return None
        # Jira sends Z or +hh:mm offsets
        try:
            return datetime.fromisoformat(dt.replace("Z", "+00:00"))
        except Exception:
            return None

    # Projects -----------------------------------------------

    async def get_projects(self) -> List[JiraProject]:
        """Get the configured Jira project"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/rest/api/3/project",
                    headers=self.headers,
                    timeout=30.0
                )
                response.raise_for_status()
                
                projects_data = response.json()
                projects = []
                
                for project_data in projects_data:
                    if (
                        project_data.get("id") == settings.jira_project_id and
                        project_data.get("key") == settings.jira_project_key and
                        project_data.get("name") == settings.jira_project_name
                    ):
                        project = JiraProject(
                            id=project_data["id"],
                            key=project_data["key"],
                            name=project_data["name"],
                            description=project_data.get("description")
                        )
                        projects.append(project)
                        break  # stop once we find it
                
                if projects:
                    logger.info(f"Retrieved project: {projects[0]}")
                else:
                    logger.warning(f"Project {settings.jira_project_name} not found")
                
                return projects

        except httpx.HTTPError as e:
            logger.error(f"HTTP error getting project: {e}")
            return []
        except Exception as e:
            logger.error(f"Error getting project: {e}")
            return []
    # Boards -------------------------------------------------

    async def get_boards(self, project_key: Optional[str] = None) -> List[JiraBoard]:
        """Get Jira boards, optionally filtered by project"""
        try:
            url = f"{self.base_url}/rest/agile/1.0/board"
            params = {}
            if project_key:
                params["projectKeyOrId"] = project_key
            
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    url,
                    headers=self.headers,
                    params=params,
                    timeout=30.0
                )
                response.raise_for_status()
                
                data = response.json()
                boards = []
                
                for board_data in data.get("values", []):
                    board = JiraBoard(
                        id=board_data["id"],
                        name=board_data["name"],
                        type=board_data["type"],
                        project_key=board_data.get("location", {}).get("projectKey", "")
                    )
                    boards.append(board)
                return boards
                
        except httpx.HTTPError as e:
            logger.error(f"HTTP error getting boards: {e}")
            return []
        except Exception as e:
            logger.error(f"Error getting boards: {e}")
            return []
    # Sprints (ordered) --------------------------------------

    async def get_sprints_ordered(self, board_id: int) -> List[JiraSprint]:
        """Get sprints for a specific board with active/future first, then closed (paged)."""
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                async def fetch_state(state: str | None) -> list[dict]:
                    params = {"maxResults": 50}
                    if state:
                        params["state"] = state
                    start_at = 0
                    out: list[dict] = []
                    while True:
                        params["startAt"] = start_at
                        r = await client.get(
                            f"{self.base_url}/rest/agile/1.0/board/{board_id}/sprint",
                            headers=self.headers,
                            params=params,
                        )
                        r.raise_for_status()
                        page = r.json()
                        values = page.get("values", [])
                        out.extend(values)
                        # advance by actual count returned
                        if page.get("isLast") or not values:
                            break
                        start_at += len(values)
                    return out

                # 1) Active + future first
                active_future_raw = await fetch_state("active,future")
                # 2) Then closed
                closed_raw = await fetch_state("closed")

                # Combine (active/future first), de-duping by id just in case
                seen: set[int] = set()
                ordered_raw: list[dict] = []
                for s in active_future_raw + closed_raw:
                    sid = s.get("id")
                    if sid not in seen:
                        ordered_raw.append(s)
                        seen.add(sid)

                # Map to JiraSprint models
                sprints: List[JiraSprint] = [
                    JiraSprint(
                        id=s["id"],
                        name=s["name"],
                        state=s["state"],
                        start_date=s.get("startDate"),
                        end_date=s.get("endDate"),
                        complete_date=s.get("completeDate"),
                        board_id=board_id,
                    )
                    for s in ordered_raw
                ]

                # Final stable sort: active < future < closed, then by name
                def sort_key(sp: JiraSprint):
                    order = {"active": 0, "future": 1, "closed": 2}
                    return (order.get(sp.state, 3), sp.name or "")

                sprints.sort(key=sort_key)

                return sprints

        except httpx.HTTPError as e:
            logger.error(f"HTTP error getting ordered sprints: {e}")
            return []
        except Exception as e:
            logger.error(f"Error getting ordered sprints: {e}")
            return []
    # Sprints (all boards) -----------------------------------

    async def get_all_sprints_ordered(self) -> List[JiraSprint]:
        """Get all sprints from configured board, ordered with active sprints first"""
        try:
            all_sprints = []

            sprints = await self.get_sprints_ordered(settings.jira_board_id)
            all_sprints.extend(sprints)
            
            # Sort all sprints globally: active first, then future, then closed
            def sort_key(sprint):
                if sprint.state == "active":
                    return (0, sprint.name)
                elif sprint.state == "future":
                    return (1, sprint.name)
                else:  # closed
                    return (2, sprint.name)
            
            all_sprints.sort(key=sort_key)
            return all_sprints
            
        except Exception as e:
            logger.error(f"Error getting all ordered sprints: {e}")
            return []
    # Components --------------------------------------------

    async def get_components(self, project_key: str) -> List[dict]:
        """Get components for a specific project"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/rest/api/3/project/{project_key}/components",
                    headers=self.headers,
                    timeout=30.0
                )
                response.raise_for_status()
                
                components_data = response.json()
                components = []
                
                for component_data in components_data:
                    component = {
                        "id": component_data["id"],
                        "name": component_data["name"],
                        "description": component_data.get("description", ""),
                        "project_key": project_key
                    }
                    components.append(component)

                return components
                
        except httpx.HTTPError as e:
            logger.error(f"HTTP error getting components: {e}")
            return []
        except Exception as e:
            logger.error(f"Error getting components: {e}")
            return []
    
    async def get_all_components(self) -> List[dict]:
        """Get components from all accessible projects"""
        try:
            projects = await self.get_projects()
            all_components = []
            
            for project in projects:
                components = await self.get_components(project.key)
                all_components.extend(components)
            
            return all_components
            
        except Exception as e:
            logger.error(f"Error getting all components: {e}")
            return []
   
    async def get_project_versions_all(
        self,
        project_id_or_key: str,
        max_per_page: int = 50,
        timeout: float = 30.0,
        query: Optional[str] = None,
        status: Optional[str] = None,   # "released", "unreleased", "archived" (per Jira)
        order_by: Optional[str] = None, # e.g. "name", "releaseDate"
    ) -> List[Dict[str, Any]]:
        """
        Fetch *all* versions for a project by paging over:
        GET /rest/api/3/project/{projectIdOrKey}/version
        """
        start_at = 0
        out: List[Dict[str, Any]] = []

        async with httpx.AsyncClient(timeout=timeout) as client:
            while True:
                params: Dict[str, Any] = {
                    "startAt": start_at,
                    "maxResults": max_per_page,
                }
                if query:    params["query"] = query
                if status:   params["status"] = status
                if order_by: params["orderBy"] = order_by

                r = await client.get(
                    f"{self.base_url}/rest/api/3/project/{project_id_or_key}/version",
                    headers=self.headers,
                    params=params,
                )
                r.raise_for_status()
                page = r.json() or {}
                values = page.get("values", [])
                out.extend(values)
                
                for version in out:
                    if version.get("archived") == True:
                        out.remove(version)

                if page.get("isLast") or not values:
                    break
                start_at += len(values)

        # normalize a minimal shape you likely need
        return [
            {
                "id": v.get("id"),
                "name": v.get("name"),
                "released": v.get("released"),
                "archived": v.get("archived"),
                "releaseDate": v.get("releaseDate"),
                "projectId": v.get("projectId"),
            }
            for v in out
        ]

    async def get_project_versions_limit(
        self,
        project_id_or_key: str,
        max_per_page: int = 10,
        timeout: float = 30.0,
        query: Optional[str] = None,
        status: Optional[str] = None,   # "released", "unreleased", "archived" (per Jira)
        order_by: Optional[str] = None, # e.g. "name", "releaseDate"
    ) -> List[Dict[str, Any]]:
        """
        Fetch *all* versions for a project by paging over:
        GET /rest/api/3/project/{projectIdOrKey}/version
        """
        start_at = 0
        out: List[Dict[str, Any]] = []
        async with httpx.AsyncClient(timeout=timeout) as client:
            params: Dict[str, Any] = {
                    "startAt": start_at,
                    "maxResults": max_per_page,
                }
            if query:    params["query"] = query
            if status:   params["status"] = status
            if order_by: params["orderBy"] = order_by

            r = await client.get(
                    f"{self.base_url}/rest/api/3/project/{project_id_or_key}/version",
                    headers=self.headers,
                    params=params,
                )
            r.raise_for_status()
            page = r.json() or {}
            values = page.get("values", [])
            out.extend(values)
            
            for version in out:
                if version.get("archived") == True or version.get("archived") == "true":
                    out.remove(version)

        # normalize a minimal shape you likely need
        return [
            {
                "id": v.get("id"),
                "name": v.get("name"),
                "released": v.get("released"),
                "archived": v.get("archived"),
                "releaseDate": v.get("releaseDate"),
                "projectId": v.get("projectId"),
            }
            for v in out
        ]

    async def get_project_versions_unpaginated(
        self,
        project_id_or_key: str,
        timeout: float = 30.0,
    ) -> List[Dict[str, Any]]:
        """
        Single call (not paginated):
        GET /rest/api/3/project/{projectIdOrKey}/versions
        """
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.get(
                f"{self.base_url}/rest/api/3/project/{project_id_or_key}/versions",
                headers=self.headers,
            )
            r.raise_for_status()
            arr = r.json() or []
        return arr
    
    async def user_picker(
        self,
        *,
        query: str,
        max_results: int = 20,
        show_avatar: bool = True,
        avatar_size: str = "24x24",
        exclude_account_ids: Optional[List[str]] = None,
        exclude: Optional[List[str]] = None,
        exclude_connect_users: bool = True,
        timeout: float = 30.0,
    ) -> Dict[str, Any]:
        """
        Call Jira Cloud user picker to find users by a free-text query.
        Returns: {"total": int, "users": [{"accountId","displayName","avatarUrl","html"}...]}

        Docs: GET /rest/api/3/user/picker (FoundUsers response).  # query required
        """
        if not query or not str(query).strip():
            raise ValueError("query is required for user_picker")

        params: Dict[str, Any] = {
            "query": query,
            "maxResults": max_results,
            "showAvatar": str(bool(show_avatar)).lower(),
            "avatarSize": avatar_size,
            "excludeConnectUsers": str(bool(exclude_connect_users)).lower(),
        }
        # Arrays are encoded as repeated params by httpx (excludeAccountIds=A&excludeAccountIds=B)
        if exclude_account_ids:
            params["excludeAccountIds"] = exclude_account_ids
        if exclude:
            params["exclude"] = exclude

        url = f"{self.base_url}/rest/api/3/user/picker"
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                r = await client.get(url, headers=self.headers, params=params)
                r.raise_for_status()
                data = r.json() or {}

            # Normalize to a compact shape
            users = [
                {
                    "accountId": u.get("accountId"),
                    "displayName": u.get("displayName"),
                    "avatarUrl": u.get("avatarUrl"),   # already size-adjusted per avatarSize
                    "html": u.get("html"),             # highlighted name/email with <strong>
                }
                for u in (data.get("users") or [])
            ]
            return {
                "total": int(data.get("total") or len(users) or 0),
                "users": users,
            }

        except httpx.HTTPError as e:
            msg = getattr(e.response, "text", str(e))
            logger.error("Jira user_picker failed: %s", msg)
            raise
    # Test issues (paginated) --------------------------------
    async def get_issue(
        self,
        issue_id_or_key: str,
        *,
        fields: Optional[List[str]] = None,
        expand: Optional[List[str]] = None,
        properties: Optional[List[str]] = None,
        timeout: float = 30.0,
    ) -> Dict[str, Any]:
        """
        GET a Jira issue by ID or key.

        Jira API: GET /rest/api/3/issue/{issueIdOrKey}
        - fields: list of field ids/names to return (e.g. ["summary","status","customfield_10007"])
        - expand: list of expansions (e.g. ["changelog","renderedFields"])
        - properties: list of entity property keys to include

        Returns: full issue JSON (dict). Raises on HTTP errors.
        """
        params: Dict[str, str] = {}
        if fields:
            params["fields"] = ",".join(fields)
        if expand:
            params["expand"] = ",".join(expand)
        if properties:
            params["properties"] = ",".join(properties)

        url = f"{self.base_url}/rest/api/3/issue/{issue_id_or_key}"

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                r = await client.get(url, headers=self.headers, params=params)
                r.raise_for_status()
                return r.json() or {}
        except httpx.HTTPStatusError as e:
            text = e.response.text if e.response is not None else str(e)
            logger.error("Jira get_issue failed for %s: %s", issue_id_or_key, text)
            raise
        except Exception as e:
            logger.error("Error getting issue %s: %s", issue_id_or_key, e)
            raise

    async def get_subtasks(
        self,
        story_key: str,
        timeout: float = 30.0,
    ) -> List[Dict[str, Any]]:
        """
        Get all subtasks for a given story/parent issue.
        
        Args:
            story_key: The Jira issue key of the parent story (e.g., 'SE2-123')
            timeout: Request timeout in seconds
            
        Returns:
            List of subtask dictionaries with key fields
            
        Raises:
            httpx.HTTPError: For transport/HTTP errors
        """
        try:
            # Use JQL to find all subtasks of the parent issue
            jql = f'parent = "{story_key}"'
            
            body = {
                "jql": jql,
                "maxResults": 100,  # Adjust if you expect more subtasks
                "fields": [
                    "summary", "description", "issuetype", "status", 
                    "priority", "assignee", "reporter", "created", 
                    "updated", "parent"
                ],
            }
            
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(
                    f"{self.base_url}/rest/api/3/search/jql",
                    headers={
                        **self.headers,
                        "Accept": "application/json",
                        "Content-Type": "application/json",
                    },
                    json=body,
                )
                resp.raise_for_status()
                data = resp.json()
            
            subtasks = []
            for issue_data in data.get("issues", []):
                fields = issue_data.get("fields", {}) or {}
                
                # Description (ADF -> text)
                description = ""
                adf = fields.get("description")
                if isinstance(adf, dict):
                    description = adf_to_text(adf)
                description = "\n".join(line.rstrip() for line in description.splitlines()).strip()
                
                subtasks.append({
                    "id": issue_data.get("id"),
                    "key": issue_data.get("key"),
                    "summary": fields.get("summary", ""),
                    "description": description,
                    "issueType": (fields.get("issuetype") or {}).get("name", ""),
                    "status": (fields.get("status") or {}).get("name", ""),
                    "priority": (fields.get("priority") or {}).get("name", "Medium"),
                    "assignee": (fields.get("assignee") or {}).get("displayName"),
                    "reporter": (fields.get("reporter") or {}).get("displayName", ""),
                    "created": fields.get("created", ""),
                    "updated": fields.get("updated", ""),
                    "parent": (fields.get("parent") or {}).get("key", story_key),
                })
            
            return subtasks
            
        except httpx.HTTPError as e:
            logger.error(f"HTTP error getting subtasks for {story_key}: {e}")
            raise
        except Exception as e:
            logger.error(f"Error getting subtasks for {story_key}: {e}")
            raise
   
    async def get_issue_count(
        self,
        jql: str,
        return_json: bool = False,
        timeout: float = 30.0,
    ) -> Union[int, Dict[str, Any]]:
        """
        Returns an *estimated* count of issues that match a **bounded** JQL.
        Uses POST /rest/api/3/search/approximate-count.

        Args:
            jql: Bounded JQL (e.g., 'project = SE2 AND issuetype = "Test"').
            return_json: If True, return full JSON; otherwise just the integer count.
            timeout: Request timeout in seconds.

        Raises:
            ValueError: If JQL is likely unbounded or API returns 400 with details.
            httpx.HTTPError: For transport/HTTP errors.
        """
        url = f"{self.base_url}/rest/api/3/search/approximate-count"
        body = {"jql": jql}

        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    url,
                    headers={
                        **self.headers,
                        "Accept": "application/json",
                        "Content-Type": "application/json",
                    },
                    json=body,
                    timeout=timeout,
                )

            # Helpful error for unbounded JQL or bad requests
            if resp.status_code == 400:
                try:
                    detail = resp.json()
                except Exception:
                    detail = {"message": resp.text}
                msg = detail.get("message") or detail.get("errorMessages") or detail
                raise ValueError(f"approximate-count rejected the JQL (bounded required): {msg}")

            resp.raise_for_status()
            data = resp.json()  # shape: {"count": <int>}
            return data if return_json else int(data.get("count", 0))

        except httpx.HTTPError as e:
            self.logger.error(f"HTTP error calling approximate-count: {e}")
            raise

    async def get_test_issues_paginated(
        self,
        project_key: Optional[str] = None,
        start_at: int = 0,
        jql_filter: Optional[str] = None,
        max_results: int = 50,
        next_page_token: Optional[str] = None,
    ) -> dict:
        """
        Jira Cloud v3 enhanced JQL search with token-based pagination.
        - Page 1: call with next_page_token=None
        - Next pages: pass the 'nextPageToken' returned from the previous call
        """
        try:
            # Use configured project key if not provided
            proj_key = project_key or settings.jira_project_key
            base_jql = f'project = "{proj_key}"'
            jql = f"{base_jql} AND ({jql_filter})" if jql_filter else base_jql

            body = {
                "jql": jql,
                "maxResults": max_results,
                # Fields MUST be an array (POST body) with the new endpoint
                "fields": [
                    "summary","description","issuetype","status","priority",
                    "assignee","reporter","created","updated","components",
                    settings.jira_sprint_field,"issuelinks"
                ],
            }
            if next_page_token:
                body["nextPageToken"] = next_page_token

            logger.debug(f"next_page_token: {next_page_token}")

            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{self.base_url}/rest/api/3/search/jql",
                    headers={
                        **self.headers,
                        "Accept": "application/json",
                        "Content-Type": "application/json",
                    },
                    json=body,
                    timeout=30.0,
                )
                resp.raise_for_status()
                data = resp.json()

            issues = []
            for issue_data in data.get("issues", []):
                fields = issue_data.get("fields", {}) or {}

                # Description (ADF -> text)
                description = ""
                adf = fields.get("description")
                if isinstance(adf, dict):
                    description = adf_to_text(adf)
                description = "\n".join(line.rstrip() for line in description.splitlines()).strip()

                # Components
                components = [c["name"] for c in (fields.get("components") or [])]

                # Sprint name from configured sprint field (last sprint if multiple)
                sprints = fields.get(settings.jira_sprint_field) or []
                sprint_name = sprints[-1]["name"] if isinstance(sprints, list) and sprints else "N/A"

                # First linked issue key
                first_linked_key = next(
                    (
                        (link.get("inwardIssue") or link.get("outwardIssue") or {}).get("key")
                        for link in (fields.get("issuelinks") or [])
                        if (link.get("inwardIssue") or link.get("outwardIssue"))
                    ),
                    None,
                )

                issues.append(
                    JiraIssue(
                        id=issue_data["id"],
                        key=issue_data["key"],
                        summary=fields.get("summary", ""),
                        description=description,
                        issue_type=(fields.get("issuetype") or {}).get("name", ""),
                        status=(fields.get("status") or {}).get("name", ""),
                        priority=(fields.get("priority") or {}).get("name", "Medium"),
                        assignee=(fields.get("assignee") or {}).get("displayName"),
                        reporter=(fields.get("reporter") or {}).get("displayName", ""),
                        created=fields.get("created", ""),
                        updated=fields.get("updated", ""),
                        components=components,
                        sprint=sprint_name,
                        first_linked_issue=first_linked_key,
                    )
                )

            # Optional total (bounded JQL only) via approximate-count
            total = None
            try:
                total = await self.get_issue_count(jql)
            except Exception as _:
                # keep going without total if the count endpoint rejects the JQL or fails
                total = None

            return {
                "issues": issues,
                "isLast": bool(data.get("isLast", True)),
                "nextPageToken": data.get("nextPageToken"),  # pass this back to fetch the next page
                "pageSize": max_results,
                "total": total,  # may be None by design
                "jql": jql,
            }

        except httpx.HTTPError as e:
            logger.error(f"HTTP error getting paginated test issues: {e}")
            return {
                "issues": [],
                "isLast": True,
                "nextPageToken": None,
                "pageSize": max_results,
                "total": None,
                "jql": jql if 'jql' in locals() else None,
            }
        except Exception as e:
            logger.error(f"Error getting paginated test issues: {e}")
            return {
                "issues": [],
                "isLast": True,
                "nextPageToken": None,
                "pageSize": max_results,
                "total": None,
            }

    # Create Test issue --------------------------------------

    def _build_issue_fields(
        self,
        project_key: str,
        summary: str,
        description: Optional[str] = None,
        components: Optional[List[str]] = None,
        custom_fields: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Build issue fields dictionary for Jira API.
        
        Args:
            project_key: Project key
            summary: Issue summary
            description: Issue description
            components: List of component names
            custom_fields: Additional custom fields
            
        Returns:
            Dictionary of issue fields
        Returns basic issue info plus link results.
        """
        fields: Dict[str, Any] = {
            "project": {"id": project_key},
            "summary": summary,
            "issuetype": {"name": "Test"},
        }

        if description is not None:
            if isinstance(description, dict) and description.get("type") == "doc":
                fields["description"] = description  # already ADF
            else:
                fields["description"] = text_to_adf(str(description))
                
        # Assign to default assignee if configured
        if getattr(self, "default_assignee_account_id", None):
            fields["assignee"] = {"accountId": self.default_assignee_account_id}

        if components:
            fields["components"] = [{"name": c} for c in components if c]

        if custom_fields:
            fields.update(custom_fields)

        return fields

    async def _link_related_issues(
        self,
        client: httpx.AsyncClient,
        issue_key: str,
        related_issues: List[str],
        link_type_name: str,
    ) -> Dict[str, Any]:
        """
        Link related issues to the newly created issue.
        
        Args:
            client: HTTP client
            issue_key: Key of the newly created issue
            related_issues: List of issue keys to link
            link_type_name: Type of link for related issues
            
        Returns:
            Dictionary with link results
        """
        result: Dict[str, Any] = {
            "links_created": 0,
            "link_errors": [],
        }

        for rel_key in related_issues:
            if not rel_key:
                continue
            try:
                link_payload = {
                    "type": {"name": link_type_name},
                    # Make the NEW issue the outward side; the existing is inward.
                    "outwardIssue": {"key": issue_key},
                    "inwardIssue": {"key": rel_key},
                }
                lr = await client.post(
                    f"{self.base_url}/rest/api/3/issueLink",
                    headers=self.headers,
                    json=link_payload,
                )
                lr.raise_for_status()
                result["links_created"] += 1
            except httpx.HTTPError as le:
                msg = getattr(le.response, "text", str(le))
                logger.error("Issue link to %s failed: %s", rel_key, msg)
                result["link_errors"].append({"related": rel_key, "error": msg})

        return result

    async def create_test_issue(
        self,
        project_key: str,
        summary: str,
        description: Optional[str] = None,
        components: Optional[List[str]] = None,
        related_issues: Optional[List[str]] = None,
        custom_fields: Optional[Dict[str, Any]] = None,
        link_type_name: Optional[str] = None,
        timeout: float = 30.0,
    ) -> Dict[str, Any]:
        """
        Create a Test-type issue in Jira.
        
        Args:
            project_key: Jira project key
            summary: Issue summary
            description: Issue description (optional)
            components: List of component names (optional)
            related_issues: List of issue keys to link (optional)
            custom_fields: Additional custom fields (optional)
            link_type_name: Type of link for related issues
            timeout: Request timeout
            
        Returns:
            Dictionary with issue details and link results
        """
        # Use defaults if not provided
        link_type_name = link_type_name or self.DEFAULT_LINK_TYPE
        timeout = timeout or self.DEFAULT_TIMEOUT
        
        # Build issue fields
        fields = self._build_issue_fields(
            project_key, summary, description, components, custom_fields
        )
        body = {"fields": fields}
        logger.debug("Creating Jira Test issue with body: %s", body)

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                # Create the issue
                r = await client.post(
                    f"{self.base_url}/rest/api/3/issue",
                    headers=self.headers,
                    json=body,
                )
                r.raise_for_status()
                data = r.json()
                
                result: Dict[str, Any] = {
                    "id": int(data["id"]),
                    "key": data["key"],
                    "self": data.get("self"),
                    "raw": data,
                    "links_created": 0,
                    "link_errors": [],
                }

                # Link to related issues if provided
                if related_issues:
                    link_result = await self._link_related_issues(
                        client, data["key"], related_issues, link_type_name
                    )
                    result.update(link_result)

                return result

        except httpx.HTTPStatusError as e:
            text = e.response.text if e.response is not None else str(e)
            logger.error("Jira create issue failed: %s", text)
            raise
        except Exception as e:
            logger.error("Error creating Jira test issue: %s", e)
            raise
    
    async def list_transitions(self, issue_id_or_key: str):
        """Get available transitions for an issue."""
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{self.base_url}/rest/api/3/issue/{issue_id_or_key}/transitions",
                headers=self.headers
            )
            r.raise_for_status()
            logger.debug(f"Listed transitions for issue {issue_id_or_key}")
            return r.json()["transitions"]

    async def _pick_transition(
            self,
            transitions: List[Dict[str, Any]],
            target: Union[str, Dict[str, Any]],
        ) -> Optional[Dict[str, Any]]:
            """
            Accepts either:
            - transition id: "831"
            - status/transition name: "To-do", "TO_DO", "Start Progress"
            - dict payloads: {"name": "To-do"} or {"toName": "In Progress"} etc.
            """
            logger.debug(f"Picking transition for issue with target {target}")
            # If dict, try common keys
            if isinstance(target, dict):
                target = target.get("transitionId") or target.get("id") or \
                        target.get("toName") or target.get("name") or \
                        target.get("to") or ""

            target_str = str(target).strip()
            if not target_str:
                return None

            # If they passed an id (all digits), match by id right away
            if target_str.isdigit():
                return next((t for t in transitions if str(t.get("id")) == target_str), None)

            # Otherwise, match by normalized names
            tgt = canonicalize_name(target_str)

            # 1) prefer matching the destination status name
            for t in transitions:
                to_name = t.get("to", {}).get("name", "")
                if canonicalize_name(to_name) == tgt:
                    return t

            # 2) match the transition action name itself
            for t in transitions:
                name = t.get("name", "")
                if canonicalize_name(name) == tgt:
                    return t

            # 3) partial contains as a last resort
            for t in transitions:
                if tgt in canonicalize_name(t.get("to", {}).get("name", "")) or tgt in canonicalize_name(t.get("name", "")):
                    return t

            return None

    async def transition_issue(
        self,
        issue_id_or_key: str,
        target: Union[str, Dict[str, Any]],
        extra_fields: Optional[Dict[str, Any]] = None,
    ) -> bool:
        transitions = await self.list_transitions(issue_id_or_key)
        match = await self._pick_transition(transitions, target)

        logger.info(f"Transitioning issue {issue_id_or_key} to {target}")
        if not match:
            available = [f"{t.get('name')} -> {t.get('to', {}).get('name')}" for t in transitions]
            raise RuntimeError(
                f"No available transition matches '{target}'. "
                f"Available: {available}"
            )

        payload: Dict[str, Any] = {"transition": {"id": match["id"]}}
        if extra_fields:
            payload["fields"] = extra_fields

        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{self.base_url}/rest/api/3/issue/{issue_id_or_key}/transitions",
                json=payload,
                headers=self.headers,
            )
            r.raise_for_status()
        return True

    def map_update_fields_to_jira_format(
        self,
        update_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Map update request fields to Jira API format.
        Handles field transformations like components, sprint, priority.
        
        Args:
            update_data: Raw update data from request
            
        Returns:
            Dictionary of fields in Jira API format
        """
        update_fields: Dict[str, Any] = {}
        
        if "summary" in update_data:
            update_fields["summary"] = update_data["summary"]
        
        if "description" in update_data:
            desc = update_data["description"]
            if isinstance(desc, str):
                update_fields["description"] = text_to_adf(desc)
            else:
                update_fields["description"] = desc
        
        if "component" in update_data:
            # Jira expects components as a list of objects
            update_fields["components"] = [{"name": update_data["component"]}]
        
        if "sprint" in update_data:
            # Use configured sprint field
            update_fields[settings.jira_sprint_field] = update_data["sprint"]
        
        if "priority" in update_data:
            update_fields["priority"] = {"name": update_data["priority"]}
        
        return update_fields
    
    async def update_issue(
        self,
        issue_id_or_key: str,
        update_fields: Dict[str, Any],
        timeout: float = 30.0
    ) -> bool:
        """
        Update a Jira issue with the provided fields.
        Handles status transitions separately from field updates.
        
        Args:
            issue_id_or_key: Issue ID or key
            update_fields: Fields to update in Jira API format
            timeout: Request timeout
            
        Returns:
            True if update successful
        """
        try:
            # Convert description to ADF if it's a string
            if "description" in update_fields and isinstance(update_fields["description"], str):
                update_fields["description"] = text_to_adf(update_fields["description"])
            
            # Handle status transitions separately
            if "status" in update_fields:
                await self.transition_issue(issue_id_or_key, update_fields["status"])
                logger.info(f"Transitioned issue {issue_id_or_key} to status {update_fields['status']}")
                update_fields.pop("status")
            
            # Only make PUT request if there are fields to update
            if not update_fields:
                return True
            
            body = {"fields": update_fields}
            logger.debug(f"Updating Jira issue {issue_id_or_key} with body: {body}")
            
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.put(
                    f"{self.base_url}/rest/api/3/issue/{issue_id_or_key}",
                    headers=self.headers,
                    json=body,
                )
                response.raise_for_status()
                return True
                
        except httpx.HTTPError as e:
            logger.error(f"HTTP error updating issue {issue_id_or_key}: {e}")
            if hasattr(e, 'response') and e.response:
                logger.error(f"Response content: {e.response.text}")
            raise
        except Exception as e:
            logger.error(f"Error updating issue {issue_id_or_key}: {e}")
            raise



    async def jira_health_check(self) -> Dict[str, Any]:
        """Call Jira support health check endpoint"""
        url = f"{self.base_url}/rest/supportHealthCheck/1.0/check/"
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.get(url, headers=self.headers)
                r.raise_for_status()
                return r.json() or {}
        except httpx.HTTPStatusError as e:
            text = e.response.text if e.response is not None else str(e)
            logger.error("Jira health check failed with status %s: %s", e.response.status_code if e.response else "?", text)
            raise
        except Exception as e:
            logger.error("Error calling Jira health check: %s", e)
            raise
    

        
# Create a singleton instance
jira_service = JiraService()


    