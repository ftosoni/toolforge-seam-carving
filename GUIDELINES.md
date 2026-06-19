# Development Guidelines

This document outlines the architectural constraints and development best practices for the Toolforge Seam Carving Utility.

## 🚀 Performance & Client-Side Execution

### 1. Pure Client-Side Computation
The application is deployed on Wikimedia Toolforge as a static/lightweight web app.
- **Canvas Operations**: The Seam Carving algorithm runs directly in the browser via canvas image data manipulation.
- **Memory Footprint**: Keep memory allocations low to avoid crashing mobile browsers. Re-use typed arrays (`Float32Array`, `Int32Array`) where possible.
- **UI Responsiveness**: Large image dimensions can block the main thread. We utilize `requestAnimationFrame` and chunked asynchronous iterations to keep the UI interactive during carving.

## 🛠️ Code & Architecture

### 1. Codex Design System
- The frontend must align with Wikimedia's Codex design principles to feel native to the ecosystem.
- Custom styling should override or extend Codex rules cleanly in `css/style.css`.

### 2. Seam Carving Submodule Consistency
- Keep selectors and options aligned with the parameters available in the C++ CLI submodule (e.g. backward vs. forward energy formulas, green/red pixel protection/removal weights).
