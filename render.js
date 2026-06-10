const ffmpeg = require("fluent-ffmpeg");
const path = require("path");

function render(data, output) {

  return new Promise((resolve, reject) => {

    /*
    VALIDATE
    */
    if (!Array.isArray(data)) {
      reject(new Error("data must be array"));
      return;
    }

    const command = ffmpeg();

    /*
    WINDOWS FFMPEG FONT PATH
    */
    const fontPath =
      "D:/RankingTool/ranking-tool/fonts/Montserrat-Bold.ttf";

    /*
    BACKGROUND
    */
    command.input(path.join(__dirname, "background.png"));

    /*
    ADD IMAGES
    */
    data.forEach((item) => {

      if (!item.processedImage) return;
      if (!item.originalImage) return;

      command.input(item.processedImage);
      command.input(item.originalImage);

    });

    const filters = [];

    /*
    BG
    */
    filters.push(
      `[0:v]scale=1280:720[bg]`
    );

    /*
    BOTTOM BAR
    */
    filters.push(
      `[bg]drawbox=x=0:y=600:w=1280:h=120:color=black@0.85:t=fill[bar]`
    );

    /*
    TITLE
    */
    filters.push(
      `[bar]drawtext=text="RANK":fontfile="${fontPath}":x=40:y=638:fontsize=64:fontcolor=white:borderw=2:bordercolor=black[base]`
    );

    let previous = "base";

    /*
    BOTTOM BAR LAYOUT
    "RANK" label takes the left side, the remaining width
    is divided equally between all rank numbers.
    */
    const barWidth = 1280;
    const labelWidth = 240; // space reserved for "RANK" text
    const slotWidth = (barWidth - labelWidth) / data.length;

    data.forEach((item, index) => {

      const xCenter = 640;
      const imageX = 510;

      const start = index * 13;

      /*
      CENTER OF THIS RANK'S SLOT IN THE BOTTOM BAR
      */
      const slotCenter = Math.round(labelWidth + slotWidth * index + slotWidth / 2);

      /*
      INPUT INDEXES
      */
      const processedInput = index * 2 + 1;
      const originalInput = index * 2 + 2;

      /*
      CENTER LINE
      */
      filters.push(
        `[${previous}]drawbox=x=${xCenter}:y=0:w=4:h=600:color=black:t=fill[line${index}]`
      );

      /*
      NUMBER
      */
      filters.push(
        `[line${index}]drawtext=text="${item.rank ?? 10 - index}":fontfile="${fontPath}":x=${slotCenter}-text_w/2:y=632:fontsize=64:fontcolor=white:borderw=3:bordercolor=black[num${index}]`
      );

      /*
      REMOVE WHITE BACKGROUND
      */
      filters.push(
        `[${processedInput}:v]format=rgba,colorkey=0xFFFFFF:0.35:0.15,scale=260:260[cut${index}]`
      );

      /*
      SHOW CUT IMAGE
      */
      filters.push(
        `[num${index}][cut${index}]overlay=x=${imageX}:y=350:enable="between(t,${start},${start + 13})"[img${index}]`
      );

      /*
      TEXT
      */
      filters.push(
        `[img${index}]drawtext=text="${item.name.replace(/[\\"']/g, c => c === '"' ? '\\"' : "\\'")}":fontfile="${fontPath}":x=${xCenter}-text_w/2:y=295:fontsize=30:fontcolor=black:borderw=5:bordercolor=white:enable="between(t,${start},${start + 13})"[text${index}]`
      );

      /*
      ORIGINAL IMAGE
      */
      filters.push(
        `[${originalInput}:v]scale=280:280[orig${index}]`
      );

      /*
      SHOW ORIGINAL IMAGE
      ABOVE TEXT
      */
      filters.push(
        `[text${index}][orig${index}]overlay=x=${xCenter - 140}:y=20:enable="between(t,${start + 8},${start + 13})"[final${index}]`
      );

      previous = `final${index}`;

    });

    /*
    FINAL FILTER
    */
    const filterComplex = filters.join(";");

    console.log("\nFFmpeg:\n");
    console.log(filterComplex);

    /*
    OUTPUT
    */
    command
      .inputOptions([
        "-loop 1"
      ])

      .outputOptions([
        "-filter_complex", filterComplex,
        "-map", `[${previous}]`,
        "-pix_fmt", "yuv420p",
        "-r", "30",
        "-t", String(data.length * 13)
      ])

      .save(output)

      .on("end", () => {

        console.log("DONE:", output);
        resolve(output);

      })

      .on("error", (err) => {

        console.log("FFMPEG ERROR:", err.message);
        reject(err);

      });

  });

}

module.exports = render;
