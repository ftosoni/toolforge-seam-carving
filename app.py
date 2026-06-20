import os
import shutil
import tempfile
import subprocess
import base64
import asyncio
from typing import Optional
from fastapi import FastAPI, File, UploadFile, Form, HTTPException, status
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="Toolforge Seam Carving REST API",
    description="REST API wrapping the C++ Seam Carving submodule with auto-generated Swagger UI.",
    version="1.0.0"
)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Locate executable path
possible_paths = [
    "./seam-carving/build/seam_carving",
    "./seam-carving/build/Release/seam_carving.exe",
    "./seam-carving/build/seam_carving.exe",
    "./build/seam_carving",
    "./build/Release/seam_carving.exe",
    "./build/seam_carving.exe"
]
binary_path = None

def get_binary() -> str:
    global binary_path
    if binary_path and os.path.exists(binary_path):
        return binary_path

    # Search for compiled binary
    for p in possible_paths:
        if os.path.exists(p) and os.path.isfile(p):
            binary_path = p
            return binary_path

    # Try compiling automatically if cmake is available
    submodule_dir = "./seam-carving"
    if os.path.exists(submodule_dir) and os.path.exists(os.path.join(submodule_dir, "CMakeLists.txt")):
        try:
            print("Attempting to compile the C++ seam carving binary automatically...")
            build_dir = os.path.join(submodule_dir, "build")
            subprocess.run(["cmake", "-B", build_dir, "-DCMAKE_BUILD_TYPE=Release"], cwd=submodule_dir, check=True)
            subprocess.run(["cmake", "--build", build_dir, "--config", "Release"], cwd=submodule_dir, check=True)
            
            for p in possible_paths:
                if os.path.exists(p) and os.path.isfile(p):
                    binary_path = p
                    return binary_path
        except Exception as e:
            print(f"Failed to auto-compile: {e}")

    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Seam carving backend binary not found. Please compile the C++ submodule using cmake."
    )

import json

# Static Files serving
if os.path.exists("css"):
    app.mount("/css", StaticFiles(directory="css"), name="css")
if os.path.exists("js"):
    app.mount("/js", StaticFiles(directory="js"), name="js")
if os.path.exists("branding"):
    app.mount("/branding", StaticFiles(directory="branding"), name="branding")

@app.get("/", response_class=HTMLResponse, include_in_schema=False)
def read_root():
    index_path = "index.html"
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    raise HTTPException(status_code=404, detail="index.html not found")

@app.post("/api/carve", summary="Perform Seam Carving on an image with progress streaming")
async def carve_image(
    image: UploadFile = File(..., description="The source image file to resize"),
    width: Optional[int] = Form(None, description="Target width in pixels"),
    height: Optional[int] = Form(None, description="Target height in pixels"),
    forward: bool = Form(False, description="Use the 2008 Forward Energy formula instead of classic Backward Energy"),
    mask: Optional[UploadFile] = File(None, description="Optional mask image for object protection (green/white) or removal (red/black)")
):
    bin_p = get_binary()
    input_ext = os.path.splitext(image.filename)[1] or ".png"

    async def event_generator():
        # Keep temporary directory alive during streaming
        with tempfile.TemporaryDirectory() as tmpdir:
            input_path = os.path.join(tmpdir, f"input{input_ext}")
            output_path = os.path.join(tmpdir, f"output{input_ext}")

            # Save uploaded image
            with open(input_path, "wb") as buffer:
                shutil.copyfileobj(image.file, buffer)

            # Build command arguments
            cmd = [bin_p, input_path, output_path]

            if width is not None:
                cmd.extend(["-w", str(width)])
            if height is not None:
                cmd.extend(["-h", str(height)])
            if forward:
                cmd.append("--forward")

            # Save mask if provided
            if mask:
                mask_ext = os.path.splitext(mask.filename)[1] or ".png"
                mask_path = os.path.join(tmpdir, f"mask{mask_ext}")
                with open(mask_path, "wb") as buffer:
                    shutil.copyfileobj(mask.file, buffer)
                cmd.extend(["-m", mask_path])

            try:
                # Start C++ subprocess asynchronously to read progress from stdout
                process = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT
                )
                
                stage = "width"
                
                while True:
                    line = await process.stdout.readline()
                    if not line:
                        break
                    line_str = line.decode('utf-8', errors='replace').strip()
                    if not line_str:
                        continue
                    
                    if "width seam" in line_str:
                        stage = "width"
                        yield json.dumps({"status": "info", "message": line_str}) + "\n"
                    elif "height seam" in line_str:
                        stage = "height"
                        yield json.dumps({"status": "info", "message": line_str}) + "\n"
                    elif "Progress:" in line_str:
                        try:
                            # e.g., "Progress: 10/100 (10%)" or similar
                            clean_line = line_str.replace('\r', '').replace('Progress:', '').strip()
                            parts = clean_line.split()
                            ratio = parts[0]  # "10/100"
                            curr_val, total_val = map(int, ratio.split('/'))
                            pct = int(parts[1].strip('()%'))
                            yield json.dumps({
                                "status": "progress",
                                "stage": stage,
                                "current": curr_val,
                                "total": total_val,
                                "percent": pct
                            }) + "\n"
                        except Exception:
                            yield json.dumps({"status": "info", "message": line_str}) + "\n"
                    else:
                        yield json.dumps({"status": "info", "message": line_str}) + "\n"
                
                await process.wait()
                
                if process.returncode != 0:
                    yield json.dumps({"status": "error", "message": f"Seam carving binary exited with code {process.returncode}"}) + "\n"
                    return
                
            except Exception as err:
                yield json.dumps({"status": "error", "message": f"Failed to run process: {str(err)}"}) + "\n"
                return

            # Check if output file exists and encode to base64
            if os.path.exists(output_path):
                try:
                    with open(output_path, "rb") as f:
                        encoded = base64.b64encode(f.read()).decode('utf-8')
                    mime = "image/png" if input_ext.lower() == ".png" else "image/jpeg"
                    yield json.dumps({
                        "status": "done",
                        "image": f"data:{mime};base64,{encoded}"
                    }) + "\n"
                except Exception as e:
                    yield json.dumps({"status": "error", "message": f"Failed to read/encode output image: {str(e)}"}) + "\n"
            else:
                yield json.dumps({"status": "error", "message": "Output image was not generated."}) + "\n"

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")

