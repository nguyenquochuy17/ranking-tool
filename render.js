const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");
const path = require("path");
const fs = require("fs");

ffmpeg.setFfmpegPath(ffmpegStatic);

function splitHtmlTags(str) {
  // Matches text BEFORE <b>, the text INSIDE <b></b>, and everything AFTER </b>
  const match = str.match(/^([\s\S]*?)<b>([\s\S]*?)<\/b>([\s\S]*)$/i);
  if (match) {
    return {
      before: match[1],
      boldText: match[2],
      after: match[3]
    };
  }
  return null;
}
function scalePad(inputTag, outputTag, W, H, bgColor = "black@0") {
  return (
    `[${inputTag}]scale=w=${W}:h=${H}:force_original_aspect_ratio=decrease,` +
    `scale=trunc(iw/2)*2:trunc(ih/2)*2,` +
    `pad=${W}:${H}:floor((${W}-iw)/2):floor((${H}-ih)/2):${bgColor}[${outputTag}]`
  );
}

function escText(s, maxLen = 60) {
  return (s || "")
    .substring(0, maxLen)
    .replace(/\\n/g, "\n")
    // ASCII apostrophe breaks ffmpeg quoting on Windows; U+2019 renders the same.
    .replace(/'/g, "\u2019");
}

function quoteFilterText(s) {
  return `'${String(s || "")
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")}'`;
}

function estimateTextWidth(str, fontSize) {
  return str.length * fontSize * 0.62;
}

function splitLongWord(word, fontSize, maxWidth) {
  const chunks = [];
  let current = "";
  for (const ch of word) {
    const test = current + ch;
    if (current && estimateTextWidth(test, fontSize) > maxWidth) {
      chunks.push(current);
      current = ch;
    } else {
      current = test;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function wrapText(text, fontSize, maxWidth) {
  if (!text) return text;
  const lines = text.split("\n");
  const wrapped = [];
  for (const line of lines) {
    const words = line.split(/\s+/).filter(Boolean);
    let current = "";
    for (const word of words) {
      const parts = estimateTextWidth(word, fontSize) > maxWidth
        ? splitLongWord(word, fontSize, maxWidth)
        : [word];

      for (const part of parts) {
        const test = current ? `${current} ${part}` : part;
        if (estimateTextWidth(test, fontSize) > maxWidth && current) {
          wrapped.push(current);
          current = part;
        } else {
          current = test;
        }
      }
    }
    if (current) wrapped.push(current);
  }
  return wrapped.join("\n");
}

function clampWrappedText(text, fontSize, maxWidth, maxLines) {
  const wrapped = wrapText(text, fontSize, maxWidth);
  const lines = wrapped ? wrapped.split("\n") : [];
  if (lines.length <= maxLines) return wrapped;

  const kept = lines.slice(0, maxLines);
  let last = kept[kept.length - 1] || "";
  while (last.length > 3 && estimateTextWidth(`${last}...`, fontSize) > maxWidth) {
    last = last.slice(0, -1);
  }
  kept[kept.length - 1] = `${last}...`;
  return kept.join("\n");
}

function multilineCentered({
  inputTag, text, fa, fontSize, fontcolor, borderw,
  centerX, marginLeft, startY, lineHeight,
  enableExpr, tagPrefix,
}) {
  const lines = (text || "").split("\n");
  const filterStrs = [];
  let pf = inputTag;

  lines.forEach((line, i) => {
    const y = startY + i * lineHeight;
    const tag = `${tagPrefix}${i}`;
    filterStrs.push(
      `[${pf}]drawtext=text=${quoteFilterText(line)}${fa}:` +
      `x=max(${marginLeft}\\,${centerX}-text_w/2):y=${y}:` +
      `fontsize=${fontSize}:fontcolor=${fontcolor}:borderw=${borderw}:bordercolor=black:` +
      `enable='${enableExpr}'[${tag}]`
    );
    pf = tag;
  });

  return { filterStrs, lastTag: pf, lineCount: lines.length };
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

    // ── Original image (Resized to 2/5 width and 1.5/3 height of screen) ──
    const ORIG_W = 512; // 2/5 of 1280
    const ORIG_H = 330; // 1.5/3 (half) of 720
    const ORIG_TOP_Y = IMG_TOP_Y - ORIG_H - (-10);

    // ── Name text (above the silhouette) ─────────────────────────────
    const TEXT_FONT = Math.max(16, Math.min(26, Math.floor(IMG_W * 0.12)));
    const TEXT_Y = IMG_TOP_Y - TEXT_FONT - (-20);

    // ── The vertical black box above "RANK" ──────────────────────────
    const RANK_BOX_TOP = IMG_TOP_Y - 60 - 160;
    const RANK_BOX_H   = IMG_H + 160;
    const RBOX_CENTER_X = LABEL_W / 2;

    const RBOX_TEXT_MARGIN = 2;
    const RBOX_CONTENT_W = LABEL_W - RBOX_TEXT_MARGIN * 2 + 15;

    const RBOX_TITLE_FONT = 22;
    const RBOX_TITLE_Y = RANK_BOX_TOP + 35;
    const RBOX_TITLE_ICON_GAP = 15;

    const RBOX_ICON_SIZE = Math.min(LABEL_W - 30, Math.round(RANK_BOX_H * 0.45));
    const RBOX_ICON_X = Math.round(RBOX_CENTER_X - RBOX_ICON_SIZE / 2);

    const RBOX_DESC_FONT = 18;

    const ANIM_DUR = 0.5;

    const SEG = 12;
    const totalDuration = n * SEG + 2.5;

    const command = ffmpeg();
    command
      .input(path.join(__dirname, "background.png"))
      .inputOptions(["-loop", "1"]);

    sorted.forEach(item => {
      command.input(item.processedImage);
      command.input(item.originalImage);
      command.input(item.iconImage).inputOptions(["-loop", "1"]);
    });

    const filters = [];
    filters.push(`[0:v]scale=${W}:${H}[bg]`);

    // ── Static chrome drawn once ─────────────────────────────────────
    filters.push(`[bg]drawbox=x=0:y=${BAR_Y}:w=${W}:h=${BAR_H}:color=black@0.85:t=fill[staticBar]`);
    filters.push(`[staticBar]drawtext=text=${quoteFilterText("RANK")}${fa}:x=20:y=${textY}:fontsize=${FONT_SIZE}:fontcolor=white:borderw=2:bordercolor=black[staticRl]`);
    filters.push(`[staticRl]drawbox=x=0:y=${RANK_BOX_TOP}:w=${LABEL_W}:h=${RANK_BOX_H}:color=black@0.85:t=fill[staticRankBox]`);
    filters.push(`[staticRankBox]drawbox=x=0:y=${BAR_Y}:w=${LABEL_W}:h=2:color=white@0.3:t=fill[staticBase]`);

    let prev = "staticBase";

    sorted.forEach((item, idx) => {
      const cutInput  = idx * 3 + 1;
      const origInput = idx * 3 + 2;
      const iconInput = idx * 3 + 3;

      const tStart   = idx * SEG;
      const tEnd     = totalDuration;
      const tTextIn  = tStart + 3;
      const tTextOut = tStart + 7;
      const tOrigIn  = tStart + 7;
      const tOrigOut = tStart + 12;
      const tBoxOut  = tOrigOut;

      const tCutAnimEnd  = tStart + ANIM_DUR;
      const tOrigAnimEnd = tOrigIn + ANIM_DUR;

      const safeName  = escText(item.name, 60);
      const safeTitle = escText(item.title, 40);
      const safeDesc  = escText(item.description, 120);

      const fittedTitle = clampWrappedText(safeTitle, RBOX_TITLE_FONT, RBOX_CONTENT_W, 3);
      const titleLineHeight = Math.round(RBOX_TITLE_FONT * 1.25);

      // Icon sits a fixed gap below the title bottom
      const titleLineCount = safeTitle ? fittedTitle.split("\n").length : 0;
      const titleBottomY = RBOX_TITLE_Y + titleLineCount * titleLineHeight;
      const iconY = titleBottomY + RBOX_TITLE_ICON_GAP;

      const ICON_DESC_GAP = 40;
      const descY = iconY + RBOX_ICON_SIZE + ICON_DESC_GAP;
      const descLineHeight = Math.round(RBOX_DESC_FONT * 1.25);
      const descMaxLines = Math.max(
        1,
        Math.floor((RANK_BOX_TOP + RANK_BOX_H - descY - 12) / descLineHeight)
      );
      const fittedDesc = clampWrappedText(safeDesc, RBOX_DESC_FONT, RBOX_CONTENT_W, descMaxLines);

      const slotCenterX = Math.round(LABEL_W + slotW * idx + slotW / 2);
      const imgX  = Math.round(slotCenterX - IMG_W / 2);

      // Per-item 
      // Per-item adjustments
      const itemImgTopY = IMG_TOP_Y - (item.silOffset || 0);
      const scale = (item.origScale || 100) / 100;
      
      // Applies your new big base dimensions multiplied by user custom scale factor
      const itemOrigW = Math.round(ORIG_W * scale);
      const itemOrigH = Math.round(ORIG_H * scale);
      
      const itemOrigTopY = 30;
      // ── DYNAMIC RANKING ALIGNMENT LOGIC ──
      let origX;
      
      if (n === 3) {
        // If there are exactly 3 items in the section
        if (idx === 0) {
          // Item 1: Align Left (with a 40px margin from the rank box)
          origX = LABEL_W + 40;
        } else if (idx === 1) {
          // Item 2: Align Center
          origX = Math.round(slotCenterX - itemOrigW / 2);
        } else {
          // Item 3: Align Right (with a 40px margin from the screen edge)
          origX = W - itemOrigW - 40;
        }
      } else if (n === 4) {
        // If there are exactly 4 items in the section
        if (idx === 0 || idx === 1) {
          // Items 1 and 2: Align Left
          origX = LABEL_W + 40;
        } else {
          // Items 3 and 4: Align Right
          origX = W - itemOrigW - 40;
        }
      } else {
        // Fallback default: Center above the character slot if item count is different
        origX = Math.round(slotCenterX - itemOrigW / 2);
      }

      // ── Scale images ────────────────────────────────────────────────
      filters.push(scalePad(`${cutInput}:v`, `cut${idx}`, IMG_W, IMG_H, "black@0"));
      filters.push(scalePad(`${origInput}:v`, `orig${idx}`, itemOrigW, itemOrigH));
      filters.push(scalePad(`${iconInput}:v`, `rboxIconScaled${idx}`, RBOX_ICON_SIZE, RBOX_ICON_SIZE));

      let pf = prev;

      // ── Rank number row (always visible) ─────────────────────────────
      sorted.forEach((other, oi) => {
        const nx = Math.round(LABEL_W + slotW * oi + slotW / 2);
        const divTag = `dv${idx}_${oi}`;
        filters.push(
          `[${pf}]drawbox=x=${Math.round(LABEL_W + slotW * oi)}:y=${BAR_Y}:w=2:h=${BAR_H}:color=white@0.3:t=fill[${divTag}]`
        );
        const numTag = `nm${idx}_${oi}`;
        filters.push(
          `[${divTag}]drawtext=text=${quoteFilterText(String(other.rank))}${fa}:x=${nx}-text_w/2:y=${textY}:fontsize=${FONT_SIZE}:fontcolor=white:borderw=2:bordercolor=black[${numTag}]`
        );
        pf = numTag;
      });

      // ── Title ────────────────────────────────────────────────────────
      {
        const { filterStrs, lastTag } = multilineCentered({
          inputTag: pf,
          text: fittedTitle,
          fa,
          fontSize: RBOX_TITLE_FONT,
          fontcolor: "#FFD700",
          borderw: 2,
          centerX: RBOX_CENTER_X,
          marginLeft: RBOX_TEXT_MARGIN,
          startY: RBOX_TITLE_Y,
          lineHeight: titleLineHeight,
          enableExpr: `between(t,${tTextIn},${tBoxOut})`,
          tagPrefix: `rboxTitle${idx}_`,
        });
        filters.push(...filterStrs);
        pf = lastTag;
      }

      // ── Icon — hide off-screen when outside window (avoids enable= black frames) ──
      const iconYExpr =
        `if(gte(t,${tTextIn})*lte(t,${tBoxOut}),${iconY},${-RBOX_ICON_SIZE - 10})`;
      filters.push(
        `[${pf}][rboxIconScaled${idx}]overlay=x=${RBOX_ICON_X}:y='${iconYExpr}'[rboxIcon${idx}]`
      );
      pf = `rboxIcon${idx}`;

      // ── Description ──────────────────────────────────────────────────
      if (safeDesc) {
        const { filterStrs, lastTag } = multilineCentered({
          inputTag: pf,
          text: fittedDesc,
          fa,
          fontSize: RBOX_DESC_FONT,
          fontcolor: "white",
          borderw: 1,
          centerX: RBOX_CENTER_X,
          marginLeft: RBOX_TEXT_MARGIN,
          startY: descY,
          lineHeight: descLineHeight,
          enableExpr: `between(t,${tTextIn},${tBoxOut})`,
          tagPrefix: `rboxDesc${idx}_`,
        });
        filters.push(...filterStrs);
        pf = lastTag;
      }

      // ── Silhouette slides up from bar ────────────────────────────────
      const slideDistance = BAR_Y - itemImgTopY;
      const cutYExpr =
        `if(lt(t,${tStart}),${H},` +
        `if(lt(t,${tCutAnimEnd}),` +
          `${BAR_Y}-${slideDistance}*((t-${tStart})/${ANIM_DUR}),` +
          `${itemImgTopY}))`;

      filters.push(
        `[${pf}][cut${idx}]overlay=x=${imgX}:y='${cutYExpr}'[co${idx}]`
      );

// ── Name text (HTML Tag Parser Fix - Tight Snap) ─────────────────
      const parsedName = splitHtmlTags(item.name || "");

      if (parsedName) {
        const txtBefore = escText(parsedName.before, 40);
        const txtBold   = escText(parsedName.boldText, 20);
        const txtAfter  = escText(parsedName.after, 40);

        const tagLabel = `nameLabel${idx}`;
        const tagBold  = `nameBold${idx}`;

        // ┌─────────────────── PLACE THE NEW LOGIC HERE ───────────────────┐
        // Count skinny characters vs actual empty space bars
        const spaces      = (txtBefore.match(/ /g) || []).length;
        const punctuation = (txtBefore.match(/[:il1|]/g) || []).length;
        const normalChars = txtBefore.length - spaces - punctuation;
        
        // Precision pixel width tracking (Giving spaces a standard full-width padding weight)
        const preciseWidthBefore = (normalChars * TEXT_FONT * 0.54) + (spaces * TEXT_FONT * 0.35) + (punctuation * TEXT_FONT * 0.25);
        const preciseWidthBold   = txtBold.length * (TEXT_FONT + 2) * 0.6;
        const combinedWidth      = preciseWidthBefore + preciseWidthBold;

        // Establish perfect mathematical midpoint alignment
        const layoutStartX = Math.round(slotCenterX - (combinedWidth / 2));
        const layoutBoldX  = Math.round(layoutStartX + preciseWidthBefore);
        // └─────────────────────────────────────────────────────────────────┘

        // Line 1 Part A: Base Prefix
        filters.push(
          `[co${idx}]drawtext=text=${quoteFilterText(txtBefore)}${fa}:` +
          `x=${layoutStartX}:y=${itemImgTopY - TEXT_FONT - 30}:` +
          `fontsize=${TEXT_FONT}:fontcolor=white:borderw=2:bordercolor=black:` +
          `enable='between(t,${tTextIn},${tTextOut})'[${tagLabel}]`
        );

        // Line 1 Part B: Gold Value locked perfectly flush right next to it
        filters.push(
          `[${tagLabel}]drawtext=text=${quoteFilterText(txtBold)}${fa}:` +
          `x=${layoutBoldX}:y=${itemImgTopY - TEXT_FONT - 32}:` +
          `fontsize=${TEXT_FONT + 2}:fontcolor=0xFFD700:borderw=3:bordercolor=black:` +
          `enable='between(t,${tTextIn},${tTextOut})'[${tagBold}]`
        );

              // Line 2: Subtitle / After text
        if (txtAfter.trim()) {
          const cleanAfter = txtAfter.replace(/^\n/, "");
          
          // Uses the color value passed from server.js, defaults to white
          const subColor = item.subtitleColor || "white";

          filters.push(
            `[${tagBold}]drawtext=text=${quoteFilterText(cleanAfter)}${fa}:` +
            `x=${slotCenterX}-text_w/2:y=${itemImgTopY - 15}:` + 
            `fontsize=${TEXT_FONT}:fontcolor=${subColor}:borderw=2:bordercolor=black:` +
            `enable='between(t,${tTextIn},${tTextOut})'[to${idx}]`
          );
        }
      } else {
        // Fallback standard text processing if no <b> tags were typed in
        const fallbackName = escText(item.name, 60);
        filters.push(
          `[co${idx}]drawtext=text=${quoteFilterText(fallbackName)}${fa}:` +
          `x=${slotCenterX}-text_w/2:y=${itemImgTopY - TEXT_FONT - 30}:` +
          `fontsize=${TEXT_FONT}:fontcolor=white:borderw=2:bordercolor=black:` +
          `enable='between(t,${tTextIn},${tTextOut})'[to${idx}]`
        );
      }
      // ── Original image slides down from above, hides off-screen after window ──
      const origStartY = itemOrigTopY - itemOrigH;
      const origSlide  = itemOrigTopY - origStartY;
      const origYExpr =
        `if(lt(t,${tOrigIn}),${-itemOrigH},` +
        `if(lt(t,${tOrigAnimEnd}),` +
          `${origStartY}+${origSlide}*(1-pow(1-((t-${tOrigIn})/${ANIM_DUR}),3)),` +
          `if(lt(t,${tOrigOut}),${itemOrigTopY},${-itemOrigH})))`;

      filters.push(
        `[to${idx}][orig${idx}]overlay=x=${origX}:y='${origYExpr}'[oo${idx}]`
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
