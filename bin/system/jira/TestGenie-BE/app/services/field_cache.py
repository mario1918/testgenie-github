"""
Jira Field Cache Service
Fetches and caches Jira field metadata for AI JQL generation.
"""

import httpx
import base64
import logging
import asyncio
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta

from app.core.config import settings

logger = logging.getLogger(__name__)


class JiraFieldCache:
    """
    Caches Jira field metadata to provide accurate field information
    for AI-powered JQL generation.
    """
    
    DEFAULT_TIMEOUT = 30.0
    CACHE_TTL_MINUTES = 60  # Cache expires after 60 minutes
    
    def __init__(self):
        """Initialize field cache with Jira configuration."""
        self.base_url = settings.jira_base_url.rstrip('/')
        self.username = settings.jira_username
        self.api_token = settings.jira_api_token
        
        self.headers = self._create_auth_headers()
        
        # Cache storage
        self._fields_cache: Optional[List[Dict[str, Any]]] = None
        self._autocomplete_cache: Optional[Dict[str, Any]] = None
        self._cache_timestamp: Optional[datetime] = None
        self._lock = asyncio.Lock()
    
    def _create_auth_headers(self) -> Dict[str, str]:
        """Create authentication headers for Jira API."""
        credentials = f"{self.username}:{self.api_token}"
        encoded_credentials = base64.b64encode(credentials.encode()).decode()
        return {
            "Authorization": f"Basic {encoded_credentials}",
            "Accept": "application/json",
            "Content-Type": "application/json"
        }
    
    def _is_cache_valid(self) -> bool:
        """Check if the cache is still valid."""
        if self._cache_timestamp is None or self._fields_cache is None:
            return False
        return datetime.now() - self._cache_timestamp < timedelta(minutes=self.CACHE_TTL_MINUTES)
    
    async def get_all_fields(self, force_refresh: bool = False) -> List[Dict[str, Any]]:
        """
        Get all Jira fields, using cache if available.
        
        GET /rest/api/3/field
        
        Args:
            force_refresh: Force refresh the cache
            
        Returns:
            List of field dictionaries with id, name, custom, schema info
        """
        async with self._lock:
            if not force_refresh and self._is_cache_valid():
                return self._fields_cache
            
            try:
                async with httpx.AsyncClient(timeout=self.DEFAULT_TIMEOUT) as client:
                    response = await client.get(
                        f"{self.base_url}/rest/api/3/field",
                        headers=self.headers
                    )
                    response.raise_for_status()
                    fields = response.json()
                    
                    self._fields_cache = fields
                    self._cache_timestamp = datetime.now()
                    
                    logger.info(f"Cached {len(fields)} Jira fields")
                    return fields
                    
            except httpx.HTTPError as e:
                logger.error(f"Failed to fetch Jira fields: {e}")
                # Return cached data if available, even if expired
                if self._fields_cache:
                    logger.warning("Returning stale cached fields")
                    return self._fields_cache
                raise
    
    async def get_autocomplete_data(self, force_refresh: bool = False) -> Dict[str, Any]:
        """
        Get JQL autocomplete metadata.
        
        GET /rest/api/2/jql/autocompletedata
        
        Args:
            force_refresh: Force refresh the cache
            
        Returns:
            Autocomplete data including visible field names and functions
        """
        async with self._lock:
            if not force_refresh and self._is_cache_valid() and self._autocomplete_cache:
                return self._autocomplete_cache
            
            try:
                async with httpx.AsyncClient(timeout=self.DEFAULT_TIMEOUT) as client:
                    response = await client.get(
                        f"{self.base_url}/rest/api/2/jql/autocompletedata",
                        headers=self.headers
                    )
                    response.raise_for_status()
                    data = response.json()
                    
                    self._autocomplete_cache = data
                    if self._cache_timestamp is None:
                        self._cache_timestamp = datetime.now()
                    
                    logger.info("Cached JQL autocomplete data")
                    return data
                    
            except httpx.HTTPError as e:
                logger.error(f"Failed to fetch autocomplete data: {e}")
                if self._autocomplete_cache:
                    logger.warning("Returning stale cached autocomplete data")
                    return self._autocomplete_cache
                raise
    
    async def get_field_suggestions(
        self,
        field_name: str,
        field_value: str = "",
        timeout: float = DEFAULT_TIMEOUT
    ) -> List[Dict[str, str]]:
        """
        Get value suggestions for a specific field.
        
        GET /rest/api/2/jql/autocompletedata/suggestions
        
        Args:
            field_name: Field name or ID (e.g., "customfield_10045" or "status")
            field_value: Partial value to filter suggestions
            timeout: Request timeout
            
        Returns:
            List of suggestion dictionaries with value and displayName
        """
        try:
            params = {"fieldName": field_name}
            if field_value:
                params["fieldValue"] = field_value
            
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.get(
                    f"{self.base_url}/rest/api/2/jql/autocompletedata/suggestions",
                    headers=self.headers,
                    params=params
                )
                response.raise_for_status()
                data = response.json()
                
                results = data.get("results", [])
                return [
                    {
                        "value": r.get("value", ""),
                        "displayName": r.get("displayName", r.get("value", ""))
                    }
                    for r in results
                ]
                
        except httpx.HTTPError as e:
            logger.error(f"Failed to get suggestions for field {field_name}: {e}")
            return []
    
    async def get_available_fields_for_ai(self, force_refresh: bool = False) -> List[Dict[str, str]]:
        """
        Get a clean list of visible fields suitable for AI JQL generation.
        
        Returns:
            List of dictionaries with 'id' and 'name' for each field
        """
        try:
            # Fetch both field list and autocomplete data
            fields_task = self.get_all_fields(force_refresh)
            autocomplete_task = self.get_autocomplete_data(force_refresh)
            
            fields, autocomplete = await asyncio.gather(fields_task, autocomplete_task)
            
            # Get visible field names from autocomplete data
            visible_field_names = set()
            for vf in autocomplete.get("visibleFieldNames", []):
                visible_field_names.add(vf.get("value", "").lower())
                visible_field_names.add(vf.get("displayName", "").lower())
            
            # Build clean field list
            result = []
            seen_names = set()
            
            for field in fields:
                field_id = field.get("id", "")
                field_name = field.get("name", "")
                is_custom = field.get("custom", False)
                
                # Skip system fields that aren't typically used in JQL
                if not field_name or field_name.lower() in seen_names:
                    continue
                
                # Include custom fields and common system fields
                if is_custom or field_name.lower() in visible_field_names:
                    result.append({
                        "id": field_id,
                        "name": field_name
                    })
                    seen_names.add(field_name.lower())
            
            # Always include common JQL fields
            common_fields = [
                {"id": "project", "name": "Project"},
                {"id": "issuetype", "name": "Issue Type"},
                {"id": "status", "name": "Status"},
                {"id": "statusCategory", "name": "Status Category"},
                {"id": "resolution", "name": "Resolution"},
                {"id": "assignee", "name": "Assignee"},
                {"id": "reporter", "name": "Reporter"},
                {"id": "priority", "name": "Priority"},
                {"id": "created", "name": "Created"},
                {"id": "updated", "name": "Updated"},
                {"id": "resolved", "name": "Resolved"},
                {"id": "labels", "name": "Labels"},
                {"id": "component", "name": "Component"},
                {"id": "fixVersion", "name": "Fix Version"},
                {"id": "affectedVersion", "name": "Affected Version"},
                {"id": "sprint", "name": "Sprint"},
                {"id": "parent", "name": "Parent"},
                {"id": "summary", "name": "Summary"},
                {"id": "description", "name": "Description"},
            ]
            
            for cf in common_fields:
                if cf["name"].lower() not in seen_names:
                    result.append(cf)
                    seen_names.add(cf["name"].lower())
            
            logger.info(f"Prepared {len(result)} fields for AI JQL generation")
            return result
            
        except Exception as e:
            logger.error(f"Error preparing fields for AI: {e}")
            # Return minimal field list as fallback
            return [
                {"id": "project", "name": "Project"},
                {"id": "issuetype", "name": "Issue Type"},
                {"id": "status", "name": "Status"},
                {"id": "assignee", "name": "Assignee"},
                {"id": "priority", "name": "Priority"},
            ]
    
    def clear_cache(self):
        """Clear all cached data."""
        self._fields_cache = None
        self._autocomplete_cache = None
        self._cache_timestamp = None
        logger.info("Field cache cleared")


# Global singleton instance
field_cache = JiraFieldCache()
