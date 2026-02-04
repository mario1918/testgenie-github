"""
Global Exception Handlers
Provides consistent error handling across the FastAPI application.
"""

from fastapi import Request, HTTPException
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
import logging
from typing import Union

from app.utils.errors import (
    BaseAPIException,
    ErrorCode,
    ErrorResponse,
    create_user_friendly_error,
    log_error
)

logger = logging.getLogger(__name__)


async def base_api_exception_handler(request: Request, exc: BaseAPIException) -> JSONResponse:
    """
    Handle custom API exceptions with user-friendly responses.
    """
    log_error(
        error=exc,
        context=f"{request.method} {request.url.path}",
        additional_data={
            "status_code": exc.status_code,
            "error_code": exc.code.value
        }
    )
    
    return JSONResponse(
        status_code=exc.status_code,
        content=exc.to_dict()
    )


async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """
    Handle FastAPI HTTPExceptions with improved error messages.
    """
    # If the detail is already a dict (structured error), use it as-is
    if isinstance(exc.detail, dict):
        content = exc.detail
    else:
        # Convert string detail to structured error
        content = {
            "error": str(exc.detail),
            "code": _get_error_code_from_status(exc.status_code),
            "suggestion": _get_suggestion_from_status(exc.status_code)
        }
    
    log_error(
        error=exc,
        context=f"{request.method} {request.url.path}",
        additional_data={"status_code": exc.status_code}
    )
    
    return JSONResponse(
        status_code=exc.status_code,
        content=content
    )


async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """
    Handle Pydantic validation errors with user-friendly messages.
    """
    errors = []
    for error in exc.errors():
        field_path = " -> ".join(str(loc) for loc in error["loc"])
        error_msg = error["msg"]
        error_type = error["type"]
        
        # Create user-friendly error message
        if error_type == "missing":
            user_msg = f"The field '{field_path}' is required."
        elif error_type == "type_error":
            user_msg = f"The field '{field_path}' has an invalid format."
        elif error_type == "value_error":
            user_msg = f"The field '{field_path}' has an invalid value."
        else:
            user_msg = f"The field '{field_path}' is invalid: {error_msg}"
        
        errors.append({
            "field": field_path,
            "message": user_msg,
            "type": error_type
        })
    
    content = {
        "error": "The request contains invalid data.",
        "code": ErrorCode.VALIDATION_ERROR,
        "details": f"Found {len(errors)} validation error(s).",
        "suggestion": "Please check the highlighted fields and try again.",
        "validation_errors": errors
    }
    
    log_error(
        error=exc,
        context=f"{request.method} {request.url.path}",
        additional_data={"validation_errors": errors}
    )
    
    return JSONResponse(
        status_code=422,
        content=content
    )


async def general_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """
    Handle unexpected exceptions with generic error response.
    """
    log_error(
        error=exc,
        context=f"{request.method} {request.url.path}",
        additional_data={"exception_type": type(exc).__name__}
    )
    
    # Don't expose internal error details to users
    content = {
        "error": "An unexpected error occurred. Please try again.",
        "code": ErrorCode.INTERNAL_ERROR,
        "suggestion": "If the problem persists, please contact support."
    }
    
    return JSONResponse(
        status_code=500,
        content=content
    )


def _get_error_code_from_status(status_code: int) -> str:
    """Get appropriate error code based on HTTP status code."""
    status_to_code = {
        400: ErrorCode.INVALID_INPUT,
        401: ErrorCode.UNAUTHORIZED,
        403: ErrorCode.FORBIDDEN,
        404: ErrorCode.NOT_FOUND,
        409: ErrorCode.CONFLICT,
        422: ErrorCode.VALIDATION_ERROR,
        500: ErrorCode.INTERNAL_ERROR,
        502: ErrorCode.EXTERNAL_SERVICE_ERROR,
        503: ErrorCode.EXTERNAL_SERVICE_ERROR
    }
    return status_to_code.get(status_code, ErrorCode.INTERNAL_ERROR)


def _get_suggestion_from_status(status_code: int) -> str:
    """Get appropriate suggestion based on HTTP status code."""
    status_to_suggestion = {
        400: "Please check your request and try again.",
        401: "Please provide valid authentication credentials.",
        403: "Please contact an administrator for access.",
        404: "Please check the resource identifier and try again.",
        409: "Please resolve the conflict and try again.",
        422: "Please check your input data and try again.",
        500: "Please try again. If the problem persists, contact support.",
        502: "The external service is currently unavailable. Please try again later.",
        503: "The service is temporarily unavailable. Please try again later."
    }
    return status_to_suggestion.get(status_code, "Please try again later.")


def setup_exception_handlers(app):
    """
    Set up all exception handlers for the FastAPI app.
    
    Args:
        app: FastAPI application instance
    """
    # Custom API exceptions
    app.add_exception_handler(BaseAPIException, base_api_exception_handler)
    
    # FastAPI HTTP exceptions
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    
    # Validation exceptions
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    
    # Catch-all for unexpected exceptions
    app.add_exception_handler(Exception, general_exception_handler)

