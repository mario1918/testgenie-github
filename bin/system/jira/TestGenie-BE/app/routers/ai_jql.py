"""
AI JQL Router
Endpoints for AI-powered natural language to JQL generation and search.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
import logging

from app.services.jira_service import jira_service
from app.services.ai_client import ai_client
from app.services.field_cache import field_cache

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ai/jql", tags=["ai-jql"])


# Request/Response Models

class GenerateJQLRequest(BaseModel):
    """Request body for JQL generation."""
    text: str = Field(..., description="Natural language query to convert to JQL", min_length=3)
    
    class Config:
        json_schema_extra = {
            "example": {
                "text": "Show open bugs in SE2 assigned to Ahmed"
            }
        }


class GenerateJQLResponse(BaseModel):
    """Response body for JQL generation."""
    generated_jql: str = Field(..., description="Generated JQL query string")
    error: Optional[str] = Field(None, description="Error message if generation failed")
    
    class Config:
        json_schema_extra = {
            "example": {
                "generated_jql": "project = SE2 AND type = Bug AND statusCategory != Done AND assignee = Ahmed"
            }
        }


class SearchJQLRequest(BaseModel):
    """Request body for JQL generation + search execution."""
    text: str = Field(..., description="Natural language query to convert to JQL", min_length=3)
    maxResults: int = Field(20, ge=1, le=100, description="Maximum number of results to return")
    
    class Config:
        json_schema_extra = {
            "example": {
                "text": "Show open bugs assigned to Ahmed",
                "maxResults": 20
            }
        }


class IssueResult(BaseModel):
    """Simplified issue result."""
    key: str
    summary: str
    status: Optional[str] = None
    assignee: Optional[str] = None
    priority: Optional[str] = None
    issueType: Optional[str] = None


class SearchJQLResponse(BaseModel):
    """Response body for JQL search."""
    generated_jql: str = Field(..., description="Generated JQL query string")
    issues: List[Dict[str, Any]] = Field(default_factory=list, description="List of matching issues")
    total: Optional[int] = Field(None, description="Total number of matching issues")
    error: Optional[str] = Field(None, description="Error message if search failed")
    jira_error: Optional[str] = Field(None, description="Jira-specific error if query was invalid")
    
    class Config:
        json_schema_extra = {
            "example": {
                "generated_jql": "project = SE2 AND type = Bug AND statusCategory != Done AND assignee = Ahmed",
                "issues": [
                    {
                        "key": "SE2-123",
                        "summary": "Login button not working on mobile",
                        "status": "In Progress",
                        "assignee": "Ahmed"
                    }
                ],
                "total": 1
            }
        }


class FieldsResponse(BaseModel):
    """Response body for available fields."""
    fields: List[Dict[str, str]] = Field(..., description="List of available Jira fields")
    count: int = Field(..., description="Number of fields")


class FieldSuggestionsRequest(BaseModel):
    """Request body for field value suggestions."""
    field_name: str = Field(..., description="Field name or ID")
    field_value: str = Field("", description="Partial value to filter suggestions")


class FieldSuggestionsResponse(BaseModel):
    """Response body for field value suggestions."""
    field_name: str
    suggestions: List[Dict[str, str]]


class AutocompleteSuggestionsRequest(BaseModel):
    """Request body for autocomplete suggestions."""
    query: str = Field(..., description="Partial natural language query", min_length=1)


class AutocompleteSuggestionsResponse(BaseModel):
    """Response body for autocomplete suggestions."""
    suggestions: List[str] = Field(..., description="List of suggested queries")


# Endpoints

@router.post(
    "/generate",
    response_model=GenerateJQLResponse,
    summary="Generate JQL from natural language",
    description="Convert plain English text into a valid Jira JQL query using AI"
)
async def generate_jql(request: GenerateJQLRequest):
    """
    Generate JQL from natural language text.
    
    Uses the NodeJS AI service to convert plain English into valid JQL.
    Provides available Jira fields to the AI for accurate query generation.
    
    Example:
        Input: "Show unresolved bugs assigned to Ahmed in the last 7 days"
        Output: "assignee = Ahmed AND type = Bug AND resolution = Unresolved AND updated >= -7d"
    """
    try:
        # Get available fields for context
        available_fields = await field_cache.get_available_fields_for_ai()
        
        # Call AI service to generate JQL
        result = await ai_client.generate_jql(
            text=request.text,
            available_fields=available_fields
        )
        
        if not result.get("success"):
            logger.warning(f"AI JQL generation failed: {result.get('error')}")
            return GenerateJQLResponse(
                generated_jql="",
                error=result.get("error", "Failed to generate JQL")
            )
        
        generated_jql = result.get("jql", "")
        
        if not generated_jql:
            return GenerateJQLResponse(
                generated_jql="",
                error="AI returned empty JQL"
            )
        
        logger.info(f"Generated JQL: {generated_jql}")
        return GenerateJQLResponse(generated_jql=generated_jql)
        
    except Exception as e:
        logger.exception(f"Error generating JQL: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate JQL: {str(e)}"
        )


@router.post(
    "/search",
    response_model=SearchJQLResponse,
    summary="Generate JQL and execute search",
    description="Convert plain English to JQL and execute the search against Jira"
)
async def generate_and_search(request: SearchJQLRequest):
    """
    Generate JQL from natural language and execute the search.
    
    Workflow:
    1. Convert plain English to JQL using AI
    2. Execute the JQL against Jira's new /search/jql endpoint
    3. Return generated JQL and search results
    
    If Jira rejects the query, returns the error along with the generated JQL.
    """
    try:
        # Get available fields for context
        available_fields = await field_cache.get_available_fields_for_ai()
        
        # Step 1: Generate JQL from text
        ai_result = await ai_client.generate_jql(
            text=request.text,
            available_fields=available_fields
        )
        
        if not ai_result.get("success"):
            error_msg = ai_result.get("error", "Failed to generate JQL")
            logger.warning(f"AI JQL generation failed: {error_msg}")
            return SearchJQLResponse(
                generated_jql="",
                issues=[],
                error=error_msg
            )
        
        generated_jql = ai_result.get("jql", "")
        
        if not generated_jql:
            return SearchJQLResponse(
                generated_jql="",
                issues=[],
                error="AI returned empty JQL"
            )
        
        logger.info(f"Generated JQL for search: {generated_jql}")
        
        # Step 2: Execute search using new Jira endpoint
        search_result = await jira_service.execute_jql_search(
            jql=generated_jql,
            max_results=request.maxResults
        )
        
        # Check for Jira errors
        if "jira_error" in search_result:
            logger.warning(f"Jira rejected JQL: {search_result['jira_error']}")
            return SearchJQLResponse(
                generated_jql=generated_jql,
                issues=[],
                total=0,
                error="Invalid JQL generated",
                jira_error=search_result["jira_error"]
            )
        
        return SearchJQLResponse(
            generated_jql=generated_jql,
            issues=search_result.get("issues", []),
            total=search_result.get("total")
        )
        
    except Exception as e:
        logger.exception(f"Error in generate and search: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to execute search: {str(e)}"
        )


@router.get(
    "/fields",
    response_model=FieldsResponse,
    summary="Get available Jira fields",
    description="Get list of available Jira fields for JQL queries"
)
async def get_available_fields(refresh: bool = False):
    """
    Get available Jira fields for JQL generation.
    
    Returns a list of fields that can be used in JQL queries,
    including both system fields and custom fields.
    
    Args:
        refresh: Force refresh the field cache
    """
    try:
        fields = await field_cache.get_available_fields_for_ai(force_refresh=refresh)
        return FieldsResponse(fields=fields, count=len(fields))
    except Exception as e:
        logger.exception(f"Error getting fields: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get fields: {str(e)}"
        )


@router.post(
    "/fields/suggestions",
    response_model=FieldSuggestionsResponse,
    summary="Get field value suggestions",
    description="Get autocomplete suggestions for a specific field's values"
)
async def get_field_suggestions(request: FieldSuggestionsRequest):
    """
    Get value suggestions for a specific Jira field.
    
    Useful for dropdown/select fields where users need to know valid values.
    
    Args:
        field_name: Field name or ID (e.g., "status", "customfield_10045")
        field_value: Optional partial value to filter suggestions
    """
    try:
        suggestions = await field_cache.get_field_suggestions(
            field_name=request.field_name,
            field_value=request.field_value
        )
        return FieldSuggestionsResponse(
            field_name=request.field_name,
            suggestions=suggestions
        )
    except Exception as e:
        logger.exception(f"Error getting field suggestions: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get suggestions: {str(e)}"
        )


@router.post(
    "/cache/clear",
    summary="Clear field cache",
    description="Clear the cached Jira field metadata"
)
async def clear_field_cache():
    """Clear the Jira field metadata cache."""
    try:
        field_cache.clear_cache()
        return {"success": True, "message": "Field cache cleared"}
    except Exception as e:
        logger.exception(f"Error clearing cache: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to clear cache: {str(e)}"
        )


class AutocompleteSuggestionsRequestV2(BaseModel):
    """Request body for autocomplete suggestions with project context."""
    query: str = Field(..., description="Partial natural language query", min_length=1)
    project_key: str = Field("SE2", description="Jira project key for context")


@router.post(
    "/suggestions",
    response_model=AutocompleteSuggestionsResponse,
    summary="Get autocomplete suggestions",
    description="Get dynamic autocomplete suggestions based on real Jira data"
)
async def get_autocomplete_suggestions(request: AutocompleteSuggestionsRequest):
    """
    Get autocomplete suggestions based on partial natural language input.
    
    Uses real Jira data (components, statuses, users) for dynamic suggestions.
    """
    try:
        query = request.query.lower().strip()
        suggestions = []
        
        # Issue types for suggestions
        issue_types = ["bugs", "tasks", "stories", "issues", "epics"]
        
        # Fetch real Jira data for dynamic suggestions
        components = []
        statuses = []
        users = []
        sprints = []
        
        try:
            # Get components from Jira
            comp_data = await jira_service.get_project_components("SE2")
            if comp_data:
                components = [c.get("name", "") for c in comp_data if c.get("name")]
        except Exception as e:
            logger.debug(f"Could not fetch components: {e}")
        
        try:
            # Get statuses - use common ones if API fails
            statuses = ["Open", "In Progress", "To Do", "In QA", "Done", "Closed", "Resolved", "Blocked"]
        except:
            pass
        
        # Common priorities
        priorities = ["Highest", "High", "Medium", "Low", "Lowest", "Critical", "Blocker"]
        
        # Generate suggestions based on query
        words = query.split()
        
        if len(query) < 2:
            # Return generic suggestions
            suggestions = [
                "Show all open bugs",
                "Show my assigned tasks",
                "Show issues in current sprint",
                "Show bugs created this week",
                "Show unresolved issues"
            ]
        else:
            # Check for component keyword
            if any(w in ["component", "comp", "team"] for w in words):
                for comp in components[:8]:
                    suggestions.append(f"Show bugs in component {comp}")
                    suggestions.append(f"Show issues in component {comp}")
            
            # Check for status keyword
            elif any(w in ["status", "state"] for w in words):
                for status in statuses[:8]:
                    suggestions.append(f"Show {status.lower()} issues")
                    suggestions.append(f"Show bugs with status {status}")
            
            # Check for priority keyword
            elif any(w in ["priority", "urgent", "critical", "high", "low"] for w in words):
                for priority in priorities[:6]:
                    suggestions.append(f"Show {priority.lower()} priority bugs")
                    suggestions.append(f"Show issues with priority {priority}")
            
            # Check for assignee keyword
            elif any(w in ["assigned", "assignee", "to", "by"] for w in words):
                suggestions.extend([
                    "Show issues assigned to me",
                    "Show bugs assigned to me",
                    "Show unassigned issues",
                    "Show issues without assignee"
                ])
            
            # Check for time-based keyword
            elif any(w in ["today", "week", "yesterday", "recent", "last", "created", "updated"] for w in words):
                suggestions.extend([
                    "Show issues created today",
                    "Show bugs created this week",
                    "Show issues updated in last 7 days",
                    "Show recently resolved issues",
                    "Show issues created yesterday"
                ])
            
            # Check for sprint keyword
            elif any(w in ["sprint", "iteration", "current"] for w in words):
                suggestions.extend([
                    "Show issues in current sprint",
                    "Show bugs in active sprint",
                    "Show unresolved issues in sprint"
                ])
            
            # Default: match templates with issue types
            else:
                templates = [
                    "Show all {type}",
                    "Show open {type}",
                    "Show {type} assigned to me",
                    "Show {type} in current sprint",
                    "Show unresolved {type}",
                    "Show {type} created this week",
                    "Show high priority {type}",
                    "Show {type} without assignee",
                    "Show blocked {type}",
                    "Show my open {type}",
                ]
                
                for template in templates:
                    for issue_type in issue_types:
                        suggestion = template.format(type=issue_type)
                        suggestion_lower = suggestion.lower()
                        
                        # Check if query matches suggestion
                        if query in suggestion_lower or all(word in suggestion_lower for word in words):
                            if suggestion not in suggestions:
                                suggestions.append(suggestion)
                
                # Also add component suggestions if we have components
                if components and any(w in ["show", "bugs", "issues"] for w in words):
                    for comp in components[:3]:
                        suggestions.append(f"Show bugs in component {comp}")
        
        # Deduplicate and limit
        seen = set()
        unique_suggestions = []
        for s in suggestions:
            if s.lower() not in seen:
                seen.add(s.lower())
                unique_suggestions.append(s)
        
        return AutocompleteSuggestionsResponse(suggestions=unique_suggestions[:10])
        
    except Exception as e:
        logger.exception(f"Error getting autocomplete suggestions: {e}")
        return AutocompleteSuggestionsResponse(suggestions=[])
