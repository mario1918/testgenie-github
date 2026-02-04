"""
Application Configuration
Centralized configuration management with proper typing and validation.
"""

from pydantic_settings import BaseSettings
from typing import List
import os
from dotenv import load_dotenv

load_dotenv()


class Settings(BaseSettings):
    """Application settings with proper validation and defaults."""
    
    # Application settings
    app_name: str = os.getenv("APP_NAME", "Test Management System")
    app_version: str = os.getenv("APP_VERSION", "1.0.0")
    debug: bool = os.getenv("DEBUG", "True").lower() == "true"
    
    # CORS settings
    cors_origins: List[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "http://localhost:4200"
    ]
    
    # Jira settings
    jira_base_url: str = os.getenv("JIRA_BASE_URL", "")
    jira_username: str = os.getenv("JIRA_USERNAME", "")
    jira_api_token: str = os.getenv("JIRA_API_TOKEN", "")
    
    # Jira Project Configuration
    jira_project_id: str = os.getenv("JIRA_PROJECT_ID", "24300")
    jira_project_key: str = os.getenv("JIRA_PROJECT_KEY", "SE2")
    jira_project_name: str = os.getenv("JIRA_PROJECT_NAME", "SE 2.0")
    jira_board_id: int = int(os.getenv("JIRA_BOARD_ID", "1098"))
    
    # Jira Custom Fields
    jira_sprint_field: str = os.getenv("JIRA_SPRINT_FIELD", "customfield_10007")
    
    # Zephyr Squad settings
    zephyr_base_url: str = os.getenv("ZEPHYR_BASE_URL", "")
    zephyr_access_key: str = os.getenv("ZEPHYR_ACCESS_KEY", "")
    zephyr_secret_key: str = os.getenv("ZEPHYR_SECRET_KEY", "")
    zephyr_account_id: str = os.getenv("ZEPHYR_ACCOUNT_ID", "")
    
    # Zephyr Project Configuration
    zephyr_project_id: int = int(os.getenv("ZEPHYR_PROJECT_ID", "24300"))
    
    # Security settings
    secret_key: str = os.getenv("SECRET_KEY", "your-secret-key-change-in-production")
    algorithm: str = os.getenv("ALGORITHM", "HS256")
    access_token_expire_minutes: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))

    # Atlassian settings
    atlassian_client_id: str = os.getenv("ATLASSIAN_CLIENT_ID", "")

    class Config:
        env_file = ".env"
        case_sensitive = False


# Global settings instance
settings = Settings()

