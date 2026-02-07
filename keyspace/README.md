# keyspace

SSH vanity key generation tool written in Rust.

## Features

- Generate SSH keys with custom prefixes
- Support for standard SSH algorithms (ed25519, rsa, ecdsa)
- Interactive confirmation flow
- Automatic key saving to `~/.ssh` or custom directory
- Progress tracking with attempt counter and rate display

## Installation

### Prerequisites

- Rust 1.70+ 
- Visual Studio Build Tools (Windows) or build-essential (Linux/macOS)

### Build from source

```bash
git clone <repository>
cd keyspace
cargo build --release
```

The binary will be available at `target/release/keyspace`.

## Usage

### Basic usage

```bash
keyspace -p "ssh-rsa"
```

### Advanced usage

```bash
keyspace --prefix "ssh-ed25519" --algorithm ed25519 --max-attempts 50000
```

### Save to custom directory

```bash
keyspace -p "custom" -d /path/to/keys
```

## Options

- `-p, --prefix <PREFIX>`: Desired prefix for the public key (required)
- `-d, --dir <DIR>`: Directory to save keys (default: ~/.ssh)
- `--algorithm <ALGORITHM>`: SSH key algorithm (default: ed25519)
  - Supported: `ed25519`, `rsa`, `ecdsa`
- `--max-attempts <NUM>`: Maximum number of attempts (default: 100000)

## Examples

### Generate an ed25519 key starting with "aaa"
```bash
keyspace -p "aaa" --algorithm ed25519
```

### Generate an RSA key with custom save location
```bash
keyspace -p "ssh-rsa" --algorithm rsa -d /tmp/ssh-keys
```

### High-attempt search for rare prefix
```bash
keyspace -p "very-rare-prefix" --max-attempts 1000000
```

## Output

When a matching key is found, the tool will:

1. Display the public key
2. Show the save location
3. Ask for confirmation
4. Save both private and public keys if confirmed

Keys are saved as:
- `{prefix}_id` (private key)
- `{prefix}_id.pub` (public key)

## Security Notes

- Private keys are saved with 600 permissions on Unix systems
- The tool uses cryptographically secure random number generation
- Keys are generated using the standard `ssh-key` crate

## Performance

- Ed25519 keys are fastest to generate
- RSA keys are slower but more widely supported
- Generation rate varies by system and algorithm
- Typical rates: 1000-5000 attempts/second

## License

MIT License