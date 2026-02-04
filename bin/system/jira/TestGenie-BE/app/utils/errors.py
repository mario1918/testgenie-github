"""
Error Handling Utilities
Provides consistent error handling across the application with user-friendly messages.
"""

from typing import Optional, Dict, Any
from pydantic import BaseModel
from enum import Enum
import logging

logger = logging.getLogger(__name__)


class ErrorCode(str, Enum):
    """Standardized error codes for programmatic handling."""
    
    # Client errors (4xx)
    INVALID_INPUT = "INVALID_INPUT"
    MISSING_REQUIRED_FIELD = "MISSING_REQUIRED_FIELD"
    INVALID_FORMAT = "INVALID_FORMAT"
    NOT_FOUND = "NOT_FOUND"
    UNAUTHORIZED = "UNAUTHORIZED"
    FORBIDDEN = "FORBIDDEN"
    CONFLICT = "CONFLICT"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    
    # External service errors (5xx)
    JIRA_UNAVAILABLE = "JIRA_UNAVAILABLE"
    JIRA_AUTH_FAILED = "JIRA_AUTH_FAILED"
    JIRA_PERMISSION_DENIED = "JIRA_PERMISSION_DENIED"
    ZEPHYR_UNAVAILABLE = "ZEPHYR_UNAVAILABLE"
    ZEPHYR_AUTH_FAILED = "ZEPHYR_AUTH_FAILED"
    EXTERNAL_SERVICE_ERROR = "EXTERNAL_SERVICE_ERROR"
    
    # Internal errors (5xx)
    INTERNAL_ERROR = "INTERNAL_ERROR"
    DATABASE_ERROR = "DATABASE_ERROR"
    CONFIGURATION_ERROR = "CONFIGURATION_ERROR"


class ErrorResponse(BaseModel):
    """Standardized error response format."""
    
    error: str  # User-friendly error message
    code: ErrorCode  # Error code for programmatic handling
    details: Optional[str] = None  # Additional context
    suggestion: Optional[str] = None  # What user can do to resolve
    
    class Config:
        use_enum_values = True


