"""Application settings loaded from environment variables (.env)."""

import logging
from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)
PLACEHOLDER = "change-me"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # App
    app_mode: str = "production"  # set APP_MODE=demo for the simulator and demo reset
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

    # AI provider (any OpenAI-compatible endpoint; Grafilab by default)
    ai_base_url: str = "https://llm.grafilab.ai/v1"
    ai_api_key: str = ""
    ai_model: str = "grafilab/glm-5.3-flash"  # default for every agent
    # Per-agent models; empty means use ai_model.
    ai_model_orchestrator: str = ""
    ai_model_order: str = ""
    ai_model_planning: str = ""
    ai_model_material: str = ""
    ai_model_quality: str = ""
    ai_model_maintenance: str = ""
    ai_model_monitoring: str = ""
    # JSON: {"model": [usd per million input, output, cached input tokens]}; cached is optional.
    ai_prices: str = (
        '{"grafilab/glm-5.3-flash": [0.08, 0.26, 0.02], "gemini/gemini-3.8-flash": [0.49, 2.45, 0.49]}'
    )
    llm_max_tokens: int = 4096
    llm_daily_cost_limit_usd: float = 20.0
    llm_extraction_daily_cost_limit_usd: float = 10.0  # separate cap for PO reading

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
    # A machine stop shorter than this is not treated as a breakdown for replanning.
    breakdown_min_minutes: float = 10
    # Which date to promise customers: 0 = the solver's date (assumes nothing goes wrong),
    # 50 = the date half the delivery-confidence replays make, 90 = the date 9 in 10 make.
    promise_confidence_percent: float = 0

    # Energy (each factory sets its own values in Settings, Energy; these are demo defaults)
    energy_enabled: float = 1  # 1 = on, 0 = off
    energy_peak_start_minute: float = 14 * 60  # minutes from midnight, factory time zone
    energy_peak_end_minute: float = 22 * 60  # earlier than start = peak crosses midnight; same = no peak
    energy_peak_weekends: float = 0  # 1 = Saturday and Sunday are peak days too
    energy_peak_holidays: float = 0  # 1 = public holidays are peak days too
    energy_peak_rate: float = 0.50  # demo value per kWh; replace with the rate on your bill
    energy_offpeak_rate: float = 0.30  # demo value per kWh
    energy_heavy_machine_kw: float = 15  # machines at or above this are kept out of peak when it saves money
    energy_rates_confirmed: float = 0  # set to 1 when an admin saves the Energy settings
    energy_idle_alert_minutes: float = 30  # idle but switched on for this long = waste alert
    energy_warmup_minutes: float = 30  # no idle alert when the next job starts within this time
    energy_abnormal_percent: float = 25  # running power this much above normal = possible fault
    energy_abnormal_minutes: float = 15  # ...for at least this long

    # Simulator
    sim_send_pos: bool = True  # false: the simulator only runs the machines
    sim_po_interval_seconds: int = 3600
    # Demo POs carry their printed values, so reading them costs no AI call. Set false to show
    # real AI extraction on simulator POs.
    sim_skip_ai: bool = True
    sim_machine_event_interval_seconds: int = 20
    sim_breakdown_chance_per_hour: float = 0.05
    sim_random_seed: int = 42
    sim_energy: bool = True  # false: the simulator sends no power readings
    sim_power_interval_seconds: int = 300  # a power reading per machine at least this often
    # Chance per machine per hour of a waste problem to show the alerts: left on, or high draw.
    sim_energy_problem_chance_per_hour: float = 0.03

    # Backups
    backup_path: str = "/backups"
    backup_cron: str = "0 * * * *"

    @model_validator(mode="after")
    def refuse_placeholder_secrets(self) -> "Settings":
        """Production refuses to start with the example secrets; demo mode only warns."""
        problems = []
        if len(self.jwt_secret) < 32 or PLACEHOLDER in self.jwt_secret:
            problems.append("JWT_SECRET must be at least 32 random characters")
        for name in ("admin_initial_password", "database_url", "rabbitmq_url", "imap_password"):
            if PLACEHOLDER in getattr(self, name):
                problems.append(f"{name.upper()} still contains '{PLACEHOLDER}'")
        if problems and self.app_mode != "demo":
            raise ValueError("Unsafe settings: " + "; ".join(problems))
        for problem in problems:
            logger.warning("Unsafe setting (allowed only in demo mode): %s", problem)
        return self

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
    "breakdown_min_minutes",
    "promise_confidence_percent",
    "llm_daily_cost_limit_usd",
    "energy_enabled",
    "energy_peak_start_minute",
    "energy_peak_end_minute",
    "energy_peak_weekends",
    "energy_peak_holidays",
    "energy_peak_rate",
    "energy_offpeak_rate",
    "energy_heavy_machine_kw",
    "energy_rates_confirmed",
    "energy_idle_alert_minutes",
    "energy_warmup_minutes",
    "energy_abnormal_percent",
    "energy_abnormal_minutes",
]

# Allowed ranges for settings that have more limits than "not negative".
SETTING_LIMITS = {
    "energy_enabled": (0, 1),
    "energy_peak_start_minute": (0, 1439),
    "energy_peak_end_minute": (0, 1439),
    "energy_peak_weekends": (0, 1),
    "energy_peak_holidays": (0, 1),
    "energy_rates_confirmed": (0, 1),
    "energy_idle_alert_minutes": (1, 1440),
    "energy_warmup_minutes": (0, 1440),
    "energy_abnormal_percent": (1, 500),
    "energy_abnormal_minutes": (1, 1440),
}


@lru_cache
def get_settings() -> Settings:
    return Settings()  # fails at start-up if a required key is missing


class _SettingsProxy:
    """Lets code write `settings.x` while keeping construction lazy (so tests can set env first)."""

    def __getattr__(self, name: str):
        return getattr(get_settings(), name)


settings = _SettingsProxy()
