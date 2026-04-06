"""Configuration loader from environment variables."""
import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv


def _expand_path(path: str) -> Path:
    """Expand ~ and environment variables in path."""
    return Path(os.path.expandvars(os.path.expanduser(path)))


@dataclass
class OCIConfig:
    region: str = ""
    user_id: str = ""
    tenancy_id: str = ""
    key_fingerprint: str = ""
    private_key_filename: str = ""
    subnet_id: str = ""
    image_id: str = ""
    ocpus: int = 4
    memory_in_gbs: int = 24
    shape: str = "VM.Standard.A1.Flex"
    max_instances: int = 1
    ssh_public_key: str = ""
    availability_domain: str = ""
    boot_volume_size_in_gbs: int | None = None


@dataclass
class TelegramConfig:
    bot_api_key: str = ""
    user_id: str = ""


@dataclass
class LoopConfig:
    enabled: bool = False
    interval_min: int = 60
    interval_max: int = 120


@dataclass
class Config:
    oci: OCIConfig = field(default_factory=OCIConfig)
    telegram: TelegramConfig = field(default_factory=TelegramConfig)
    loop: LoopConfig = field(default_factory=LoopConfig)


def load_config(env_file: str = ".env") -> Config:
    """Load configuration from .env file and environment variables."""
    load_dotenv(env_file)

    oci = OCIConfig(
        region=os.getenv("OCI_REGION", ""),
        user_id=os.getenv("OCI_USER_ID", ""),
        tenancy_id=os.getenv("OCI_TENANCY_ID", ""),
        key_fingerprint=os.getenv("OCI_KEY_FINGERPRINT", ""),
        private_key_filename=os.getenv("OCI_PRIVATE_KEY_FILENAME", ""),
        subnet_id=os.getenv("OCI_SUBNET_ID", ""),
        image_id=os.getenv("OCI_IMAGE_ID", ""),
        ocpus=int(os.getenv("OCI_OCPUS", "4")),
        memory_in_gbs=int(os.getenv("OCI_MEMORY_IN_GBS", "24")),
        shape=os.getenv("OCI_SHAPE", "VM.Standard.A1.Flex"),
        max_instances=int(os.getenv("OCI_MAX_INSTANCES", "1")),
        ssh_public_key=os.getenv("OCI_SSH_PUBLIC_KEY", ""),
        availability_domain=os.getenv("OCI_AVAILABILITY_DOMAIN", ""),
        boot_volume_size_in_gbs=_parse_int_env("OCI_BOOT_VOLUME_SIZE_IN_GBS"),
    )

    telegram = TelegramConfig(
        bot_api_key=os.getenv("TELEGRAM_BOT_API_KEY", ""),
        user_id=os.getenv("TELEGRAM_USER_ID", ""),
    )

    loop = LoopConfig(
        enabled=os.getenv("LOOP_MODE", "").lower() == "true",
        interval_min=int(os.getenv("LOOP_INTERVAL_MIN", "60")),
        interval_max=int(os.getenv("LOOP_INTERVAL_MAX", "120")),
    )

    return Config(oci=oci, telegram=telegram, loop=loop)


def _parse_int_env(key: str) -> int | None:
    val = os.getenv(key, "")
    if val:
        try:
            return int(val)
        except ValueError:
            return None
    return None


def validate_config(config: Config, require_all: bool = False) -> list[str]:
    """Validate configuration and return list of errors."""
    errors = []

    # Check required fields
    if not config.oci.region:
        errors.append("OCI_REGION is required")
    if not config.oci.private_key_filename:
        errors.append("OCI_PRIVATE_KEY_FILENAME is required (path to PEM file)")
    elif not Path(config.oci.private_key_filename).exists():
        errors.append(f"Private key file not found: {config.oci.private_key_filename}")

    # These can be auto-discovered from OCI config file if not provided
    if require_all:
        if not config.oci.user_id:
            errors.append("OCI_USER_ID is required")
        if not config.oci.tenancy_id:
            errors.append("OCI_TENANCY_ID is required")
        if not config.oci.key_fingerprint:
            errors.append("OCI_KEY_FINGERPRINT is required")

    # For creation, we need subnet, image, and SSH key
    if not config.oci.subnet_id:
        errors.append("OCI_SUBNET_ID is required (for instance creation)")
    if not config.oci.image_id:
        errors.append("OCI_IMAGE_ID is required (for instance creation)")
    if not config.oci.ssh_public_key:
        errors.append("OCI_SSH_PUBLIC_KEY is required (for instance creation)")

    return errors


def validate_discoverable(config: Config) -> list[str]:
    """Validate config - missing values can be discovered from OCI API."""
    errors = []

    if not config.oci.region:
        errors.append("OCI_REGION is required")
    if not config.oci.private_key_filename:
        errors.append("OCI_PRIVATE_KEY_FILENAME is required (path to PEM file)")
    elif not Path(config.oci.private_key_filename).exists():
        errors.append(f"Private key file not found: {config.oci.private_key_filename}")

    return errors