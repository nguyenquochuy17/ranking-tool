const express = require("express");
const multer = require("multer");
const path = require("path");
const render = require("./render");
const processImage = require("./processImage");
require("dotenv").config();
const app = express();

app.use(express.static(__dirname));

const upload = multer({
  dest: "uploads/"
});

// =============================
// HOME
// =============================

app.get("/", (req, res) => {

  res.sendFile(
    path.join(__dirname, "index.html")
  );

});

// =============================
// RENDER
// =============================

app.post(
  "/render",
  upload.array("images"),
  async (req, res) => {

    try {

      const files = req.files;

      const texts =
        Array.isArray(req.body.texts)
          ? req.body.texts
          : [req.body.texts];

      // =========================
      // PROCESS IMAGES
      // =========================

      const processedItems = [];

      for (let i = 0; i < files.length; i++) {

        const processedImage =
          await processImage(
            files[i].path
          );

      processedItems.push({
  image: processedImage,
  text: texts[i]
});

      }

      // =========================
      // RENDER VIDEO
      // =========================

      const result = await render({
        background: "background.png",
        startRank: 10,
        endRank: 10 - processedItems.length + 1,
        items: processedItems
      });

      res.json({
        success: true,
        video: result.url
      });

    } catch (err) {

      console.error(
        "SERVER ERROR:",
        err
      );

      res.status(500).json({
        error: err.message
      });

    }

  }
);

// =============================
// START SERVER
// =============================

app.listen(3000, () => {

  console.log(
    "Server running:"
  );

  console.log(
    "http://localhost:3000"
  );

});