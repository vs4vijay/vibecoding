# Vizoci - Oracle Cloud Infrastructure Instance Manager

A Python CLI tool to manage Oracle Cloud Infrastructure (OCI) instances. Supports one-shot and loop modes for automatic instance creation when capacity becomes available.

## Features

- **Auto-discovery**: Discovers OCI config, subnets, images from your account
- **VM Management**: List, create, get details of instances
- **Loop Mode**: Automatically retry instance creation when "Out of host capacity" errors occur
- **Telegram Notifications**: Get notified when instances are created
- **Minimal Config**: Only requires region and private key path - everything else auto-discovers

## Requirements

- Python 3.11+
- uv (package manager)
- OCI account with API key configured

## Installation

```bash
# Install dependencies
uv sync

# Or install as package
uv pip install -e .
```

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
# Minimal required config
OCI_REGION=eu-frankfurt-1
OCI_PRIVATE_KEY_FILENAME=~/.oci/oci_api_key.pem

# Instance configuration (auto-discovered if not set)
OCI_SUBNET_ID=ocid1.subnet.oc1.eu-frankfurt-1.xxx
OCI_IMAGE_ID=ocid1.image.oc1.eu-frankfurt-1.xxx
OCI_SHAPE=VM.Standard.A1.Flex
OCI_OCPUS=4
OCI_MEMORY_IN_GBS=24
OCI_SSH_PUBLIC_KEY="ssh-ed25519 AAAAC3..."

# Telegram notifications (optional)
TELEGRAM_BOT_API_KEY=1234567890:xxx
TELEGRAM_USER_ID=123456789

# Loop mode settings
LOOP_MODE=false
LOOP_INTERVAL_MIN=60
LOOP_INTERVAL_MAX=120
```

## Usage

### Discover OCI Configuration

Auto-discover OCI configuration and optionally save to `.env`:

```bash
# Show discovered config (tenancy, user, fingerprint, region, subnet, image)
uv run vizoci discover

# Discover and save to .env
uv run vizoci discover --save
```

### VM Management

List all instances:

```bash
uv run vizoci vm list
uv run vizoci vm list --shape VM.Standard.A1.Flex
uv run vizoci vm list --state RUNNING
```

Get instance details:

```bash
uv run vizoci vm get <instance_id>
```

List availability domains:

```bash
uv run vizoci vm list-ads
```

List available shapes:

```bash
uv run vizoci vm list-shapes
```

### Create Instance

Create a new instance (one-shot):

```bash
uv run vizoci vm create
```

Create in loop mode (auto-retry when out of capacity):

```bash
uv run vizoci vm create --loop

# With custom interval
uv run vizoci vm create --loop --loop-min 30 --loop-max 120
```

## OCI API Key Setup

### 1. Generate RSA Key Pair for OCI API

```bash
# Create .oci directory
mkdir -p ~/.oci

# Generate private key (no passphrase)
openssl genrsa -out ~/.oci/oci_api_key.pem 2048

# Set permissions (only you can read)
chmod 600 ~/.oci/oci_api_key.pem

# Generate public key from private key
openssl rsa -in ~/.oci/oci_api_key.pem -pubout -out ~/.oci/oci_api_key.pub
```

### 2. Upload Public Key to OCI Console

1. Go to **Identity & Security** → **Identity** → **Users**
2. Select your user
3. Click **API Keys** in the Resources section
4. Click **Add API Key**
5. Choose **Paste Public Key** option
6. Paste the content from `~/.oci/oci_api_key.pub`:
   ```bash
   cat ~/.oci/oci_api_key.pub
   ```
7. Click **Add**
8. Copy the **Configuration File Preview** shown (contains fingerprint, user, tenancy)

### 3. Configure ~/.oci/config

```ini
[DEFAULT]
user=ocid1.user.oc1..aaaaaaaa...
fingerprint=xx:xx:xx:xx:xx:xx:xx:xx
tenancy=ocid1.tenancy.oc1..aaaaaaaa...
region=eu-frankfurt-1
key_file=/home/username/.oci/oci_api_key.pem
```

### 4. Verify Fingerprint (Optional)

OCI uses MD5 fingerprint. To verify:

```bash
openssl rsa -pubout -outform DER -in ~/.oci/oci_api_key.pem | md5sum | cut -d' ' -f1 | sed 's/../&:/g' | sed 's/:$//'
```

This should match the fingerprint shown in OCI Console.

## SSH Key for Instance Access

For connecting to created instances, you need an SSH key:

### Option 1: Use Existing SSH Key

```bash
# Check if you have SSH keys
ls -la ~/.ssh/

# Use existing key or generate new one
cat ~/.ssh/id_rsa.pub    # RSA key
cat ~/.ssh/id_ed25519.pub  # ED25519 key (recommended)
```

### Option 2: Generate New SSH Key

```bash
# Generate ED25519 key (recommended)
ssh-keygen -t ed25519 -C "oci-instance"

# Or generate RSA key
ssh-keygen -t rsa -b 4096 -C "oci-instance"
```

### Configure in .env

Add your public key to `.env`:

```bash
OCI_SSH_PUBLIC_KEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA..."

# Or RSA key:
OCI_SSH_PUBLIC_KEY="ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ..."
```

> **Important**: The SSH public key must be on a single line (no line breaks).

### Connect to Instance

After instance is created, get the private IP from:

```bash
uv run vizoci vm get <instance_id>
```

Then connect:

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@<private_ip>
# or
ssh -i ~/.ssh/id_rsa ubuntu@<private_ip>
```

## Always Free Shapes

- **ARM (A1 Flex)**: `VM.Standard.A1.Flex` - up to 4 OCPUs, 24GB RAM
- **AMD (E2 Micro)**: `VM.Standard.E2.1.Micro` - 1 OCPU, 1GB RAM

Note: ARM capacity is often limited. Use `--loop` mode to automatically retry when capacity becomes available.

## Project Structure

```
vizoci/
├── pyproject.toml          # uv project config
├── .env.example            # environment template
├── src/vizoci/
│   ├── __init__.py
│   ├── config.py           # env loader
│   ├── oci_api.py          # OCI SDK wrapper
│   ├── notifier.py         # Telegram notifications
│   ├── instance.py         # creation logic
│   └── cli.py              # CLI commands
```

## License

MIT