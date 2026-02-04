"""
AI Client Service
Communicates with the NodeJS AI service for JQL generation.
"""

import httpx
import logging
from typing import Optional, List, Dict, Any

from app.core.config import settings

logger = logging.getLogger(__name__)


class AIClient:
    """
    Client for communicating with the NodeJS AI service.
    Handles JQL generation from natural language text.
    """
    
    DEFAULT_TIMEOUT = 30.0
    
    def __init__(self):
        """Initialize AI client with configuration from settings."""
        self.base_url = settings.ai_service_url.rstrip('/')
        self._client: Optional[httpx.AsyncClient] = None
    
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create reusable HTTP client."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=self.DEFAULT_TIMEOUT,
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                }
            )
        return self._client
    
    async def close(self):
        """Close HTTP client and cleanup resources."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None
    
    async def generate_jql(
        self,
        text: str,
        available_fields: Optional[List[Dict[str, str]]] = None,
        timeout: float = DEFAULT_TIMEOUT
    ) -> Dict[str, Any]:
        """
        Generate JQL from natural language text using the Node AI service.
        
        Args:
            text: Natural language query (e.g., "Show open bugs assigned to Ahmed")
            available_fields: Optional list of available Jira fields with id and name
            timeout: Request timeout in seconds
            
        Returns:
            Dict containing:
                - jql: Generated JQL string
                - error: Error message if generation failed (optional)
                
        Raises:
            httpx.HTTPError: For transport/HTTP errors
        """
        url = f"{self.base_url}/api/generate-jql"
        
        payload = {
            "text": text
        }
        
        if available_fields:
            payload["available_fields"] = available_fields
        
        try:
            client = await self._get_client()
            response = await client.post(
                url,
                json=payload,
                timeout=timeout
            )
            response.raise_for_status()
            data = response.json()
            
            logger.info(f"AI generated JQL for text: '{text[:50]}...' -> '{data.get('jql', '')[:100]}'")
            
            return {
                "jql": data.get("jql", ""),
                "success": True
            }
            
        except httpx.HTTPStatusError as e:
            error_detail = ""
            try:
                error_data = e.response.json()
                error_detail = error_data.get("error", "") or error_data.get("message", "")
            except Exception:
                error_detail = e.response.text[:200] if e.response.text else str(e)
            
            logger.error(f"AI service HTTP error: {e.response.status_code} - {error_detail}")
            return {
                "jql": "",
                "success": False,
                "error": f"AI service error: {error_detail}"
            }
            
        except httpx.RequestError as e:
            logger.error(f"AI service connection error: {e}")
            return {
                "jql": "",
                "success": False,
                "error": f"Cannot connect to AI service: {str(e)}"
            }
        except Exception as e:
            logger.error(f"Unexpected error calling AI service: {e}")
            return {
                "jql": "",
                "success": False,
                "error": f"Unexpected error: {str(e)}"
            }


# Global singleton instance
ai_client = AIClient()