# Custom Exception Classes
class BaseAPIException(Exception):
    """Base exception for all API errors."""
    
    def __init__(
        self,
        message: str,
        code: ErrorCode,
        status_code: int = 500,
        details: Optional[str] = None,
        suggestion: Optional[str] = None
    ):
        self.message = message
        self.code = code
        self.status_code = status_code
        self.details = details
        self.suggestion = suggestion
        super().__init__(message)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert exception to dictionary for HTTP response."""
        return {
            "error": self.message,
            "code": self.code.value,
            "details": self.details,
            "suggestion": self.suggestion
        }


# Error Message Templates
class ErrorMessages:
    """User-friendly error message templates."""
    
    # General messages
    INTERNAL_ERROR = "An unexpected error occurred. Please try again."
    INVALID_INPUT = "The provided input is invalid."
    MISSING_FIELD = "A required field is missing."
    
    # Jira messages
    JIRA_CONNECTION_FAILED = "Unable to connect to Jira."
    JIRA_AUTH_FAILED = "Jira authentication failed."
    JIRA_PROJECT_NOT_FOUND = "The specified Jira project was not found."
    JIRA_ISSUE_NOT_FOUND = "The specified Jira issue was not found."
    JIRA_PERMISSION_DENIED = "You don't have permission to access this Jira resource."
    
    # Zephyr messages
    ZEPHYR_CONNECTION_FAILED = "Unable to connect to Zephyr."
    ZEPHYR_AUTH_FAILED = "Zephyr authentication failed."
    ZEPHYR_TEST_CASE_NOT_FOUND = "The specified test case was not found."
    ZEPHYR_CYCLE_NOT_FOUND = "The specified test cycle was not found."
    
    # Test case messages
    TEST_CASE_CREATION_FAILED = "Failed to create test case."
    TEST_EXECUTION_FAILED = "Failed to execute test case."
    INVALID_TEST_STEPS = "Test case steps are invalid or missing."


def create_user_friendly_error(
    error_type: str,
    original_error: Exception,
    context: Optional[str] = None
) -> Dict[str, Any]:
    """
    Create a user-friendly error response from an exception.
    
    Args:
        error_type: Type of error (e.g., 'jira_connection', 'validation')
        original_error: The original exception
        context: Additional context about what was being done
        
    Returns:
        Dictionary with user-friendly error information
    """
    error_str = str(original_error).lower()
    
    # Jira errors
    if error_type == "jira_connection":
        if "401" in error_str or "unauthorized" in error_str:
            return {
                "error": ErrorMessages.JIRA_AUTH_FAILED,
                "code": ErrorCode.JIRA_AUTH_FAILED,
                "suggestion": "Please check your Jira credentials and permissions."
            }
        elif "403" in error_str or "forbidden" in error_str:
            return {
                "error": ErrorMessages.JIRA_PERMISSION_DENIED,
                "code": ErrorCode.JIRA_PERMISSION_DENIED,
                "suggestion": "Please contact your Jira administrator for access."
            }
        elif "404" in error_str or "not found" in error_str:
            return {
                "error": ErrorMessages.JIRA_PROJECT_NOT_FOUND if context == "project" else ErrorMessages.JIRA_ISSUE_NOT_FOUND,
                "code": ErrorCode.NOT_FOUND,
                "suggestion": f"Please check the {context or 'resource'} identifier and try again."
            }
        else:
            return {
                "error": ErrorMessages.JIRA_CONNECTION_FAILED,
                "code": ErrorCode.JIRA_UNAVAILABLE,
                "suggestion": "Please check your Jira connection settings and try again."
            }
    
    # Zephyr errors
    elif error_type == "zephyr_connection":
        if "401" in error_str or "unauthorized" in error_str:
            return {
                "error": ErrorMessages.ZEPHYR_AUTH_FAILED,
                "code": ErrorCode.ZEPHYR_AUTH_FAILED,
                "suggestion": "Please check your Zephyr API credentials."
            }
        elif "404" in error_str or "not found" in error_str:
            return {
                "error": ErrorMessages.ZEPHYR_TEST_CASE_NOT_FOUND if context == "test_case" else ErrorMessages.ZEPHYR_CYCLE_NOT_FOUND,
                "code": ErrorCode.NOT_FOUND,
                "suggestion": f"Please check the {context or 'resource'} identifier and try again."
            }
        else:
            return {
                "error": ErrorMessages.ZEPHYR_CONNECTION_FAILED,
                "code": ErrorCode.ZEPHYR_UNAVAILABLE,
                "suggestion": "Please check your Zephyr connection settings and try again."
            }
    
    # Validation errors
    elif error_type == "validation":
        return {
            "error": ErrorMessages.INVALID_INPUT,
            "code": ErrorCode.VALIDATION_ERROR,
            "details": str(original_error),
            "suggestion": "Please check your input and try again."
        }
    
    # Default fallback
    else:
        logger.error(f"Unhandled error type '{error_type}': {original_error}")
        return {
            "error": ErrorMessages.INTERNAL_ERROR,
            "code": ErrorCode.INTERNAL_ERROR,
            "suggestion": "Please try again. If the problem persists, contact support."
        }


def log_error(
    error: Exception,
    context: str,
    user_id: Optional[str] = None,
    additional_data: Optional[Dict[str, Any]] = None
):
    """
    Log error with consistent format and context.
    
    Args:
        error: The exception that occurred
        context: Description of what was being done when error occurred
        user_id: Optional user identifier
        additional_data: Optional additional data to log
    """
    log_data = {
        "context": context,
        "error_type": type(error).__name__,
        "error_message": str(error),
    }
    
    if user_id:
        log_data["user_id"] = user_id
    
    if additional_data:
        log_data.update(additional_data)
    
    logger.error(f"Error in {context}", extra=log_data)

