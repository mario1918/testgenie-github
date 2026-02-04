"""
Retry Utility Module
Provides robust retry mechanisms for handling network and API failures.
"""

import asyncio
import logging
from typing import Any, Callable, List, Type, Union
from functools import wraps
import httpx
import socket

logger = logging.getLogger(__name__)


class RetryConfig:
    """Configuration for retry behavior."""
    
    def __init__(
        self,
        max_attempts: int = 3,
        base_delay: float = 1.0,
        max_delay: float = 60.0,
        exponential_base: float = 2.0,
        jitter: bool = True
    ):
        self.max_attempts = max_attempts
        self.base_delay = base_delay
        self.max_delay = max_delay
        self.exponential_base = exponential_base
        self.jitter = jitter


# Network-related exceptions that should trigger retries
RETRYABLE_EXCEPTIONS = (
    httpx.ConnectError,
    httpx.TimeoutException,
    httpx.NetworkError,
    socket.gaierror,  # DNS resolution errors like "getaddrinfo failed"
    OSError,  # General network errors
    ConnectionError,
    ConnectionResetError,
    ConnectionRefusedError,
)

# HTTP status codes that should trigger retries
RETRYABLE_STATUS_CODES = {
    408,  # Request Timeout
    429,  # Too Many Requests
    500,  # Internal Server Error
    502,  # Bad Gateway
    503,  # Service Unavailable
    504,  # Gateway Timeout
}


def calculate_delay(attempt: int, config: RetryConfig) -> float:
    """Calculate delay for exponential backoff with jitter."""
    delay = config.base_delay * (config.exponential_base ** (attempt - 1))
    delay = min(delay, config.max_delay)
    
    if config.jitter:
        # Add random jitter (±25% of delay)
        import random
        jitter_range = delay * 0.25
        delay += random.uniform(-jitter_range, jitter_range)
        delay = max(0, delay)  # Ensure delay is not negative
    
    return delay


def is_retryable_exception(exception: Exception) -> bool:
    """Check if an exception should trigger a retry."""
    if isinstance(exception, RETRYABLE_EXCEPTIONS):
        return True
    
    if isinstance(exception, httpx.HTTPStatusError):
        return exception.response.status_code in RETRYABLE_STATUS_CODES
    
    # Check for specific error messages
    error_msg = str(exception).lower()
    retryable_messages = [
        "getaddrinfo failed",
        "connection reset",
        "connection refused",
        "timeout",
        "network is unreachable",
        "temporary failure in name resolution"
    ]
    
    return any(msg in error_msg for msg in retryable_messages)


async def async_retry(
    func: Callable,
    config: RetryConfig = None,
    *args,
    **kwargs
) -> Any:
    """
    Async retry wrapper for functions.
    
    Args:
        func: The async function to retry
        config: Retry configuration
        *args, **kwargs: Arguments to pass to the function
        
    Returns:
        The result of the function call
        
    Raises:
        The last exception if all retries fail
    """
    if config is None:
        config = RetryConfig()
    
    last_exception = None
    
    for attempt in range(1, config.max_attempts + 1):
        try:
            logger.debug(f"Attempt {attempt}/{config.max_attempts} for {func.__name__}")
            result = await func(*args, **kwargs)
            
            if attempt > 1:
                logger.info(f"Success on attempt {attempt}/{config.max_attempts} for {func.__name__}")
            
            return result
            
        except Exception as e:
            last_exception = e
            
            if not is_retryable_exception(e):
                logger.warning(f"Non-retryable exception in {func.__name__}: {e}")
                raise
            
            if attempt == config.max_attempts:
                logger.error(f"All {config.max_attempts} attempts failed for {func.__name__}: {e}")
                raise
            
            delay = calculate_delay(attempt, config)
            logger.warning(
                f"Attempt {attempt}/{config.max_attempts} failed for {func.__name__}: {e}. "
                f"Retrying in {delay:.2f} seconds..."
            )
            
            await asyncio.sleep(delay)
    
    # This should never be reached, but just in case
    if last_exception:
        raise last_exception


def retry_on_network_error(
    max_attempts: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 60.0,
    exponential_base: float = 2.0,
    jitter: bool = True
):
    """
    Decorator for adding retry logic to async functions.
    
    Args:
        max_attempts: Maximum number of retry attempts
        base_delay: Base delay between retries in seconds
        max_delay: Maximum delay between retries in seconds
        exponential_base: Base for exponential backoff
        jitter: Whether to add random jitter to delays
    """
    config = RetryConfig(max_attempts, base_delay, max_delay, exponential_base, jitter)
    
    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            return await async_retry(func, config, *args, **kwargs)
        return wrapper
    
    return decorator

