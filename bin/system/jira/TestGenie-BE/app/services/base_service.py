"""
Base Service Class
Provides common functionality for all API services.
"""

import httpx
import logging
from typing import Optional
from abc import ABC


class BaseAPIService(ABC):
    """
    Abstract base class for API services.
    Provides common HTTP client management and configuration.
    """
    
    # Class-level constants
    DEFAULT_TIMEOUT = 30.0
    MAX_RETRIES = 3
    
    def __init__(self, base_url: str, headers: dict):
        """
        Initialize base service.
        
        Args:
            base_url: API base URL
            headers: Default headers for requests
        """
        self.base_url = base_url.rstrip('/')
        self.headers = headers
        self.logger = logging.getLogger(self.__class__.__name__)
        self._client: Optional[httpx.AsyncClient] = None
    
    async def get_client(self) -> httpx.AsyncClient:
        """
        Get or create HTTP client (reusable connection pool).
        
        Returns:
            Configured async HTTP client
        """
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=self.DEFAULT_TIMEOUT,
                headers=self.headers,
                follow_redirects=True
            )
        return self._client
    
    async def close(self):
        """Close HTTP client and cleanup resources."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None
    
    async def __aenter__(self):
        """Async context manager entry."""
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        await self.close()
    
    def _log_request(self, method: str, url: str, **kwargs):
        """Log outgoing request."""
        self.logger.debug(f"{method} {url}")
    
    def _log_response(self, response: httpx.Response):
        """Log response."""
        self.logger.debug(
            f"Response [{response.status_code}] from {response.url}"
        )
    
    def _log_error(self, error: Exception, context: str):
        """Log error with context."""
        self.logger.error(f"{context}: {str(error)}")
