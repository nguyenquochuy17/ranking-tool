const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");

const { processImage, processIcon, createBlankIcon } = require("./processImage");
const render = require("./render");

ffmpeg.setFfmpegPath(ffmpegStatic);

const app = express();
app.use(express.json());

app.use(express.static(__dirname));
app.use("/output", express.static(path.join(__dirname, "output")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

["uploads", "output"].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

const upload = multer({ dest: "uploads/" });

app.post("/render", upload.any(), async (req, res) => {
  const segPaths = [];

  try {
    const allFiles = req.files || [];
    const imageFiles = allFiles.filter(f => f.fieldname === "images");

    if (!imageFiles.length) {
      return res.status(400).json({
        success: false,
        error: "Upload at least one image"
      });
    }

    // Support both old single-section format (items) and new multi-section format (sections)
    let sectionsMeta;

    if (req.body.sections) {
      sectionsMeta = JSON.parse(req.body.sections);
    } else {
      const itemsMeta = JSON.parse(req.body.items || "[]");
      sectionsMeta = [{ items: itemsMeta }];
    }

    let globalIndex = 0;
    const processedSections = [];

    for (const section of sectionsMeta) {
      const sectionItems = [];

      for (const meta of section.items) {
        const file = imageFiles[globalIndex];

        if (!file) {
          globalIndex++;
          continue;
        }

        console.log(
          `[server] Processing image ${globalIndex + 1}/${imageFiles.length}: ${file.originalname}`
        );

        // Optional manually removed background image
        const removedBgFile = allFiles.find(
          f => f.fieldname === `removedBg_${globalIndex}`
        );

        if (removedBgFile) {
          console.log(
            `[server]   + removed background: ${removedBgFile.originalname}`
          );
        }

        const processedImage = await processImage(
          file.path,
          removedBgFile ? removedBgFile.path : null
        );

        // Optional icon
        const iconFile = allFiles.find(
          f => f.fieldname === `icon_${globalIndex}`
        );

        let iconImage;

        if (iconFile) {
          console.log(`[server]   + icon: ${iconFile.originalname}`);
          iconImage = await processIcon(iconFile.path);
        } else {
          iconImage = await createBlankIcon();
        }

        sectionItems.push({
          name: meta.name || `Item ${globalIndex + 1}`,
          title: meta.title || "",
          description: meta.description || "",
          rank:
            parseInt(meta.rank, 10) ||
            imageFiles.length - globalIndex,
          silOffset: parseInt(meta.silOffset, 10) || 0,
          origScale: parseFloat(meta.origScale) || 100,
          subtitleColor: meta.subtitleColor,
          processedImage,
          originalImage: file.path,
          iconImage
        });

        globalIndex++;
      }

      sectionItems.sort((a, b) => b.rank - a.rank);
      processedSections.push(sectionItems);
    }

    const timestamp = Date.now();
    const filename = `output_${timestamp}.mp4`;
    const outputPath = path.join(__dirname, "output", filename);

    if (processedSections.length === 1) {
      console.log("[server] Single section, rendering directly");
      await render(processedSections[0], outputPath);
    } else {
      const segDuration = n => n * 12 + 2.5;

      for (let i = 0; i < processedSections.length; i++) {
        const segPath = path.join(
          __dirname,
          "output",
          `seg_${timestamp}_${i}.mp4`
        );

        segPaths.push(segPath);

        console.log(
          `[server] Rendering section ${i + 1}/${processedSections.length}`
        );

        await render(processedSections[i], segPath);
      }

      console.log(
        `[server] Concatenating ${segPaths.length} segments with fade transitions`
      );

      await concatenateWithFade(
        segPaths,
        processedSections.map(s => segDuration(s.length)),
        outputPath
      );
    }

    res.json({
      success: true,
      video: filename,
      url: `/output/${filename}`
    });

  } catch (err) {
    console.error("SERVER ERROR:", err);

    res.status(500).json({
      success: false,
      error: err.message
    });

  } finally {
    for (const p of segPaths) {
      if (fs.existsSync(p)) {
        fs.unlink(p, () => {});
      }
    }
  }
});

function concatenateWithFade(segPaths, durations, outputPath) {
  return new Promise((resolve, reject) => {
    const FADE = 1.0;

    const cmd = ffmpeg();

    segPaths.forEach(p => cmd.input(p));

    let filterStr = "";
    let accumulated = 0;
    let prevTag = "[0:v]";

    for (let i = 1; i < segPaths.length; i++) {
      const offset =
        accumulated +
        durations[i - 1] -
        FADE * i;

      const nextTag =
        i === segPaths.length - 1
          ? "[vout]"
          : `[v${i}]`;

      filterStr +=
        `${prevTag}[${i}:v]` +
        `xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(3)}` +
        nextTag;

      if (i < segPaths.length - 1) {
        filterStr += ";";
      }

      accumulated += durations[i - 1];
      prevTag = nextTag;
    }

    cmd
      .complexFilter(filterStr)
      .outputOptions([
        "-map [vout]",
        "-pix_fmt yuv420p",
        "-r 30",
        "-c:v libx264",
        "-preset fast",
        "-movflags +faststart"
      ])
      .save(outputPath)
      .on("start", c => {
        console.log(
          "[ffmpeg concat] cmd:",
          c.substring(0, 200) + "..."
        );
      })
      .on("end", () => {
        console.log("[ffmpeg concat] Done");
        resolve();
      })
      .on("error", (err, _out, stderr) => {
        console.error(
          "[ffmpeg concat] ERROR:",
          err.message,
          stderr
        );
        reject(err);
      });
  });
}

app.listen(3000, () => {
  console.log("Server running: http://localhost:3000");
});