const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");
const path = require("path");
const fs = require("fs");

ffmpeg.setFfmpegPath(ffmpegStatic);

const opentype = require('opentype.js');

let font;
try {
  // Dynamically resolve Windows Fonts path
  const winDir = process.env.WINDIR || 'C:\\Windows';
  const fontPath = path.join(winDir, 'Fonts', 'arialbd.ttf');

  // Read file to buffer and parse arraybuffer safely
  const fileBuffer = fs.readFileSync(fontPath);
  const arrayBuffer = fileBuffer.buffer.slice(
    fileBuffer.byteOffset, 
    fileBuffer.byteOffset + fileBuffer.byteLength
  );
  font = opentype.parse(arrayBuffer);
  console.log('Successfully loaded Arial Bold font metrics.');
} catch (err) {
  console.warn('Failed to load system font file:', err.message);
}

function getExactTextWidth(text, fontSize) {
  if (font && typeof font.getAdvanceWidth === 'function') {
    return Math.ceil(font.getAdvanceWidth(text, fontSize));
  }
  // Safe emergency fallback estimation if font file is unreadable
  return Math.ceil(text.length * fontSize * 0.55);
}

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
// Reduces multiplier from 0.12 to 0.08
    const TEXT_FONT = Math.max(12, Math.min(20, Math.floor(IMG_W * 0.08)));
    const TEXT_Y = IMG_TOP_Y - TEXT_FONT - (-20);

    // ── The vertical black box above "RANK" ──────────────────────────
    const RANK_BOX_TOP = IMG_TOP_Y - 60 - 160;
    const RANK_BOX_H = IMG_H + 160;
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

    // ── TIMING CHANGE: One segment now lasts 9 seconds total (3s Intro/Name + 2s Image + transition buffer) ──
    const SEG = 9;
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
      const cutInput = idx * 3 + 1;
      const origInput = idx * 3 + 2;
      const iconInput = idx * 3 + 3;

      const tStart = idx * SEG;
      const tEnd = totalDuration;
      const tTextIn = tStart + 3;
      const tTextOut = tStart + 7;
      const tOrigIn = tStart + 7;

      // ── TIMING CHANGE: tOrigOut goes from tStart + 12 to tStart + 9 (Exactly 2 seconds of full-color display) ──
      const tOrigOut = tStart + 9;
      const tBoxOut = tOrigOut;

      const tCutAnimEnd = tStart + ANIM_DUR;
      const tOrigAnimEnd = tOrigIn + ANIM_DUR;

      const safeName = escText(item.name, 60);
      const safeTitle = escText(item.title, 40);
      const safeDesc = escText(item.description, 120);

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
      const imgX = Math.round(slotCenterX - IMG_W / 2);

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
// ── Title (????? -> Slide-Down Reveal + Longer Firework Burst) ──
{
  const origTitleText = fittedTitle;
  const scrambleText = "?????";

  // Phase 1: Display "?????" in default Gold before image drops
  const { filterStrs: scrambleFilters, lastTag: pfScramble } = multilineCentered({
    inputTag: pf,
    text: scrambleText,
    fa,
    fontSize: RBOX_TITLE_FONT,
    fontcolor: "#FFD700",
    borderw: 2,
    centerX: RBOX_CENTER_X,
    marginLeft: RBOX_TEXT_MARGIN,
    startY: RBOX_TITLE_Y,
    lineHeight: titleLineHeight,
    enableExpr: `between(t,${tTextIn},${tOrigIn})`,
    tagPrefix: `rboxTitleQ_${idx}_`,
  });
  filters.push(...scrambleFilters);
  pf = pfScramble;

  // Phase 2: Real Title reveals in default Gold and slides down from above
  const { filterStrs: realFilters, lastTag: pfReal } = multilineCentered({
    inputTag: pf,
    text: origTitleText,
    fa,
    fontSize: RBOX_TITLE_FONT,
    fontcolor: "#FFD700",
    borderw: 2,
    centerX: RBOX_CENTER_X,
    marginLeft: RBOX_TEXT_MARGIN,
    startY: RBOX_TITLE_Y,
    lineHeight: titleLineHeight,
    enableExpr: `between(t,${tOrigIn},${tBoxOut})`,
    tagPrefix: `rboxTitleReal_${idx}_`,
  });

  // Inject 0.3s Slide-Down Motion (drops 35px into position at tOrigIn)
  const slideDur = 0.3;
  const slideDist = 35;

  const animatedRealFilters = realFilters.map(f => {
    return f.replace(/:y=(\d+):/, (match, origYStr) => {
      const origY = Number(origYStr);
      const startY = origY - slideDist;
      return `:y='if(lt(t\\,${tOrigIn + slideDur})\\,${startY}+${slideDist}*((t-${tOrigIn})/${slideDur})\\,${origY})':`;
    });
  });

  filters.push(...animatedRealFilters);
  pf = pfReal;

  // Phase 3: Firework Sparkle Burst around Title
  const tFirework = tOrigIn + slideDur;

  // ⚡ CONTROL FIREWORK DURATION & RADIUS HERE:
  const fwDur = 0.9;     // 👈 Duration in seconds (increased from 0.45 to 0.9s)
  const numSparks = 8;
  const fwRadiusX = 140; // 👈 Horizontal distance (increased to 140px for smoother movement)
  const fwRadiusY = 75;  // 👈 Vertical distance (increased to 75px)

  for (let i = 0; i < numSparks; i++) {
    const angle = (i * 2 * Math.PI) / numSparks;
    const dx = Math.round(Math.cos(angle) * fwRadiusX);
    const dy = Math.round(Math.sin(angle) * fwRadiusY);
    const sparkTag = `fwSpark_${idx}_${i}`;

    const sparkChar = i % 2 === 0 ? "*" : "+";
    const sparkColor = i % 2 === 0 ? "#FFFF00" : "#FFFFFF";

    filters.push(
      `[${pf}]drawtext=text='${sparkChar}':` +
      `fontfile='C:/Windows/Fonts/arialbd.ttf':` +
      `fontsize=38:fontcolor=${sparkColor}:borderw=2:bordercolor=#FF8C00:` +
      `x='${RBOX_CENTER_X} + ${dx}*(t-${tFirework})/${fwDur}-text_w/2':` +
      `y='${RBOX_TITLE_Y} + ${dy}*(t-${tFirework})/${fwDur}-text_h/2':` +
      `alpha='clip(1-(t-${tFirework})/${fwDur}\\,0\\,1)':` +
      `enable='between(t,${tFirework},${tFirework + fwDur})'[${sparkTag}]`
    );
    pf = sparkTag;
  }
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

   // ── Name text (HTML Tag Parser Fix - Dynamic Survival Color) ─────────────
      const parsedName = splitHtmlTags(item.name || "");

      if (parsedName) {
        const cleanBefore = parsedName.before.replace(/\\n/g, "");
        const txtBold = escText(parsedName.boldText, 60);
        
        const normalizedAfter = parsedName.after.replace(/\\n/g, "\n");
        const afterLines = normalizedAfter
          .split("\n")
          .map(l => escText(l.trim(), 40))
          .filter(Boolean);

        // Build allLines array, splitting the Survival line into label + value if it matches
        const allLines = [];
        
        // Line 1: Threat Level
        allLines.push({ type: 'boldPair', text: cleanBefore, boldText: txtBold });

        afterLines.forEach((line, idx) => {
          if (idx === 1 && line.toLowerCase().includes("survival")) {
            // Match pattern like "Survival: 4%" or "Survival: 4"
            const match = line.match(/^([\s\S]*?:\s*)([\d.]+)(%?)$/);
            if (match) {
              allLines.push({
                type: 'splitSurvival',
                label: match[1],       // "Survival: " (White)
                valNum: parseFloat(match[2]),
                percentSign: match[3]  // "%"
              });
              return;
            }
          }
          // Default for other lines (e.g. City Destroyed: Tokyo)
          allLines.push({
            type: 'standard',
            text: line,
            color: item.subtitleColor || "white"
          });
        });

        const lineSpacing = TEXT_FONT + 14;
        const totalLinesCount = allLines.length;
        let currentY = itemImgTopY - (totalLinesCount * lineSpacing) + 40;
        let currentPf = `co${idx}`;

        allLines.forEach((itemLine, lineIdx) => {
          const lineTag = `nameLine${idx}_${lineIdx}`;

         if (itemLine.type === 'boldPair') {
  const tagLabel = `nameLabel${idx}`;
  const tagBold = `nameBold${idx}`;

  const rawLabel = itemLine.text;        // e.g. "Solider Number "
  const rawBoldText = itemLine.boldText; // e.g. "1000+"

  const displayLabel = rawLabel.trimEnd();

  // 1. Get exact pixel width from the font file using opentype.js
  const labelWidth = getExactTextWidth(displayLabel, TEXT_FONT);
  const boldWidth = getExactTextWidth(rawBoldText, TEXT_FONT + 2);
  const gapWidth = getExactTextWidth(' ', TEXT_FONT); // Exact width of 1 space

  // 2. Exact component layout
  const totalWidth = labelWidth + gapWidth + boldWidth;
  const startX = Math.round(slotCenterX - (totalWidth / 2));
  const numberX = startX + labelWidth + gapWidth;

  // 3. Escape FFmpeg special characters
  const escapeFFmpegText = (str) => {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "'\\''")
      .replace(/:/g, '\\:')
      .replace(/%/g, '%%');
  };

  const cleanBoldText = rawBoldText.trim().replace(/&plus;/g, '+').replace(/&#43;/g, '+');
  const numMatch = cleanBoldText.match(/^([^\d]*)([\d,]+)(.*)$/);

  let textExpression;

  if (numMatch) {
    const prefix = escapeFFmpegText(numMatch[1] || "");
    const targetVal = parseInt(numMatch[2].replace(/,/g, ''), 10);
    const suffix = escapeFFmpegText(numMatch[3] || "");
    const counterDur = 0.8;

    textExpression = `'${prefix}%{eif\\:trunc(clip((t-${tTextIn})*${targetVal}/${counterDur}\\,0\\,${targetVal}))\\:d}${suffix}'`;
  } else {
    textExpression = `'${escapeFFmpegText(rawBoldText)}'`;
  }

  // 4. Draw Label ("Solider Number:")
  filters.push(
    `[${currentPf}]drawtext=text='${escapeFFmpegText(displayLabel)}'${fa}:` +
    `x=${startX}:y=${currentY}:` +
    `fontsize=${TEXT_FONT}:fontcolor=white:borderw=2:bordercolor=black:` +
    `enable='between(t,${tTextIn},${tTextOut})'[${tagLabel}]`
  );

  // 5. Draw Value ("1000+") starting exactly 1 space past label
  filters.push(
    `[${tagLabel}]drawtext=text=${textExpression}${fa}:` +
    `x=${numberX}:y=${currentY}:` +
    `fontsize=${TEXT_FONT + 2}:fontcolor=0xFFD700:borderw=3:bordercolor=black:` +
    `enable='between(t,${tTextIn},${tTextOut})'[${tagBold}]`
  );

  currentPf = tagBold;


      } else if (itemLine.type === 'splitSurvival') {
            const val = itemLine.valNum;
            let valColor = "white";
            if (val >= 80 && val <= 100) valColor = "#00FF00";      // Green
            else if (val >= 60 && val <= 79) valColor = "#00FFFF"; // Cyan
            else if (val >= 40 && val <= 59) valColor = "#FFA500"; // Orange
            else if (val >= 20 && val <= 39) valColor = "#800080"; // Purple
            else if (val >= 0 && val <= 19) valColor = "#FF0000";  // Red

            const labelPart = itemLine.label.trim(); // "Survival:"
            const valPart = ` ${itemLine.valNum}${itemLine.percentSign}`.replace(/%/g, "\\%"); // " 4%"

            const labelW = labelPart.length * TEXT_FONT * 0.52;
            const valW = valPart.replace(/\\%/, "%").length * TEXT_FONT * 0.52;
            const totalW = labelW + valW;

            const rowStartX = Math.round(slotCenterX - (totalW / 2));
            const valStartX = Math.round(rowStartX + labelW);

            const tagLabelPart = `survivalLabel${idx}`;
            const valBaseTag = `valBase${idx}`;
            const counterDur = 1.4;

            // 1. Draw "Survival:" label normally
            filters.push(
              `[${currentPf}]drawtext=text=${quoteFilterText(labelPart)}${fa}:` +
              `x=${rowStartX}:y=${currentY}:` +
              `fontsize=${TEXT_FONT}:fontcolor=white:borderw=2:bordercolor=black:` +
              `enable='between(t,${tTextIn},${tTextOut})'[${tagLabelPart}]`
            );

            // 2. Draw the survival value text
            filters.push(
              `[${tagLabelPart}]drawtext=text=${quoteFilterText(valPart)}${fa}:` +
              `x=${valStartX}:y=${currentY}:` +
              `fontsize=${TEXT_FONT}:fontcolor=${valColor}:borderw=2:bordercolor=black:` +
              `alpha='clip((t-${tTextIn})/${counterDur},0,1)':` +
              `enable='between(t,${tTextIn},${tTextOut})'[${lineTag}]`
            );
            currentPf = lineTag;
          } else {
            // Standard lines (e.g. City Destroyed: Tokyo)
            const escapedSubLine = itemLine.text.replace(/%/g, "\\%");

            filters.push(
              `[${currentPf}]drawtext=text=${quoteFilterText(escapedSubLine)}${fa}:` +
              `x=${slotCenterX}-text_w/2:y=${currentY}:` +
              `fontsize=${TEXT_FONT}:fontcolor=${itemLine.color}:borderw=2:bordercolor=black:` +
              `enable='between(t,${tTextIn},${tTextOut})'[${lineTag}]`
            );
            currentPf = lineTag;
          }

          currentY += lineSpacing;
        });

        var finalNameTag = currentPf;

      } else {
        const fallbackName = escText(item.name, 60);
        filters.push(
          `[co${idx}]drawtext=text=${quoteFilterText(fallbackName)}${fa}:` +
          `x=${slotCenterX}-text_w/2:y=${itemImgTopY - TEXT_FONT - 60}:` +
          `fontsize=${TEXT_FONT}:fontcolor=white:borderw=2:bordercolor=black:` +
          `enable='between(t,${tTextIn},${tTextOut})'[to${idx}]`
        );
        var finalNameTag = `to${idx}`;
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
        `[${finalNameTag}][orig${idx}]overlay=x=${origX}:y='${origYExpr}'[oo${idx}]`
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