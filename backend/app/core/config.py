"""Application settings loaded from environment variables (.env)."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # App
    app_mode: str = "demo"
    app_name: str = "Factory Commit"
    app_timezone: str = "Asia/Kuala_Lumpur"
    log_level: str = "INFO"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    cors_allowed_origins: str = "app://.,http://localhost:5173"

    # Security (required)
    jwt_secret: str
    jwt_expire_minutes: int = 480
    admin_email: str
    admin_initial_password: str

    # Database and queue (required)
    database_url: str
    rabbitmq_url: str
    task_default_timeout_seconds: int = 120
    task_max_attempts: int = 3

    # LLM
    anthropic_api_key: str = ""
    llm_model_orchestrator: str = "claude-opus-5-5"
    llm_model_extraction: str = "claude-sonnet-5-5"
    llm_model_explain: str = "claude-haiku-5-5"
    llm_max_tokens: int = 4096
    llm_daily_cost_limit_usd: float = 20.0

    # Email
    imap_host: str = "greenmail"
    imap_port: int = 3143
    imap_user: str = "orders@factory.local"
    imap_password: str = ""
    imap_use_ssl: bool = False
    imap_folder: str = "INBOX"
    smtp_host: str = "greenmail"
    smtp_port: int = 3025
    email_poll_seconds: int = 60
    document_storage_path: str = "/data/documents"

    # Business rules
    extraction_confidence_threshold: float = 0.85
    hold_expiry_hours: int = 48
    approval_reminder_hours: int = 4
    approval_escalation_hours: int = 8
    qc_buffer_hours: int = 4
    shipping_buffer_days: int = 1
    overtime_rate_per_hour: float = 0
    currency: str = "MYR"
    stock_count_warning_days: int = 30
    planning_solver_time_limit_seconds: int = 30

    # Simulator
    sim_po_interval_seconds: int = 300
    sim_machine_event_interval_seconds: int = 20
    sim_breakdown_chance_per_hour: float = 0.05
    sim_random_seed: int = 42

    # Backups
    backup_path: str = "/backups"
    backup_cron: str = "0 * * * *"

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_allowed_origins.split(",") if origin.strip()]

    @property
    def is_demo(self) -> bool:
        return self.app_mode == "demo"


# Business thresholds that an admin may override at runtime through the app_settings table.
EDITABLE_SETTING_KEYS = [
    "extraction_confidence_threshold",
    "hold_expiry_hours",
    "approval_reminder_hours",
    "approval_escalation_hours",
    "qc_buffer_hours",
    "shipping_buffer_days",
    "overtime_rate_per_hour",
    "stock_count_warning_days",
    "planning_solver_time_limit_seconds",
    "llm_daily_cost_limit_usd",
]


@lru_cache
def get_settings() -> Settings:
    return Settings()  # fails at start-up if a required key is missing


class _SettingsProxy:
    """Lets code write `settings.x` while keeping construction lazy (so tests can set env first)."""

    def __getattr__(self, name: str):
        return getattr(get_settings(), name)


settings = _SettingsProxy()
