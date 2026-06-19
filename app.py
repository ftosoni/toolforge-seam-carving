import os
import shutil
import tempfile
import subprocess
from typing import Optional
from fastapi import FastAPI, File, UploadFile, Form, HTTPException, status
from fastapi.responses import FileResponse, HTMLResponse
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

# Static Files serving
if os.path.exists("css"):
    app.mount("/css", StaticFiles(directory="css"), name="css")
if os.path.exists("js"):
    app.mount("/js", StaticFiles(directory="js"), name="js")

@app.get("/", response_class=HTMLResponse, include_in_schema=False)
def read_root():
    index_path = "index.html"
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    raise HTTPException(status_code=404, detail="index.html not found")

@app.post("/api/carve", response_class=FileResponse, summary="Perform Seam Carving on an image")
async def carve_image(
    image: UploadFile = File(..., description="The source image file to resize"),
    width: Optional[int] = Form(None, description="Target width in pixels"),
    height: Optional[int] = Form(None, description="Target height in pixels"),
    forward: bool = Form(False, description="Use the 2008 Forward Energy formula instead of classic Backward Energy"),
    mask: Optional[UploadFile] = File(None, description="Optional mask image for object protection (green/white) or removal (red/black)")
):
    bin_p = get_binary()
    
    # Create a temporary directory to store files
    with tempfile.TemporaryDirectory() as tmpdir:
        input_ext = os.path.splitext(image.filename)[1] or ".png"
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
            # Run C++ submodule executable
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        except subprocess.CalledProcessError as err:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Seam carving binary failed: {err.stderr or err.stdout}"
            )

        # Check if output file exists
        if not os.path.exists(output_path):
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Seam carving completed but output image was not generated."
            )

        # Copy file outside temp directory context to ensure it remains accessible during response streaming
        persistent_output = os.path.join(tempfile.gettempdir(), f"carved_output_{os.urandom(8).hex()}{input_ext}")
        shutil.copyfile(output_path, persistent_output)

        # Background task clean-up for the persistent file is handled naturally by FileResponse if needed,
        # but to be clean, we just return it.
        return FileResponse(
            persistent_output, 
            media_type="image/png" if input_ext.lower() == ".png" else "image/jpeg",
            filename=f"carved_{image.filename}"
        )
