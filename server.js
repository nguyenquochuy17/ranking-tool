const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const { processImage, processIcon, createBlankIcon } = require("./processImage");
const render = require("./render");

const app = express();
app.use(express.json());

// Serve static files AND the output directory
app.use(express.static(__dirname));
app.use("/output", express.static(path.join(__dirname, "output")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Ensure required dirs exist
["uploads", "output"].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

const upload = multer({ dest: "uploads/" });

// Use upload.any() so we can accept dynamic per-item icon field names
// (icon_0, icon_1, ...) alongside the repeated "images" field.
app.post("/render", upload.any(), async (req, res) => {
  try {
    const allFiles = req.files || [];
    const imageFiles = allFiles.filter(f => f.fieldname === "images");

    if (!imageFiles.length) {
      return res.status(400).json({ success: false, error: "Upload at least one image" });
    }

    const itemsMeta = JSON.parse(req.body.items || "[]");
    const items = [];

    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      const meta = itemsMeta[i] || {};

      console.log(`[server] Processing image ${i + 1}/${imageFiles.length}: ${file.originalname}`);
      const processedImage = await processImage(file.path);

      // Per-item icon, sent under a unique field name (icon_0, icon_1, ...)
      const iconFile = allFiles.find(f => f.fieldname === `icon_${i}`);
      let iconImage;
      if (iconFile) {
        console.log(`[server]   + icon: ${iconFile.originalname}`);
        iconImage = await processIcon(iconFile.path);
      } else {
        iconImage = await createBlankIcon();
      }

      items.push({
        name: meta.name || `Item ${i + 1}`,
        title: meta.title || "",
        description: meta.description || "",
        rank: parseInt(meta.rank, 10) || (imageFiles.length - i),
        processedImage,
        originalImage: file.path,
        iconImage,
      });
    }

    // Sort descending (highest rank first)
    items.sort((a, b) => b.rank - a.rank);

    const filename = `output_${Date.now()}.mp4`;
    const outputPath = path.join(__dirname, "output", filename);

    console.log(`[server] Starting render → ${outputPath}`);
    await render(items, outputPath);

    res.json({
      success: true,
      video: filename,
      url: `/output/${filename}`,
    });

  } catch (err) {
    console.error("SERVER ERROR:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(3000, () => {
  console.log("Server running: http://localhost:3000");
});