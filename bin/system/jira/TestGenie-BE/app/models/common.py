"""
Common base models and shared types used across the application.
Provides reusable components to avoid duplication.
"""
from pydantic import BaseModel, Field
from typing import Optional, List, Generic, TypeVar
from datetime import datetime

# Generic type for paginated responses
T = TypeVar('T')


class PaginatedResponse(BaseModel, Generic[T]):
    """
    Generic paginated response model.
    Can be used for any list of items with pagination metadata.
    """
    items: List[T]
    total: int
    start_at: int = Field(0, description="Starting index of the current page")
    max_results: int = Field(50, description="Maximum results per page")
    is_last: bool = Field(True, description="Whether this is the last page")
    next_page_token: Optional[str] = Field(None, description="Token for next page")


class TimestampMixin(BaseModel):
    """Mixin for models that track creation and modification times."""
    created: datetime = Field(..., description="Creation timestamp")
    updated: datetime = Field(..., description="Last update timestamp")


class AuditMixin(BaseModel):
    """Mixin for models that track who created/modified them."""
    created_by: Optional[str] = Field(None, description="User who created this")
    modified_by: Optional[str] = Field(None, description="User who last modified this")


class SuccessResponse(BaseModel):
    """Standard success response for operations."""
    success: bool = Field(True, description="Operation success status")
    message: str = Field(..., description="Human-readable message")
    data: Optional[dict] = Field(None, description="Optional response data")


class ErrorDetail(BaseModel):
    """Detailed error information."""
    field: Optional[str] = Field(None, description="Field that caused the error")
    message: str = Field(..., description="Error message")
    code: Optional[str] = Field(None, description="Error code")


class BulkOperationResult(BaseModel):
    """Result of a bulk operation."""
    total: int = Field(..., description="Total items processed")
    succeeded: int = Field(..., description="Number of successful operations")
    failed: int = Field(..., description="Number of failed operations")
    errors: List[ErrorDetail] = Field(default_factory=list, description="List of errors")
