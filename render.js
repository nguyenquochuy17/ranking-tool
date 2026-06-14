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

// Escape a user string for safe use inside an ffmpeg drawtext "text=" value.
// Also converts a literal "\n" (typed by the user) into a real line break.
function escText(s, maxLen = 60) {
  return (s || "")
    .substring(0, maxLen)
    .replace(/\\n/g, "\n")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:");
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

    // ── Bottom bar ──────────────────────────────────────────────────────
    const BAR_H = 100;
    const BAR_Y = H - BAR_H;
    const LABEL_W = 180;
    const slotW = (W - LABEL_W) / n;
    const FONT_SIZE = 52;
    const textY = BAR_Y + Math.round((BAR_H - FONT_SIZE) / 2) - 4;

    // ── No-bg image (character silhouette) ────────────────────────────
    const IMG_W = Math.max(80, Math.min(260, Math.floor(slotW * 0.9)));
    const IMG_H = Math.round(IMG_W * 1.35);

    const IMG_TOP_Y = BAR_Y - IMG_H - (-60);

    // ── Original image (crossfades on top of silhouette) ──────────────
    const ORIG_W = Math.round(IMG_W * 0.85);
    const ORIG_H = Math.round(IMG_H * 0.85);
    const ORIG_TOP_Y = IMG_TOP_Y - ORIG_H - (-10);

    // ── Name text (above the silhouette) ───────────────────────────────
    const TEXT_FONT = Math.max(16, Math.min(26, Math.floor(IMG_W * 0.12)));
    const TEXT_Y = IMG_TOP_Y - TEXT_FONT - (-20);

    // ── The vertical black box above "RANK", and its inner layout ──────
    // Box spans x:0..LABEL_W, y:RANK_BOX_TOP..BAR_Y (bottom flush with bar)
    const RANK_BOX_TOP = IMG_TOP_Y - 60 - 160;
    const RANK_BOX_H   = IMG_H + 160;
    const RBOX_CENTER_X = LABEL_W / 2;

    // Title — top of the box
    const RBOX_TITLE_FONT = 22;
    const RBOX_TITLE_Y = RANK_BOX_TOP + 35;

    // Icon — middle of the box, bigger
    const RBOX_ICON_SIZE = Math.min(LABEL_W - 30, Math.round(RANK_BOX_H * 0.45));
    const RBOX_ICON_X = Math.round(RBOX_CENTER_X - RBOX_ICON_SIZE / 2);
    const RBOX_ICON_Y = Math.round(RANK_BOX_TOP + RANK_BOX_H * 0.35 - RBOX_ICON_SIZE / 2);

    // Description — bottom of the box
    const RBOX_DESC_FONT = 18;
    const RBOX_DESC_Y = RANK_BOX_TOP + RANK_BOX_H - 200;

    // Animation duration in seconds (how long the slide/fade takes)
    const ANIM_DUR = 0.5;

    const SEG = 15;
    const totalDuration = n * SEG;

    const command = ffmpeg();
    command
      .input(path.join(__dirname, "background.png"))
      .inputOptions(["-loop", "1"]);

    // 3 inputs per item: no-bg (cut), original, icon
    sorted.forEach(item => {
      command.input(item.processedImage);
      command.input(item.originalImage);
      command.input(item.iconImage);
    });

    const filters = [];
    filters.push(`[0:v]scale=${W}:${H}[bg]`);

    let prev = "bg";

    sorted.forEach((item, idx) => {
      const cutInput  = idx * 3 + 1;
      const origInput = idx * 3 + 2;
      const iconInput = idx * 3 + 3;

      const tStart   = idx * SEG;
      const tEnd     = totalDuration;
      const tTextIn  = tStart + 5;
      const tTextOut = tStart + 10;
      const tOrigIn  = tStart + 10;
      const tOrigOut = tStart + 15;

      // Animation end times
      const tCutAnimEnd  = tStart + ANIM_DUR;
      const tOrigAnimEnd = tOrigIn + ANIM_DUR;

      // Shared fade-in/fade-out alpha expression for the "text reveal" window
      // (used by Name, Title, and Description — same animation, same timing)
      const textAlpha =
        `if(lt(t,${tTextIn}),0,` +
        `if(lt(t,${tTextIn + ANIM_DUR}),(t-${tTextIn})/${ANIM_DUR},` +       // fade in
        `if(lt(t,${tTextOut - ANIM_DUR}),1,` +
        `if(lt(t,${tTextOut}),(${tTextOut}-t)/${ANIM_DUR},0))))`;             // fade out

      const rank = item.rank;
      const safeName  = escText(item.name, 60);
      const safeTitle = escText(item.title, 40);
      const safeDesc  = escText(item.description, 80);

      const slotCenterX = Math.round(LABEL_W + slotW * idx + slotW / 2);
      const imgX  = Math.round(slotCenterX - IMG_W / 2);
      const origX = Math.round(slotCenterX - ORIG_W / 2);

      // ── Scale images ────────────────────────────────────────────────
      filters.push(scalePad(`${cutInput}:v`, `cutScaled${idx}`, IMG_W, IMG_H));
      // Turn the cutout into a solid black silhouette (keeps alpha/shape, zeroes RGB)
      filters.push(`[cutScaled${idx}]lutrgb=r=0:g=0:b=0[cut${idx}]`);
      filters.push(scalePad(`${origInput}:v`, `orig${idx}`, ORIG_W, ORIG_H));
      filters.push(scalePad(`${iconInput}:v`, `rboxIconScaled${idx}`, RBOX_ICON_SIZE, RBOX_ICON_SIZE));

      // ── Bottom bar ──────────────────────────────────────────────────
      filters.push(
        `[${prev}]drawbox=x=0:y=${BAR_Y}:w=${W}:h=${BAR_H}:color=black@0.85:t=fill[bar${idx}]`
      );
      filters.push(
        `[bar${idx}]drawtext=text='RANK'${fa}:x=20:y=${textY}:fontsize=${FONT_SIZE}:fontcolor=white:borderw=2:bordercolor=black[rl${idx}]`
      );

      // Black box above the "RANK" label
      filters.push(
        `[rl${idx}]drawbox=x=0:y=${RANK_BOX_TOP}:w=${LABEL_W}:h=${RANK_BOX_H}:color=black@0.85:t=fill[rankBox${idx}]`
      );

      // Border line between the bottom bar and the black box above it
      filters.push(
        `[rankBox${idx}]drawbox=x=0:y=${BAR_Y}:w=${LABEL_W}:h=2:color=white@0.3:t=fill[rankBoxBorder${idx}]`
      );

      let pf = `rankBoxBorder${idx}`;

      // ── Title (top of box) — fades with this item's Name text ────────
      filters.push(
        `[${pf}]drawtext=text='${safeTitle}'${fa}:` +
        `x=${RBOX_CENTER_X}-text_w/2:y=${RBOX_TITLE_Y}:` +
        `fontsize=${RBOX_TITLE_FONT}:fontcolor=#FFD700:borderw=2:bordercolor=black:` +
        `alpha='${textAlpha}':` +
        `enable='between(t,${tTextIn},${tTextOut})'[rboxTitle${idx}]`
      );
      pf = `rboxTitle${idx}`;

      // ── Icon (middle of box, bigger) — same window as Name text ──────
      filters.push(
        `[${pf}][rboxIconScaled${idx}]overlay=x=${RBOX_ICON_X}:y=${RBOX_ICON_Y}:enable='between(t,${tTextIn},${tTextOut})'[rboxIcon${idx}]`
      );
      pf = `rboxIcon${idx}`;

      // ── Description (bottom of box) — fades with this item's Name text ─
      if (safeDesc) {
        filters.push(
          `[${pf}]drawtext=text='${safeDesc}'${fa}:` +
          `x=${RBOX_CENTER_X}-text_w/2:y=${RBOX_DESC_Y}:` +
          `fontsize=${RBOX_DESC_FONT}:fontcolor=white@0.85:borderw=1:bordercolor=black:` +
          `alpha='${textAlpha}':` +
          `enable='between(t,${tTextIn},${tTextOut})'[rboxDesc${idx}]`
        );
        pf = `rboxDesc${idx}`;
      }

      // ── Rank number row (always visible) ──────────────────────────────
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

      // ── ANIMATION: no-bg slides UP from bar into position ───────────
      const slideDistance = BAR_Y - IMG_TOP_Y;
      const cutYExpr =
        `if(lt(t,${tStart}),${H},` +
        `if(lt(t,${tCutAnimEnd}),` +
          `${BAR_Y}-${slideDistance}*((t-${tStart})/${ANIM_DUR}),` +
          `${IMG_TOP_Y}))`;

      filters.push(
        `[${pf}][cut${idx}]overlay=x=${imgX}:y='${cutYExpr}':enable='between(t,${tStart},${tEnd})'[co${idx}]`
      );

      // ── Name text — fades in/out (same window/animation as Title/Icon/Desc) ─
      filters.push(
        `[co${idx}]drawtext=text='${safeName}'${fa}:` +
        `x=${slotCenterX}-text_w/2:y=${TEXT_Y}:` +
        `fontsize=${TEXT_FONT}:fontcolor=white:borderw=2:bordercolor=black:` +
        `alpha='${textAlpha}':` +
        `enable='between(t,${tTextIn},${tTextOut})'[to${idx}]`
      );

      // ── ANIMATION: original image slides DOWN from above ─────────────
      const origStartY = ORIG_TOP_Y - ORIG_H;
      const origSlide  = ORIG_TOP_Y - origStartY;
      const origYExpr =
        `if(lt(t,${tOrigIn}),${-ORIG_H},` +
        `if(lt(t,${tOrigAnimEnd}),` +
          `${origStartY}+${origSlide}*((t-${tOrigIn})/${ANIM_DUR}),` +
          `${ORIG_TOP_Y}))`;

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