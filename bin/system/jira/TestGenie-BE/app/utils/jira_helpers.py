"""
Jira utility functions for text processing, JQL building, and data transformation.
"""
from typing import List, Optional
import re
from urllib.parse import quote


def parse_csv(value: Optional[str]) -> List[str]:
    """
    Split comma-separated input into a clean list (strip, drop empties).
    
    Args:
        value: Comma-separated string or None
        
    Returns:
        List of stripped non-empty strings
    """
    if not value:
        return []
    return [v.strip() for v in value.split(",") if v and v.strip()]


def quote_jql_value(val: str) -> str:
    """
    Escape a value for safe use in JQL queries.
    
    Args:
        val: String value to escape
        
    Returns:
        Escaped string safe for JQL
    """
    # Basic safety: escape inner quotes; strip dangerous semicolons
    return val.replace('"', r'\"').replace(";", "")


def is_numeric_id(s: str) -> bool:
    """
    Check if a string represents a numeric ID.
    
    Args:
        s: String to check
        
    Returns:
        True if string is a valid integer
    """
    try:
        int(s)
        return True
    except (ValueError, TypeError):
        return False


def jql_quote_list(values: List[str]) -> str:
    """
    Return a JQL-ready quoted list: "A","B","C".
    
    Args:
        values: List of values to quote
        
    Returns:
        Comma-separated quoted values for JQL IN clause
    """
    return ",".join([f'"{quote_jql_value(v)}"' for v in values])


def build_assignee_or_reporter_filter(
    field: str,
    csv_value: Optional[str],
    include_current_user: Optional[bool]
) -> Optional[str]:
    """
    Build a JQL clause for assignee/reporter from a CSV list plus optional currentUser().
    Supports "Unassigned" to mean IS EMPTY, combining with others via OR.
    
    Args:
        field: Field name ("assignee" or "reporter")
        csv_value: Comma-separated list of names (supports "Unassigned")
        include_current_user: Whether to include currentUser() in the filter
        
    Returns:
        JQL filter clause or None if no filters apply
        
    Examples:
        field = "assignee"
        csv_value = "Alice, Bob, Unassigned"
        include_current_user = True
        
        Result:
        (assignee IN ("Alice","Bob") OR assignee = currentUser() OR assignee IS EMPTY)
    """
    names = parse_csv(csv_value)
    
    has_unassigned = any(n.lower() == "unassigned" for n in names)
    names = [n for n in names if n and n.lower() != "unassigned"]
    
    parts: List[str] = []
    
    # IN ("A","B") when multiple; use '=' when single for simpler JQL
    if names:
        if len(names) == 1:
            parts.append(f'{field} = "{quote_jql_value(names[0])}"')
        else:
            parts.append(f'{field} IN ({jql_quote_list(names)})')
    
    # currentUser()
    if include_current_user is True:
        parts.append(f"{field} = currentUser()")
    
    # Unassigned
    if has_unassigned:
        parts.append(f"{field} IS EMPTY")
    
    if not parts:
        return None
    if len(parts) == 1:
        return parts[0]
    return "(" + " OR ".join(parts) + ")"


def build_test_case_jql_filter(
    project_key: str,
    search: Optional[str] = None,
    component: Optional[str] = None,
    sprint: Optional[str] = None,
    status: Optional[str] = None,
    issue_type: Optional[str] = None,
    assignee: Optional[str] = None,
    assignee_current_user: Optional[bool] = None,
    reporter: Optional[str] = None,
    reporter_current_user: Optional[bool] = None,
    issue_links: Optional[List[str]] = None,
    additional_jql: Optional[str] = None,
) -> str:
    """
    Build a comprehensive JQL filter for test case queries.
    
    Args:
        project_key: Jira project key
        search: Search term for summary/description
        component: Component name filter
        sprint: Sprint ID or name filter
        status: Status name filter
        issue_type: Issue type filter
        assignee: Comma-separated assignee names
        assignee_current_user: Include current user as assignee
        reporter: Comma-separated reporter names
        reporter_current_user: Include current user as reporter
        issue_links: List of issue keys to filter by links
        additional_jql: Additional JQL to append
        
    Returns:
        Complete JQL query string
    """
    filters: List[str] = []
    
    # Project anchor
    if project_key:
        filters.append(f'project = "{quote_jql_value(project_key)}"')
    
    # Search in summary/description
    if search and search.strip():
        s = quote_jql_value(search.strip())
        filters.append(f'(summary ~ "{s}" OR description ~ "{s}")')
    
    # Component
    if component and component.strip() and component != "All Components":
        filters.append(f'component = "{quote_jql_value(component.strip())}"')
    
    # Sprint: id (no quotes) or name (quoted)
    if sprint and sprint.strip() and sprint != "All Sprints":
        s = sprint.strip()
        if is_numeric_id(s):
            filters.append(f"Sprint = {s}")
        else:
            filters.append(f'Sprint = "{quote_jql_value(s)}"')
    
    # Status
    if status and status.strip() and status != "All Statuses":
        filters.append(f'status = "{quote_jql_value(status.strip())}"')
    
    # Issue Type
    if issue_type and issue_type.strip():
        filters.append(f'issuetype = "{quote_jql_value(issue_type.strip())}"')
    
    # Assignee (CSV + current user + Unassigned)
    assignee_clause = build_assignee_or_reporter_filter(
        field="assignee",
        csv_value=assignee,
        include_current_user=assignee_current_user
    )
    if assignee_clause:
        filters.append(assignee_clause)
    
    # Reporter (CSV + current user + Unassigned)
    reporter_clause = build_assignee_or_reporter_filter(
        field="reporter",
        csv_value=reporter,
        include_current_user=reporter_current_user
    )
    if reporter_clause:
        filters.append(reporter_clause)
    
    # Linked issues — use linkedIssues()
    if issue_links:
        keys = [k.strip().upper() for k in issue_links if k and k.strip()]
        if keys:
            li = ' OR '.join([f'issue IN linkedIssues("{quote_jql_value(k)}")' for k in keys])
            filters.append(f'({li})')
    
    combined_filter = " AND ".join(filters) if filters else ""
    
    # Merge with user-provided JQL
    if additional_jql and additional_jql.strip():
        jf = additional_jql.strip()
        combined_filter = f'({jf})' if not combined_filter else f'({jf}) AND ({combined_filter})'
    
    return combined_filter


def canonicalize_name(s: str) -> str:
    """
    Canonicalize a name for comparison (lowercase, normalize spaces/dashes).
    
    Args:
        s: String to canonicalize
        
    Returns:
        Normalized string for comparison
    """
    s = s.strip().lower().replace("_", " ").replace("-", " ")
    s = re.sub(r"\s+", " ", s)
    return s
