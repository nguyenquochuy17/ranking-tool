const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const path = require("path");
const fs = require("fs");

ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * FIX WINDOWS FONT PATH
 */
function fixFontPath(p) {
  return p
    .replace(/\\/g, "/")
    .replace(":", "\\:");
}

/**
 * FONT
 */
const FONT = fixFontPath(
  path.resolve("fonts/Montserrat-Bold.ttf")
);

/**
 * SAFE TEXT
 */
function safeText(text) {

  if (!text) return "";

  return text
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

/**
 * BUILD RANKS
 */
function buildRanks(start, end) {

  const arr = [];

  for (let i = start; i >= end; i--) {
    arr.push(i);
  }

  return arr;
}

/**
 * MAIN RENDER
 */
function render(data) {

  return new Promise((resolve, reject) => {

    try {

      const {
        background = "background.png",
        startRank = 10,
        endRank = 7,
        items = []
      } = data;

      if (!items.length) {
        throw new Error("No items");
      }

      const width = 1280;
      const height = 720;

      const barHeight = 120;

      const ranks = buildRanks(
        startRank,
        endRank
      );

      /**
       * KEEP ORIGINAL SPACING
       */
      const spacing =
        width / ranks.length;

      const bgPath = path.resolve(background);

      if (!fs.existsSync(bgPath)) {
        throw new Error("Background not found");
      }

      // TOTAL VIDEO DURATION
      const duration =
        items.length * 8 + 3;

      let filters = [];

      // ====================================
      // BACKGROUND
      // ====================================

      filters.push(
        `[0:v]scale=${width}:${height}[bg]`
      );

      let last = "[bg]";

      // ====================================
      // DARK BAR
      // ====================================

      filters.push(
        `${last}drawbox=` +
        `x=0:` +
        `y=${height - barHeight}:` +
        `w=${width}:` +
        `h=${barHeight}:` +
        `color=black@0.85:` +
        `t=fill[bar]`
      );

      last = "[bar]";

      // ====================================
      // RANK LABEL
      // ====================================

      filters.push(
        `${last}drawtext=` +
        `text='RANK':` +
        `fontfile='${FONT}':` +
        `x=40:` +
        `y=${height - 82}:` +
        `fontsize=64:` +
        `fontcolor=white:` +
        `borderw=2:` +
        `bordercolor=black` +
        `[label]`
      );

      last = "[label]";

      // ====================================
      // RANK COLUMNS
      // ====================================

      ranks.forEach((rank, i) => {

        /**
         * KEEP ORIGINAL POSITION
         */
        const centerX = Math.floor(
          i * spacing + spacing / 2
        );

        const line = `[line${i}]`;
        const num = `[num${i}]`;

        // vertical line
        filters.push(
          `${last}drawbox=` +
          `x=${centerX}:` +
          `y=0:` +
          `w=4:` +
          `h=${height - barHeight}:` +
          `color=black:` +
          `t=fill${line}`
        );

        // rank number
        filters.push(
          `${line}drawtext=` +
          `text='${rank}':` +
          `fontfile='${FONT}':` +
          `x=${centerX}-text_w/2:` +
          `y=${height - 88}:` +
          `fontsize=64:` +
          `fontcolor=white:` +
          `borderw=3:` +
          `bordercolor=black` +
          `${num}`
        );

        last = num;

      });

      // ====================================
      // ITEMS
      // ====================================

      items.forEach((item, i) => {

        /**
         * KEEP ORIGINAL POSITION
         */
        const centerX = Math.floor(
          i * spacing + spacing / 2
        );

        /**
         * IMAGE SIZE
         */
        const imageSize = 260;

        const finalX =
          centerX - imageSize / 2;

        /**
         * LOWER IMAGE
         */
        const finalY =
          height - barHeight - 250;

        /**
         * SLIDE START
         */
        const startY =
          finalY + 120;

        // =================================
        // TIMELINE
        // =================================

        const blockStart = i * 8;

        const imageStart = blockStart;

        const imageAnimEnd =
          imageStart + 0.5;

        // TEXT STARTS AFTER IMAGE
        const textStart =
          imageStart + 3;

        // TEXT EFFECT FOR 5S
        const textEnd =
          textStart + 5;

        const img = `[img${i}]`;
        const txt = `[txt${i}]`;

        // =================================
        // SCALE IMAGE
        // =================================

        filters.push(
          `[${i + 1}:v]scale=${imageSize}:${imageSize}[i${i}]`
        );

        // =================================
        // IMAGE SLIDE UP
        // =================================

        filters.push(
          `${last}[i${i}]overlay=` +

          `${finalX}:` +

          `y='if(lt(t,${imageStart}),${startY},if(lt(t,${imageAnimEnd}),${startY}-(t-${imageStart})*240,${finalY}))':` +

          `enable='gte(t,${imageStart})'` +

          `${img}`
        );

        // =================================
        // TEXT EFFECT
        // =================================

        filters.push(
          `${img}drawtext=` +

          `text='${safeText(item.text)}':` +

          `fontfile='${FONT}':` +

          // CENTER TEXT
          `x=${centerX}-text_w/2:` +

          // FLOATING MOTION
          `y='${finalY - 30}+sin((t-${textStart})*3)*8':` +

          // FONT SIZE
          `fontsize=30:` +

          // TEXT STYLE
          `fontcolor=black:` +

          `borderw=5:` +
          `bordercolor=white@0.8:` +

          `shadowx=0:` +
          `shadowy=0:` +
          `shadowcolor=black@0.8:` +

          // FADE IN
          `alpha='if(lt(t,${textStart}),0,if(lt(t,${textStart + 0.5}),(t-${textStart})/0.5,1))':` +

          `enable='between(t,${textStart},${textEnd})'` +

          `${txt}`
        );

        last = txt;

      });

      // ====================================
      // OUTPUT
      // ====================================

      const output =
        `output_${Date.now()}.mp4`;

      let cmd = ffmpeg()
        .input(bgPath)
        .inputOptions(["-loop 1"]);

      items.forEach((item) => {

        cmd = cmd.input(
          path.resolve(item.image)
        );

      });

      cmd
        .complexFilter(filters)

        .outputOptions([
          "-map", last,
          "-pix_fmt", "yuv420p",
          "-r", "30",
          "-t", duration
        ])

        .on("start", (cmdLine) => {

          console.log("\nFFmpeg:\n");
          console.log(cmdLine);
          console.log("\n");

        })

        .on("end", () => {

          console.log("DONE:", output);

          resolve({
            url: output
          });

        })

        .on("error", (err) => {

          console.error("ERROR:", err);

          reject(err);

        })

        .save(output);

    } catch (err) {

      reject(err);

    }

  });

}

module.exports = render;