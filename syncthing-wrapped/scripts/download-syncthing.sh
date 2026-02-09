#!/bin/bash
set -e

# Syncthing version to download
SYNCTHING_VERSION="${SYNCTHING_VERSION:-v1.27.2}"
ASSETS_DIR="app/src/main/assets"

echo "Downloading Syncthing binaries version: $SYNCTHING_VERSION"

# Create assets directory if it doesn't exist
mkdir -p "$ASSETS_DIR"

# Function to download and extract Syncthing for a specific architecture
download_syncthing() {
    local arch=$1
    local syncthing_arch=$2
    local output_name=$3
    
    echo "Downloading Syncthing for $arch..."
    
    local url="https://github.com/syncthing/syncthing/releases/download/${SYNCTHING_VERSION}/syncthing-linux-${syncthing_arch}-${SYNCTHING_VERSION}.tar.gz"
    local temp_dir=$(mktemp -d)
    
    # Download
    if ! curl -L -o "${temp_dir}/syncthing.tar.gz" "$url"; then
        echo "Warning: Failed to download $arch, skipping..."
        rm -rf "$temp_dir"
        return 1
    fi
    
    # Extract
    tar -xzf "${temp_dir}/syncthing.tar.gz" -C "$temp_dir"
    
    # Find the syncthing binary
    local binary=$(find "$temp_dir" -name "syncthing" -type f | head -n 1)
    
    if [ -f "$binary" ]; then
        cp "$binary" "${ASSETS_DIR}/${output_name}"
        chmod +x "${ASSETS_DIR}/${output_name}"
        echo "✓ Downloaded and extracted $output_name"
    else
        echo "✗ Binary not found for $arch"
    fi
    
    # Cleanup
    rm -rf "$temp_dir"
}

# Download binaries for different architectures
download_syncthing "ARM64" "arm64" "syncthing-arm64-v8a"
download_syncthing "ARMv7" "arm" "syncthing-armeabi-v7a"
download_syncthing "x86_64" "amd64" "syncthing-x86_64"
download_syncthing "x86" "386" "syncthing-x86"

echo ""
echo "Downloaded binaries:"
ls -lh "$ASSETS_DIR"/syncthing-* 2>/dev/null || echo "No binaries downloaded"

echo ""
echo "Done! Syncthing binaries are ready in $ASSETS_DIR"
