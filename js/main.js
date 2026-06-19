// Seam Carving Toolforge Utility - Core logic and algorithm implementation
document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const controlsSection = document.getElementById('controls-section');
    const canvasContainer = document.getElementById('canvas-container');
    
    const imageCanvas = document.getElementById('image-canvas');
    const maskCanvas = document.getElementById('mask-canvas');
    const interactionCanvas = document.getElementById('interaction-canvas');
    
    const inputWidthEl = document.getElementById('input-width');
    const inputHeightEl = document.getElementById('input-height');
    const targetWidthEl = document.getElementById('target-width');
    const targetHeightEl = document.getElementById('target-height');
    const energyModeEl = document.getElementById('energy-mode');
    
    const brushProtectBtn = document.querySelector('[data-brush="protect"]');
    const brushRemoveBtn = document.querySelector('[data-brush="remove"]');
    const brushEraseBtn = document.querySelector('[data-brush="erase"]');
    const brushSizeEl = document.getElementById('brush-size');
    const clearMaskBtn = document.getElementById('btn-clear-mask');
    
    const btnRun = document.getElementById('btn-run');
    const btnReset = document.getElementById('btn-reset');
    const btnDownload = document.getElementById('btn-download');
    
    const viewGrayscaleEl = document.getElementById('view-grayscale');
    const animateCarvingEl = document.getElementById('animate-carving');
    const showSeamsEl = document.getElementById('show-seams');
    const animationSpeedEl = document.getElementById('animation-speed');
    
    const progressBarContainer = document.querySelector('.progress-bar-container');
    const progressBarFill = document.querySelector('.progress-bar-fill');
    const currentDimensionsEl = document.getElementById('current-dimensions');
    const statusMsgEl = document.getElementById('status-msg');

    // Wikimedia Commons Elements
    const commonsPresetEl = document.getElementById('commons-preset');
    const commonsCustomInputEl = document.getElementById('commons-custom-input');
    const btnFetchCommons = document.getElementById('btn-fetch-commons');
    const commonsWidthLimitEl = document.getElementById('commons-width-limit');

    // Contexts
    const imgCtx = imageCanvas.getContext('2d');
    const maskCtx = maskCanvas.getContext('2d');
    const interactCtx = interactionCanvas.getContext('2d');

    // State Variables
    let originalImage = null;
    let currentImgData = null; // Uint8ClampedArray for the carved image
    let currentWidth = 0;
    let currentHeight = 0;
    let isDrawing = false;
    let currentBrush = 'protect'; // 'protect', 'remove', 'erase'
    let maskData = null; // Float32Array: positive for protect, negative for remove, 0 otherwise
    let isProcessing = false;
    let shouldStop = false;

    // Load Default Image/Placeholder click
    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('click', (e) => e.stopPropagation());
    fileInput.addEventListener('change', handleFileSelect);

    // Preset selection change copies name to custom input
    commonsPresetEl.addEventListener('change', () => {
        if (commonsPresetEl.value) {
            commonsCustomInputEl.value = commonsPresetEl.value;
        }
    });

    btnFetchCommons.addEventListener('click', fetchFromCommons);

    async function fetchFromCommons() {
        let fileName = commonsCustomInputEl.value.trim();
        if (!fileName) {
            alert('Please select a preset or type a Commons file name.');
            return;
        }

        // Format filename: replace spaces with underscores, ensure File: prefix
        if (!fileName.toLowerCase().startsWith('file:')) {
            fileName = 'File:' + fileName;
        }
        fileName = fileName.replace(/ /g, '_');

        statusMsgEl.textContent = `Querying Wikimedia Commons for ${fileName}...`;
        btnFetchCommons.disabled = true;

        try {
            const apiURL = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(fileName)}&prop=imageinfo&iiprop=url|size&format=json&origin=*`;
            const response = await fetch(apiURL);
            const data = await response.json();
            
            const pages = data.query.pages;
            const pageId = Object.keys(pages)[0];
            
            if (pageId === '-1') {
                throw new Error('File not found on Wikimedia Commons.');
            }

            const imgInfo = pages[pageId].imageinfo[0];
            const originalUrl = imgInfo.url;
            const origWidth = imgInfo.width;
            const origHeight = imgInfo.height;

            // Determine if we need to fetch a thumbnail (for speed)
            const widthLimit = commonsWidthLimitEl.value;
            let fetchUrl = originalUrl;

            if (widthLimit !== 'original' && origWidth > parseInt(widthLimit)) {
                const targetLimit = parseInt(widthLimit);
                const thumbApiURL = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(fileName)}&prop=imageinfo&iiprop=url|size&iiurlwidth=${targetLimit}&format=json&origin=*`;
                const thumbRes = await fetch(thumbApiURL);
                const thumbData = await thumbRes.json();
                const thumbPages = thumbData.query.pages;
                const thumbPageId = Object.keys(thumbPages)[0];
                const thumbInfo = thumbPages[thumbPageId].imageinfo[0];
                if (thumbInfo.thumburl) {
                    fetchUrl = thumbInfo.thumburl;
                }
            }

            statusMsgEl.textContent = 'Loading image from Commons...';

            const img = new Image();
            img.crossOrigin = 'anonymous'; // enables pixel reading without CORS security taint
            img.onload = function () {
                originalImage = img;
                resetWorkspace();
                statusMsgEl.textContent = `Loaded ${fileName} from Wikimedia Commons.`;
                btnFetchCommons.disabled = false;
            };
            img.onerror = function() {
                alert('Failed to load image from Wikimedia Commons due to network or CORS issues.');
                statusMsgEl.textContent = 'Error loading image.';
                btnFetchCommons.disabled = false;
            };
            img.src = fetchUrl;

        } catch (err) {
            alert('Error: ' + err.message);
            statusMsgEl.textContent = 'Fetch failed.';
            btnFetchCommons.disabled = false;
        }
    }

    // Drag and Drop
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            fileInput.files = e.dataTransfer.files;
            handleFileSelect();
        }
    });

    // Brush Selection
    const selectBrush = (brushType) => {
        currentBrush = brushType;
        [brushProtectBtn, brushRemoveBtn, brushEraseBtn].forEach(btn => btn.classList.remove('active'));
        if (brushType === 'protect') brushProtectBtn.classList.add('active');
        if (brushType === 'remove') brushRemoveBtn.classList.add('active');
        if (brushType === 'erase') brushEraseBtn.classList.add('active');
    };

    brushProtectBtn.addEventListener('click', () => selectBrush('protect'));
    brushRemoveBtn.addEventListener('click', () => selectBrush('remove'));
    brushEraseBtn.addEventListener('click', () => selectBrush('erase'));

    clearMaskBtn.addEventListener('click', () => {
        if (!currentWidth || !currentHeight) return;
        maskCtx.clearRect(0, 0, currentWidth, currentHeight);
        maskData.fill(0);
        drawInteractionCanvas();
    });

    // File handling
    function handleFileSelect() {
        const file = fileInput.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function (e) {
            const img = new Image();
            img.onload = function () {
                originalImage = img;
                resetWorkspace();
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    function resetWorkspace() {
        if (!originalImage) return;

        shouldStop = true;
        isProcessing = false;

        currentWidth = originalImage.naturalWidth;
        currentHeight = originalImage.naturalHeight;

        // Prevent rendering massive images directly if they degrade performance
        // (Downscale visually for safety if exceeds 800px, but here we run natively)
        imageCanvas.width = currentWidth;
        imageCanvas.height = currentHeight;
        maskCanvas.width = currentWidth;
        maskCanvas.height = currentHeight;
        interactionCanvas.width = currentWidth;
        interactionCanvas.height = currentHeight;

        imgCtx.drawImage(originalImage, 0, 0);
        currentImgData = imgCtx.getImageData(0, 0, currentWidth, currentHeight);

        // Inputs setup
        inputWidthEl.textContent = currentWidth;
        inputHeightEl.textContent = currentHeight;
        targetWidthEl.value = currentWidth;
        targetHeightEl.value = currentHeight;

        // Initialize mask array
        maskData = new Float32Array(currentWidth * currentHeight);
        maskCtx.clearRect(0, 0, currentWidth, currentHeight);

        // Show controls and workspace
        dropZone.style.display = 'none';
        canvasContainer.style.display = 'block';
        controlsSection.style.display = 'block';

        updateWorkspaceView();
        updateMetrics();
        btnRun.disabled = false;
        btnRun.textContent = "Run Carving";
    }

    function updateMetrics() {
        currentDimensionsEl.textContent = `${currentWidth} x ${currentHeight}`;
    }

    // View Options Change
    viewGrayscaleEl.addEventListener('change', updateWorkspaceView);

    function updateWorkspaceView() {
        if (!currentImgData) return;

        if (viewGrayscaleEl.checked) {
            // Render grayscale representation
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = currentWidth;
            tempCanvas.height = currentHeight;
            const tempCtx = tempCanvas.getContext('2d');
            const grayscaleData = tempCtx.createImageData(currentWidth, currentHeight);

            for (let i = 0; i < currentImgData.data.length; i += 4) {
                const r = currentImgData.data[i];
                const g = currentImgData.data[i + 1];
                const b = currentImgData.data[i + 2];
                // Standard grayscale luminosity conversion
                const gray = 0.299 * r + 0.587 * g + 0.114 * b;
                grayscaleData.data[i] = gray;
                grayscaleData.data[i + 1] = gray;
                grayscaleData.data[i + 2] = gray;
                grayscaleData.data[i + 3] = currentImgData.data[i + 3];
            }
            imgCtx.putImageData(grayscaleData, 0, 0);
        } else {
            imgCtx.putImageData(currentImgData, 0, 0);
        }

        drawInteractionCanvas();
    }

    // Draw combined visual overlay on interaction canvas
    function drawInteractionCanvas() {
        interactCtx.clearRect(0, 0, currentWidth, currentHeight);
        
        // Draw mask with transparency
        const maskImg = maskCtx.getImageData(0, 0, currentWidth, currentHeight);
        const interactImg = interactCtx.createImageData(currentWidth, currentHeight);
        
        for (let i = 0; i < maskImg.data.length; i += 4) {
            const r = maskImg.data[i];
            const g = maskImg.data[i + 1];
            const b = maskImg.data[i + 2];
            const a = maskImg.data[i + 3];
            
            if (a > 0) {
                interactImg.data[i] = r;
                interactImg.data[i+1] = g;
                interactImg.data[i+2] = b;
                interactImg.data[i+3] = 128; // semi-transparent
            }
        }
        interactCtx.putImageData(interactImg, 0, 0);
    }

    // Interactive Painting logic
    function getMousePos(canvas, evt) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: Math.floor((evt.clientX - rect.left) / rect.width * canvas.width),
            y: Math.floor((evt.clientY - rect.top) / rect.height * canvas.height)
        };
    }

    function drawPaint(pos) {
        const size = parseInt(brushSizeEl.value);
        maskCtx.beginPath();
        maskCtx.arc(pos.x, pos.y, size / 2, 0, 2 * Math.PI);
        
        if (currentBrush === 'protect') {
            maskCtx.fillStyle = 'rgba(0, 175, 137, 1)';
            maskCtx.fill();
        } else if (currentBrush === 'remove') {
            maskCtx.fillStyle = 'rgba(211, 61, 51, 1)';
            maskCtx.fill();
        } else if (currentBrush === 'erase') {
            // To erase, we draw using 'destination-out' blend mode
            maskCtx.globalCompositeOperation = 'destination-out';
            maskCtx.fill();
            maskCtx.globalCompositeOperation = 'source-over';
        }
        
        // Update the numeric mask array
        updateMaskDataFromCanvas();
        drawInteractionCanvas();
    }

    function updateMaskDataFromCanvas() {
        const maskImg = maskCtx.getImageData(0, 0, currentWidth, currentHeight);
        maskData = new Float32Array(currentWidth * currentHeight);
        for (let i = 0; i < maskImg.data.length; i += 4) {
            const r = maskImg.data[i];
            const g = maskImg.data[i + 1];
            const a = maskImg.data[i + 3];
            const pixelIdx = i / 4;
            
            if (a > 0) {
                if (g > r) {
                    maskData[pixelIdx] = 1e9; // Protect
                } else if (r > g) {
                    maskData[pixelIdx] = -1e9; // Remove
                }
            }
        }
    }

    interactionCanvas.addEventListener('mousedown', (e) => {
        if (isProcessing) return;
        isDrawing = true;
        drawPaint(getMousePos(interactionCanvas, e));
    });

    interactionCanvas.addEventListener('mousemove', (e) => {
        if (!isDrawing || isProcessing) return;
        drawPaint(getMousePos(interactionCanvas, e));
    });

    window.addEventListener('mouseup', () => {
        isDrawing = false;
    });

    // Seam Carving Implementation
    // Dynamic programming approach:
    // Computes energy maps, finds minimal cost path (seam), and carves it.

    function getEnergyMapBackward(width, height, imgData, mask) {
        const energy = new Float32Array(width * height);
        const data = imgData.data;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                
                // Boundary conditions handling
                const leftX = x > 0 ? x - 1 : x;
                const rightX = x < width - 1 ? x + 1 : x;
                const upY = y > 0 ? y - 1 : y;
                const downY = y < height - 1 ? y + 1 : y;

                // Gradient in X
                const idxL = (y * width + leftX) * 4;
                const idxR = (y * width + rightX) * 4;
                const rx = data[idxR] - data[idxL];
                const gx = data[idxR + 1] - data[idxL + 1];
                const bx = data[idxR + 2] - data[idxL + 2];
                const dx2 = rx * rx + gx * gx + bx * bx;

                // Gradient in Y
                const idxU = (upY * width + x) * 4;
                const idxD = (downY * width + x) * 4;
                const ry = data[idxD] - data[idxU];
                const gy = data[idxD + 1] - data[idxU + 1];
                const by = data[idxD + 2] - data[idxU + 2];
                const dy2 = ry * ry + gy * gy + by * by;

                let pixelEnergy = Math.sqrt(dx2 + dy2);
                
                // Add mask weight
                if (mask) {
                    pixelEnergy += mask[idx];
                }

                energy[idx] = pixelEnergy;
            }
        }
        return energy;
    }

    function getEnergyMapForward(width, height, imgData, mask) {
        const energy = new Float32Array(width * height);
        const data = imgData.data;

        // For Forward Energy, we calculate the pixel difference cost when removing a seam.
        // Formula per pixel:
        // C_L = |I(x+1, y) - I(x-1, y)| + |I(x, y-1) - I(x-1, y)|
        // C_U = |I(x+1, y) - I(x-1, y)|
        // C_R = |I(x+1, y) - I(x-1, y)| + |I(x, y-1) - I(x+1, y)|
        
        // Dynamic programming accumulates these directly:
        // We will store the cost map calculation directly in dynamic programming matrices
        // rather than precomputing a standard static energy map, because the cost depends
        // on the choice of transition.
        // For simplicity and speed, we will approximate forward energy by adding the transition
        // costs to a static map or during the DP matrix construction.
        // Let's implement full Forward Energy DP.
        return energy; // Handled directly in findSeamForward
    }

    // Helper to get color difference between two pixels
    function pixelDiff(idx1, idx2, data) {
        const dr = data[idx1] - data[idx2];
        const dg = data[idx1 + 1] - data[idx2 + 1];
        const db = data[idx1 + 2] - data[idx2 + 2];
        return Math.sqrt(dr * dr + dg * dg + db * db);
    }

    // Finding Vertical Seams
    function findVerticalSeam(width, height, imgData, mask, isForward) {
        const M = new Float32Array(width * height);
        const paths = new Int32Array(width * height);
        const data = imgData.data;

        if (!isForward) {
            // Classical Backward Energy
            const energy = getEnergyMapBackward(width, height, imgData, mask);

            // Populate first row
            for (let x = 0; x < width; x++) {
                M[x] = energy[x];
            }

            // DP step
            for (let y = 1; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = y * width + x;
                    
                    let minVal = M[(y - 1) * width + x];
                    let parent = x;

                    if (x > 0) {
                        const leftVal = M[(y - 1) * width + (x - 1)];
                        if (leftVal < minVal) {
                            minVal = leftVal;
                            parent = x - 1;
                        }
                    }

                    if (x < width - 1) {
                        const rightVal = M[(y - 1) * width + (x + 1)];
                        if (rightVal < minVal) {
                            minVal = rightVal;
                            parent = x + 1;
                        }
                    }

                    M[idx] = energy[idx] + minVal;
                    paths[idx] = parent;
                }
            }
        } else {
            // Forward Energy (Rubinstein 2008)
            // C_L(x,y) = |I(x+1, y) - I(x-1, y)| + |I(x, y-1) - I(x-1, y)|
            // C_U(x,y) = |I(x+1, y) - I(x-1, y)|
            // C_R(x,y) = |I(x+1, y) - I(x-1, y)| + |I(x, y-1) - I(x+1, y)|

            // Row 0 initialization (0 cost added)
            for (let x = 0; x < width; x++) {
                M[x] = mask ? mask[x] : 0;
            }

            for (let y = 1; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = y * width + x;
                    const leftX = x > 0 ? x - 1 : 0;
                    const rightX = x < width - 1 ? x + 1 : width - 1;

                    // Indices for diff
                    const idxL = (y * width + leftX) * 4;
                    const idxR = (y * width + rightX) * 4;
                    const idxU = ((y - 1) * width + x) * 4;

                    const cU = pixelDiff(idxR, idxL, data);
                    const cL = cU + pixelDiff(idxU, idxL, data);
                    const cR = cU + pixelDiff(idxU, idxR, data);

                    let minVal = M[(y - 1) * width + x] + cU;
                    let parent = x;

                    if (x > 0) {
                        const leftVal = M[(y - 1) * width + (x - 1)] + cL;
                        if (leftVal < minVal) {
                            minVal = leftVal;
                            parent = x - 1;
                        }
                    }

                    if (x < width - 1) {
                        const rightVal = M[(y - 1) * width + (x + 1)] + cR;
                        if (rightVal < minVal) {
                            minVal = rightVal;
                            parent = x + 1;
                        }
                    }

                    M[idx] = minVal + (mask ? mask[idx] : 0);
                    paths[idx] = parent;
                }
            }
        }

        // Find min in bottom row
        let minX = 0;
        let minCost = M[(height - 1) * width];
        for (let x = 1; x < width; x++) {
            const cost = M[(height - 1) * width + x];
            if (cost < minCost) {
                minCost = cost;
                minX = x;
            }
        }

        // Backtrack
        const seam = new Int32Array(height);
        let currX = minX;
        for (let y = height - 1; y >= 0; y--) {
            seam[y] = currX;
            currX = paths[y * width + currX];
        }

        return seam;
    }

    // Finding Horizontal Seams
    function findHorizontalSeam(width, height, imgData, mask, isForward) {
        const M = new Float32Array(width * height);
        const paths = new Int32Array(width * height);
        const data = imgData.data;

        if (!isForward) {
            const energy = getEnergyMapBackward(width, height, imgData, mask);

            // Populate first column
            for (let y = 0; y < height; y++) {
                M[y * width] = energy[y * width];
            }

            // DP step
            for (let x = 1; x < width; x++) {
                for (let y = 0; y < height; y++) {
                    const idx = y * width + x;
                    
                    let minVal = M[y * width + (x - 1)];
                    let parent = y;

                    if (y > 0) {
                        const upVal = M[(y - 1) * width + (x - 1)];
                        if (upVal < minVal) {
                            minVal = upVal;
                            parent = y - 1;
                        }
                    }

                    if (y < height - 1) {
                        const downVal = M[(y + 1) * width + (x - 1)];
                        if (downVal < minVal) {
                            minVal = downVal;
                            parent = y + 1;
                        }
                    }

                    M[idx] = energy[idx] + minVal;
                    paths[idx] = parent;
                }
            }
        } else {
            // Forward Energy Horizontal
            for (let y = 0; y < height; y++) {
                M[y * width] = mask ? mask[y * width] : 0;
            }

            for (let x = 1; x < width; x++) {
                for (let y = 0; y < height; y++) {
                    const idx = y * width + x;
                    const upY = y > 0 ? y - 1 : 0;
                    const downY = y < height - 1 ? y + 1 : height - 1;

                    const idxU = (upY * width + x) * 4;
                    const idxD = (downY * width + x) * 4;
                    const idxL = (y * width + (x - 1)) * 4;

                    const cU = pixelDiff(idxD, idxU, data);
                    const cL = cU + pixelDiff(idxL, idxU, data);
                    const cR = cU + pixelDiff(idxL, idxD, data);

                    let minVal = M[y * width + (x - 1)] + cU;
                    let parent = y;

                    if (y > 0) {
                        const upVal = M[(y - 1) * width + (x - 1)] + cL;
                        if (upVal < minVal) {
                            minVal = upVal;
                            parent = y - 1;
                        }
                    }

                    if (y < height - 1) {
                        const downVal = M[(y + 1) * width + (x - 1)] + cR;
                        if (downVal < minVal) {
                            minVal = downVal;
                            parent = y + 1;
                        }
                    }

                    M[idx] = minVal + (mask ? mask[idx] : 0);
                    paths[idx] = parent;
                }
            }
        }

        // Find min in rightmost column
        let minY = 0;
        let minCost = M[minY * width + (width - 1)];
        for (let y = 1; y < height; y++) {
            const cost = M[y * width + (width - 1)];
            if (cost < minCost) {
                minCost = cost;
                minY = y;
            }
        }

        // Backtrack
        const seam = new Int32Array(width);
        let currY = minY;
        for (let x = width - 1; x >= 0; x--) {
            seam[x] = currY;
            currY = paths[currY * width + x];
        }

        return seam;
    }

    // Carve single vertical seam
    function carveVertical(seam) {
        const nextWidth = currentWidth - 1;
        const nextImgData = imgCtx.createImageData(nextWidth, currentHeight);
        const nextMask = new Float32Array(nextWidth * currentHeight);
        
        const nextMaskImg = maskCtx.createImageData(nextWidth, currentHeight);

        const srcData = currentImgData.data;
        const dstData = nextImgData.data;

        // Old mask canvas image data
        const oldMaskImg = maskCtx.getImageData(0, 0, currentWidth, currentHeight);

        for (let y = 0; y < currentHeight; y++) {
            const seamX = seam[y];
            let dstX = 0;
            for (let x = 0; x < currentWidth; x++) {
                if (x === seamX) continue;

                // Copy color
                const srcIdx = (y * currentWidth + x) * 4;
                const dstIdx = (y * nextWidth + dstX) * 4;
                dstData[dstIdx] = srcData[srcIdx];
                dstData[dstIdx + 1] = srcData[srcIdx + 1];
                dstData[dstIdx + 2] = srcData[srcIdx + 2];
                dstData[dstIdx + 3] = srcData[srcIdx + 3];

                // Copy mask array
                nextMask[y * nextWidth + dstX] = maskData[y * currentWidth + x];

                // Copy mask canvas pixels
                nextMaskImg.data[dstIdx] = oldMaskImg.data[srcIdx];
                nextMaskImg.data[dstIdx + 1] = oldMaskImg.data[srcIdx + 1];
                nextMaskImg.data[dstIdx + 2] = oldMaskImg.data[srcIdx + 2];
                nextMaskImg.data[dstIdx + 3] = oldMaskImg.data[srcIdx + 3];

                dstX++;
            }
        }

        currentWidth = nextWidth;
        currentImgData = nextImgData;
        maskData = nextMask;

        // Resize canvases
        imageCanvas.width = currentWidth;
        maskCanvas.width = currentWidth;
        interactionCanvas.width = currentWidth;

        maskCtx.putImageData(nextMaskImg, 0, 0);
    }

    // Carve single horizontal seam
    function carveHorizontal(seam) {
        const nextHeight = currentHeight - 1;
        const nextImgData = imgCtx.createImageData(currentWidth, nextHeight);
        const nextMask = new Float32Array(currentWidth * nextHeight);
        
        const nextMaskImg = maskCtx.createImageData(currentWidth, nextHeight);

        const srcData = currentImgData.data;
        const dstData = nextImgData.data;

        const oldMaskImg = maskCtx.getImageData(0, 0, currentWidth, currentHeight);

        for (let x = 0; x < currentWidth; x++) {
            const seamY = seam[x];
            let dstY = 0;
            for (let y = 0; y < currentHeight; y++) {
                if (y === seamY) continue;

                const srcIdx = (y * currentWidth + x) * 4;
                const dstIdx = (dstY * currentWidth + x) * 4;
                dstData[dstIdx] = srcData[srcIdx];
                dstData[dstIdx + 1] = srcData[srcIdx + 1];
                dstData[dstIdx + 2] = srcData[srcIdx + 2];
                dstData[dstIdx + 3] = srcData[srcIdx + 3];

                nextMask[dstY * currentWidth + x] = maskData[y * currentWidth + x];

                nextMaskImg.data[dstIdx] = oldMaskImg.data[srcIdx];
                nextMaskImg.data[dstIdx + 1] = oldMaskImg.data[srcIdx + 1];
                nextMaskImg.data[dstIdx + 2] = oldMaskImg.data[srcIdx + 2];
                nextMaskImg.data[dstIdx + 3] = oldMaskImg.data[srcIdx + 3];

                dstY++;
            }
        }

        currentHeight = nextHeight;
        currentImgData = nextImgData;
        maskData = nextMask;

        imageCanvas.height = currentHeight;
        maskCanvas.height = currentHeight;
        interactionCanvas.height = currentHeight;

        maskCtx.putImageData(nextMaskImg, 0, 0);
    }

    // Drawing Active Seams overlay helper
    function drawVerticalSeamOverlay(seam) {
        interactCtx.clearRect(0, 0, currentWidth, currentHeight);
        drawInteractionCanvas();
        interactCtx.fillStyle = '#00ffff'; // bright cyan seam
        for (let y = 0; y < currentHeight; y++) {
            interactCtx.fillRect(seam[y], y, 1, 1);
        }
    }

    function drawHorizontalSeamOverlay(seam) {
        interactCtx.clearRect(0, 0, currentWidth, currentHeight);
        drawInteractionCanvas();
        interactCtx.fillStyle = '#00ffff';
        for (let x = 0; x < currentWidth; x++) {
            interactCtx.fillRect(x, seam[x], 1, 1);
        }
    }

    // Core execution orchestrator
    async function runCarvingProcess() {
        const targetWidth = Math.max(1, parseInt(targetWidthEl.value));
        const targetHeight = Math.max(1, parseInt(targetHeightEl.value));
        const isForward = energyModeEl.value === 'forward';

        if (targetWidth > currentWidth || targetHeight > currentHeight) {
            // Submodule supports insertion/enlargement, let's implement enlargement
            // by adding seams.
            statusMsgEl.textContent = "Seam insertion/enlargement is supported statically, but downscaling is optimized here.";
        }

        isProcessing = true;
        shouldStop = false;
        btnRun.textContent = "Pause Carving";
        progressBarContainer.style.display = 'block';

        const totalStepsWidth = Math.max(0, currentWidth - targetWidth);
        const totalStepsHeight = Math.max(0, currentHeight - targetHeight);
        const totalSteps = totalStepsWidth + totalStepsHeight;
        let completedSteps = 0;

        const updateProgress = () => {
            completedSteps++;
            const pct = Math.min(100, Math.floor((completedSteps / totalSteps) * 100));
            progressBarFill.style.width = `${pct}%`;
        };

        const speed = parseInt(animationSpeedEl.value);
        const animate = animateCarvingEl.checked;

        if (!animate) {
            statusMsgEl.textContent = "Carving on C++ server...";
            progressBarContainer.style.display = 'block';
            progressBarFill.style.width = '50%';
            
            try {
                // Convert current canvas to blob
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = currentWidth;
                tempCanvas.height = currentHeight;
                const tempCtx = tempCanvas.getContext('2d');
                tempCtx.putImageData(currentImgData, 0, 0);
                
                const imageBlob = await new Promise(resolve => tempCanvas.toBlob(resolve, 'image/png'));
                
                // Get mask blob if it has constraints
                let maskBlob = null;
                const hasMask = Array.from(maskData).some(val => val !== 0);
                if (hasMask) {
                    maskBlob = await new Promise(resolve => maskCanvas.toBlob(resolve, 'image/png'));
                }

                // Prepare FormData matching the FastAPI REST contract
                const formData = new FormData();
                formData.append('image', imageBlob, 'image.png');
                if (maskBlob) {
                    formData.append('mask', maskBlob, 'mask.png');
                }
                formData.append('width', targetWidth);
                formData.append('height', targetHeight);
                formData.append('forward', isForward ? 'true' : 'false');

                // Call REST API
                const response = await fetch('/api/carve', {
                    method: 'POST',
                    body: formData
                });
                
                if (!response.ok) {
                    const errDetail = await response.json().catch(() => ({ detail: 'Server carving failed' }));
                    throw new Error(errDetail.detail || 'Server carving failed');
                }
                
                const responseBlob = await response.blob();
                
                // Load returned image from server response
                const img = new Image();
                img.onload = function() {
                    currentWidth = img.width;
                    currentHeight = img.height;
                    
                    imageCanvas.width = currentWidth;
                    imageCanvas.height = currentHeight;
                    maskCanvas.width = currentWidth;
                    maskCanvas.height = currentHeight;
                    interactionCanvas.width = currentWidth;
                    interactionCanvas.height = currentHeight;

                    imgCtx.drawImage(img, 0, 0);
                    currentImgData = imgCtx.getImageData(0, 0, currentWidth, currentHeight);
                    
                    // Reset mask after server resizing
                    maskCtx.clearRect(0, 0, currentWidth, currentHeight);
                    maskData = new Float32Array(currentWidth * currentHeight);

                    updateWorkspaceView();
                    updateMetrics();
                    
                    isProcessing = false;
                    progressBarContainer.style.display = 'none';
                    btnRun.textContent = "Run Carving";
                    statusMsgEl.textContent = "Seam carving completed successfully via C++ server.";
                    drawInteractionCanvas();
                };
                img.src = URL.createObjectURL(responseBlob);
                return; // Server completed the request successfully
                
            } catch (err) {
                console.error(err);
                alert("Server-side C++ carving failed: " + err.message + "\nFalling back to client-side JavaScript carving...");
                statusMsgEl.textContent = "Falling back to client-side JS...";
            }
        }

        while ((currentWidth > targetWidth || currentHeight > targetHeight) && !shouldStop) {
            if (currentWidth > targetWidth) {
                const seam = findVerticalSeam(currentWidth, currentHeight, currentImgData, maskData, isForward);
                
                if (animate && showSeamsEl.checked) {
                    drawVerticalSeamOverlay(seam);
                    await new Promise(resolve => setTimeout(resolve, 100 - speed));
                }

                carveVertical(seam);
                
                if (animate) {
                    updateWorkspaceView();
                    updateMetrics();
                    updateProgress();
                } else {
                    completedSteps++;
                }
            }

            if (currentHeight > targetHeight && !shouldStop) {
                const seam = findHorizontalSeam(currentWidth, currentHeight, currentImgData, maskData, isForward);

                if (animate && showSeamsEl.checked) {
                    drawHorizontalSeamOverlay(seam);
                    await new Promise(resolve => setTimeout(resolve, 100 - speed));
                }

                carveHorizontal(seam);
                
                if (animate) {
                    updateWorkspaceView();
                    updateMetrics();
                    updateProgress();
                } else {
                    completedSteps++;
                }
            }

            // Yield control back to browser briefly
            if (animate) {
                await new Promise(resolve => requestAnimationFrame(resolve));
            }
        }

        if (!animate) {
            updateWorkspaceView();
            updateMetrics();
        }

        isProcessing = false;
        progressBarContainer.style.display = 'none';
        btnRun.textContent = "Run Carving";
        drawInteractionCanvas();

        if (currentWidth === targetWidth && currentHeight === targetHeight) {
            statusMsgEl.textContent = "Seam carving completed successfully.";
        } else {
            statusMsgEl.textContent = "Seam carving paused.";
        }
    }

    btnRun.addEventListener('click', () => {
        if (isProcessing) {
            shouldStop = true;
            isProcessing = false;
            btnRun.textContent = "Run Carving";
        } else {
            runCarvingProcess();
        }
    });

    btnReset.addEventListener('click', resetWorkspace);

    btnDownload.addEventListener('click', () => {
        if (!currentImgData) return;
        
        // Put final output color image data on helper canvas to download
        const downloadCanvas = document.createElement('canvas');
        downloadCanvas.width = currentWidth;
        downloadCanvas.height = currentHeight;
        const dlCtx = downloadCanvas.getContext('2d');
        dlCtx.putImageData(currentImgData, 0, 0);

        const link = document.createElement('a');
        link.download = 'carved_image.png';
        link.href = downloadCanvas.toDataURL('image/png');
        link.click();
    });
});
