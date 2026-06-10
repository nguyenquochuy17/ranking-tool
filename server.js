const express = require("express");
const multer = require("multer");

const processImage = require("./processImage");
const render = require("./render");

const app = express();

app.use(express.json());

/*
SERVE UI + VIDEOS + FILES
*/
app.use(express.static(__dirname));
app.use(express.static("public"));

/*
HOME ROUTE
*/
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

/*
UPLOAD CONFIG
*/
const upload = multer({
  dest: "uploads/",
});

/*
RENDER API
*/
app.post("/render", upload.array("images"), async (req, res) => {
  try {
    if (!req.files?.length) {
      res.status(400).json({
        success: false,
        error: "Upload at least one image",
      });
      return;
    }

    const itemsMeta = JSON.parse(req.body.items || "[]");
    const items = [];

    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const meta = itemsMeta[i] || {};

      const processedImage = await processImage(file.path);

      items.push({
        name: meta.name || `Item ${i + 1}`,
        rank: parseInt(meta.rank, 10) || req.files.length - i,
        processedImage,
        originalImage: file.path,
      });
    }

    items.sort((a, b) => b.rank - a.rank);

    const output = `output_${Date.now()}.mp4`;

    await render(items, output);

    res.json({
      success: true,
      video: output,
      url: `/${output}`,
    });

  } catch (err) {

    console.log("SERVER ERROR:", err);

    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/*
START SERVER
*/
app.listen(3000, () => {
  console.log("Server running:");
  console.log("http://localhost:3000");
});
