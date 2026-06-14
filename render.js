const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");
const path = require("path");
const fs = require("fs");

ffmpeg.setFfmpegPath(ffmpegStatic);

function scalePad(inputTag, outputTag, W, H, bgColor = "black@0") {
  return (
    `[${inputTag}]scale=w=${W}:h=${H}:force_original_aspect_ratio=decrease,` +
    `scale=trunc(iw/2)*2:trunc(ih/2)*2,` +
    `pad=${W}:${H}:floor((${W}-iw)/2):floor((${H}-ih)/2):${bgColor}[${outputTag}]`
  );
}

function render(data, output) {
  return new Promise((resolve, reject) => {

    if (!Array.isArray(data) || data.length === 0) {
      return reject(new Error("data must be a non-empty array"));
    }

    const fontPath = (() => {
      const candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "C:/Windows/Fonts/arialbd.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
      ];
      return candidates.find(p => fs.existsSync(p)) || null;
    })();

    const fa = fontPath ? `:fontfile='${fontPath}'` : "";

    const outputDir = path.join(__dirname, "output");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const sorted = [...data].sort((a, b) => b.rank - a.rank);
    const n = sorted.length;

    const W = 1280;
    const H = 720;

    // Bottom bar
    const BAR_H = 100;
    const BAR_Y = H - BAR_H;
    const LABEL_W = 180;
    const slotW = (W - LABEL_W) / n;
    const FONT_SIZE = 52;
    const textY = BAR_Y + Math.round((BAR_H - FONT_SIZE) / 2) - 4;

    // No-bg image
    const IMG_W = Math.max(80, Math.min(260, Math.floor(slotW * 0.9)));
    const IMG_H = Math.round(IMG_W * 1.35);

    const IMG_TOP_Y = BAR_Y - IMG_H - (-60);

    // Original image
    const ORIG_W = Math.round(IMG_W * 0.85);
    const ORIG_H = Math.round(IMG_H * 0.85);
    const ORIG_TOP_Y = IMG_TOP_Y - ORIG_H - (-10);

    // Text
    const TEXT_FONT = Math.max(16, Math.min(26, Math.floor(IMG_W * 0.12)));
    const TEXT_Y = IMG_TOP_Y - TEXT_FONT - (-20);

    // Animation duration in seconds (how long the slide/fade takes)
    const ANIM_DUR = 0.5;

    const SEG = 15;
    const totalDuration = n * SEG;

    const command = ffmpeg();
    command
      .input(path.join(__dirname, "background.png"))
      .inputOptions(["-loop", "1"]);

    sorted.forEach(item => {
      command.input(item.processedImage);
      command.input(item.originalImage);
    });

    const filters = [];
    filters.push(`[0:v]scale=${W}:${H}[bg]`);

    let prev = "bg";

    sorted.forEach((item, idx) => {
      const cutInput  = idx * 2 + 1;
      const origInput = idx * 2 + 2;

      const tStart   = idx * SEG;
      const tEnd     = totalDuration;
      const tTextIn  = tStart + 5;
      const tTextOut = tStart + 10;
      const tOrigIn  = tStart + 10;
      const tOrigOut = tStart + 15;

      // Animation end times
      const tCutAnimEnd  = tStart + ANIM_DUR;
      const tOrigAnimEnd = tOrigIn + ANIM_DUR;

      const rank = item.rank;
      const safeName = item.name
        .substring(0, 28)
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/:/g, "\\:");

      const slotCenterX = Math.round(LABEL_W + slotW * idx + slotW / 2);
      const imgX  = Math.round(slotCenterX - IMG_W / 2);
      const origX = Math.round(slotCenterX - ORIG_W / 2);

      // ── Bottom bar ──────────────────────────────────────────────────
      filters.push(
        `[${prev}]drawbox=x=0:y=${BAR_Y}:w=${W}:h=${BAR_H}:color=black@0.85:t=fill[bar${idx}]`
      );
      filters.push(
        `[bar${idx}]drawtext=text='RANK'${fa}:x=20:y=${textY}:fontsize=${FONT_SIZE}:fontcolor=white:borderw=2:bordercolor=black[rl${idx}]`
      );

      let pf = `rl${idx}`;
      sorted.forEach((other, oi) => {
        const nx = Math.round(LABEL_W + slotW * oi + slotW / 2);
        const divTag = `dv${idx}_${oi}`;
        filters.push(
          `[${pf}]drawbox=x=${Math.round(LABEL_W + slotW * oi)}:y=${BAR_Y}:w=2:h=${BAR_H}:color=white@0.3:t=fill[${divTag}]`
        );
        const numTag = `nm${idx}_${oi}`;
        filters.push(
          `[${divTag}]drawtext=text='${other.rank}'${fa}:x=${nx}-text_w/2:y=${textY}:fontsize=${FONT_SIZE}:fontcolor=white:borderw=2:bordercolor=black[${numTag}]`
        );
        pf = numTag;
      });

      // ── Scale images ────────────────────────────────────────────────
      filters.push(scalePad(`${cutInput}:v`, `cut${idx}`, IMG_W, IMG_H));
      filters.push(scalePad(`${origInput}:v`, `orig${idx}`, ORIG_W, ORIG_H));

      // ── ANIMATION: no-bg slides UP from bar into position ───────────
      // Starts at BAR_Y (behind the bar), eases up to IMG_TOP_Y over ANIM_DUR seconds
      // y = BAR_Y - (BAR_Y - IMG_TOP_Y) * progress   where progress = (t-tStart)/ANIM_DUR clamped 0-1
      const slideDistance = BAR_Y - IMG_TOP_Y;
      const cutYExpr =
        `if(lt(t,${tStart}),${H},` +                                         // hidden before segment
        `if(lt(t,${tCutAnimEnd}),` +
          `${BAR_Y}-${slideDistance}*((t-${tStart})/${ANIM_DUR}),` +         // sliding up
          `${IMG_TOP_Y}))`;                                                    // settled

      filters.push(
        `[${pf}][cut${idx}]overlay=x=${imgX}:y='${cutYExpr}':enable='between(t,${tStart},${tEnd})'[co${idx}]`
      );

      // ── ANIMATION: text fades in at tTextIn, fades out at tTextOut ──
      // ffmpeg drawtext alpha expression: fade in over ANIM_DUR, fade out over ANIM_DUR
      const textAlpha =
        `if(lt(t,${tTextIn}),0,` +
        `if(lt(t,${tTextIn + ANIM_DUR}),(t-${tTextIn})/${ANIM_DUR},` +       // fade in
        `if(lt(t,${tTextOut - ANIM_DUR}),1,` +
        `if(lt(t,${tTextOut}),(${tTextOut}-t)/${ANIM_DUR},0))))`;             // fade out

      filters.push(
        `[co${idx}]drawtext=text='${safeName}'${fa}:` +
        `x=${slotCenterX}-text_w/2:y=${TEXT_Y}:` +
        `fontsize=${TEXT_FONT}:fontcolor=white:borderw=2:bordercolor=black:` +
        `alpha='${textAlpha}':` +
        `enable='between(t,${tTextIn},${tTextOut})'[to${idx}]`
      );

      // ── ANIMATION: original image slides DOWN from above ─────────────
      // Starts ORIG_H px above its final position, slides down over ANIM_DUR
      const origStartY = ORIG_TOP_Y - ORIG_H;   // starts above
      const origSlide  = ORIG_TOP_Y - origStartY; // distance to travel down
      const origYExpr =
        `if(lt(t,${tOrigIn}),${-ORIG_H},` +                                  // hidden above canvas
        `if(lt(t,${tOrigAnimEnd}),` +
          `${origStartY}+${origSlide}*((t-${tOrigIn})/${ANIM_DUR}),` +       // sliding down
          `${ORIG_TOP_Y}))`;                                                   // settled

      filters.push(
        `[to${idx}][orig${idx}]overlay=x=${origX}:y='${origYExpr}':enable='between(t,${tOrigIn},${tOrigOut})'[oo${idx}]`
      );

      prev = `oo${idx}`;
    });

    const filterComplex = filters.join(";");

    console.log("\n[render] Starting ffmpeg...");

    command
      .complexFilter(filterComplex)
      .outputOptions([
        `-map [${prev}]`,
        "-pix_fmt yuv420p",
        "-r 30",
        "-t", String(totalDuration),
        "-c:v libx264",
        "-preset fast",
        "-movflags +faststart",
      ])
      .save(output)
      .on("start", cmd => console.log("[ffmpeg] cmd:", cmd.substring(0, 300) + "..."))
      .on("progress", p => p.percent && process.stdout.write(`\r[ffmpeg] ${Math.round(p.percent)}%`))
      .on("end", () => {
        console.log("\n[render] Done:", output);
        resolve(output);
      })
      .on("error", (err, stdout, stderr) => {
        console.error("\n[ffmpeg] ERROR:", err.message);
        console.error("[ffmpeg] stderr:", stderr);
        reject(err);
      });
  });
}

module.exports = render;