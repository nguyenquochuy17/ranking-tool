const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const path = require("path");
const fs = require("fs");

ffmpeg.setFfmpegPath(ffmpegPath);

function fixFontPath(p) {
  return p
    .replace(/\\/g, "/")
    .replace(":", "\\:");
}

const FONT = fixFontPath(
  path.resolve("fonts/Montserrat-Bold.ttf")
);

function safeText(text) {

  if (!text) return "";

  return text
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

function render(data) {

  return new Promise((resolve, reject) => {

    const {
      background = "background.png",
      items = []
    } = data;

    const width = 1280;
    const height = 720;

    const filters = [];

    filters.push(
      `[0:v]scale=${width}:${height}[bg]`
    );

    let last = "[bg]";

    const spacing =
      width / items.length;

    items.forEach((item, i) => {

      const centerX =
        i * spacing + spacing / 2;

      const size = 320;

      const x =
        centerX - size / 2;

      const y =
        250;

      const glowInput =
        i * 2 + 1;

      const charInput =
        i * 2 + 2;

      // ====================
      // GLOW
      // ====================

      filters.push(
        `[${glowInput}:v]scale=${size}:${size}[g${i}]`
      );

      filters.push(
        `${last}[g${i}]overlay=${x}:${y}[glow${i}]`
      );

      // ====================
      // CHARACTER
      // ====================

      filters.push(
        `[${charInput}:v]scale=${size}:${size}[c${i}]`
      );

      filters.push(
        `[glow${i}][c${i}]overlay=${x}:${y}[char${i}]`
      );

      // ====================
      // TEXT
      // ====================

      filters.push(
        `[char${i}]drawtext=` +
        `text='${safeText(item.text)}':` +
        `fontfile='${FONT}':` +
        `x=${centerX}-text_w/2:` +
        `y=${y - 40}:` +
        `fontsize=34:` +
        `fontcolor=white:` +
        `borderw=4:` +
        `bordercolor=black` +
        `[txt${i}]`
      );

      last = `[txt${i}]`;

    });

    const output =
      `output_${Date.now()}.mp4`;

    let cmd = ffmpeg()
      .input(background)
      .inputOptions(["-loop 1"]);

    // glow + silhouette
    items.forEach((item) => {

      cmd = cmd.input(item.glow);
      cmd = cmd.input(item.image);

    });

    cmd
      .complexFilter(filters)
      .outputOptions([
        "-map", last,
        "-pix_fmt", "yuv420p",
        "-t", "10"
      ])
      .on("end", () => {

        resolve({
          url: output
        });

      })
      .on("error", reject)
      .save(output);

  });

}

module.exports = render;