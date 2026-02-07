#!/bin/bash

# Example usage of keyspace tool

echo "🔑 keyspace - SSH Vanity Key Generation Tool"
echo "============================================"
echo

# Example 1: Basic ed25519 key generation
echo "Example 1: Generate ed25519 key with prefix 'aaa'"
echo "keyspace -p 'aaa' --algorithm ed25519"
echo

# Example 2: RSA key with custom directory
echo "Example 2: Generate RSA key with custom save location"
echo "keyspace -p 'ssh-rsa' --algorithm rsa -d /tmp/my-keys"
echo

# Example 3: High attempt search
echo "Example 3: Search for rare prefix with high attempt limit"
echo "keyspace -p 'rare' --max-attempts 500000"
echo

# Example 4: Help command
echo "Example 4: Show help"
echo "keyspace --help"
echo

echo "Note: Run these commands after building the tool with:"
echo "cargo build --release"
echo "Then use: ./target/release/keyspace [options]"