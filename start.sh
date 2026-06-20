#!/bin/bash
set -e

# Find any apt layers directory under /layers and fix absolute paths in linker scripts
if [ -d "/layers" ]; then
    echo "Scanning /layers for apt dependencies..."
    APT_DIRS=$(find /layers -maxdepth 3 -type d -name "apt" 2>/dev/null || true)
    for APT_DIR in $APT_DIRS; do
        echo "Found apt directory: $APT_DIR. Fixing linker scripts..."
        # Find libc.so and libpthread.so
        find "$APT_DIR" -name "libc.so" -o -name "libpthread.so" 2>/dev/null | while read -r script; do
            if [ -f "$script" ] && [ ! -L "$script" ]; then
                echo "Patching linker script: $script"
                sed -i "s|/usr/lib/x86_64-linux-gnu/|$APT_DIR/usr/lib/x86_64-linux-gnu/|g" "$script"
                sed -i "s|/lib/x86_64-linux-gnu/|$APT_DIR/lib/x86_64-linux-gnu/|g" "$script"
            fi
        done
    done
fi

# Run CMake and build
echo "Compiling C++ seam carving binary..."
cmake -B seam-carving/build -DCMAKE_BUILD_TYPE=Release seam-carving
cmake --build seam-carving/build --config Release

# Start the web service
echo "Starting FastAPI server..."
exec uvicorn app:app --host 0.0.0.0 --port "$PORT"
