# Toolforge Seam Carving Utility

An interactive web-based **Seam Carving (Content-Aware Image Resizing)** utility built for Wikimedia Toolforge.

This utility allows users to upload images, paint constraints (to protect or remove specific regions), select from standard energy formulas, and run the carving algorithm interactively.

## ✨ Features

- **Standard Seam Carving (Backward Energy)**: Resizes images by finding and removing seams of lowest gradient energy.
- **Improved Seam Carving (Forward Energy)**: Minimizes introduced energy to reduce visual distortion on lines/curves.
- **Constraint Mask Painting**:
  - 🟢 **Protect (Green)**: Assigns positive infinity energy to prevent pixels from being carved.
  - 🔴 **Remove (Red)**: Assigns negative infinity energy to force pixels to be carved first.
  - 🧹 **Erase**: Clears constraints.
- **Grayscale Workspace Toggle**: Paint directly on a high-visibility grayscale representation of the image.
- **Visualizer Mode**: Animate the carving process and highlight active seams in real-time as they are removed.
- **Pure Client-Side Processing**: Runs entirely in the browser using HTML5 Canvas, requiring no server-side processing or compilation.

## 🚀 Running Locally

To run the application locally, you can serve the root directory using any static web server:

```bash
# Using Python
python -m http.server 8000
```

Then open `http://localhost:8000` in your web browser.

## 📂 Project Structure

```
toolforge-seam-carving/
├── css/
│   └── style.css      # Custom Codex-compatible interface styling
├── js/
│   └── main.js       # Core Seam Carving algorithm & Canvas logic
├── index.html        # Main landing page & workspace layout
├── Procfile          # Toolforge deployment configuration
├── robots.txt        # Search engine crawler configuration
└── sitemap.xml       # Sitemap configuration
```

## 📄 License
Released under the [Apache 2.0 License](./LICENCE.txt).
