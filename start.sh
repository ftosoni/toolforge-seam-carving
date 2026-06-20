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
                # Fix only the specific paths to nonshared static libraries
                sed -i "s|/usr/lib/x86_64-linux-gnu/libc_nonshared.a|$APT_DIR/usr/lib/x86_64-linux-gnu/libc_nonshared.a|g" "$script"
                sed -i "s|/usr/lib/x86_64-linux-gnu/libpthread_nonshared.a|$APT_DIR/usr/lib/x86_64-linux-gnu/libpthread_nonshared.a|g" "$script"
            fi
        done
    done
fi

# Run CMake and build
echo "Compiling C++ seam carving binary..."
if [ -n "$APT_DIR" ] && [ -d "$APT_DIR" ]; then
    echo "Exporting build environment variables for $APT_DIR..."
    export C_INCLUDE_PATH="$APT_DIR/usr/include:$APT_DIR/usr/include/x86_64-linux-gnu${C_INCLUDE_PATH:+:$C_INCLUDE_PATH}"
    export CXX_INCLUDE_PATH="$APT_DIR/usr/include:$APT_DIR/usr/include/x86_64-linux-gnu${CXX_INCLUDE_PATH:+:$CXX_INCLUDE_PATH}"
    export CPATH="$APT_DIR/usr/include:$APT_DIR/usr/include/x86_64-linux-gnu${CPATH:+:$CPATH}"
    export LIBRARY_PATH="$APT_DIR/usr/lib/x86_64-linux-gnu:$APT_DIR/lib/x86_64-linux-gnu${LIBRARY_PATH:+:$LIBRARY_PATH}"
    export LD_LIBRARY_PATH="$APT_DIR/usr/lib/x86_64-linux-gnu:$APT_DIR/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
    # Use -idirafter to make sure #include_next <stdlib.h> checks the apt layers after the C++ header directory
    export CFLAGS="-idirafter $APT_DIR/usr/include -idirafter $APT_DIR/usr/include/x86_64-linux-gnu ${CFLAGS:-}"
    export CXXFLAGS="-idirafter $APT_DIR/usr/include -idirafter $APT_DIR/usr/include/x86_64-linux-gnu ${CXXFLAGS:-}"
fi

cmake -B seam-carving/build -DCMAKE_BUILD_TYPE=Release seam-carving
cmake --build seam-carving/build --config Release

# Start the web service
echo "Starting FastAPI server..."
exec uvicorn app:app --host 0.0.0.0 --port "$PORT"
