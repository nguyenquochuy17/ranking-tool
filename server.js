const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const processImage = require("./processImage");
const render = require("./render");

const app = express();
app.use(express.json());

// ✅ Serve static files AND the output directory
app.use(express.static(__dirname));
app.use("/output", express.static(path.join(__dirname, "output")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ✅ Ensure required dirs exist
["uploads", "output"].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

const upload = multer({ dest: "uploads/" });

app.post("/render", upload.array("images"), async (req, res) => {
  try {
    if (!req.files?.length) {
      return res.status(400).json({ success: false, error: "Upload at least one image" });
    }

    const itemsMeta = JSON.parse(req.body.items || "[]");
    const items = [];

    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const meta = itemsMeta[i] || {};

      console.log(`[server] Processing image ${i + 1}/${req.files.length}: ${file.originalname}`);
      const processedImage = await processImage(file.path);

      items.push({
        name: meta.name || `Item ${i + 1}`,
        rank: parseInt(meta.rank, 10) || (req.files.length - i),
        processedImage,
        originalImage: file.path,
      });
    }

    // Sort descending (highest rank first)
    items.sort((a, b) => b.rank - a.rank);

    // ✅ FIX: save output to /output/ directory, serve correctly
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
