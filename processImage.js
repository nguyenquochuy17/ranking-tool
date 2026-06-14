const path = require("path");
const sharp = require("sharp");

async function processImage(inputPath) {

  const outputPath = path.join(
    "uploads",
    `processed_${Date.now()}.png`
  );

  // read image with alpha
  const {
    data,
    info
  } = await sharp(inputPath)
    .resize(512, 512, {
      fit: "contain",
      background: {
        r: 0,
        g: 0,
        b: 0,
        alpha: 0
      }
    })
    .ensureAlpha()
    .raw()
    .toBuffer({
      resolveWithObject: true
    });

  // make white background transparent, keep original colors
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const alpha = data[i + 3];

    // check if pixel is white or near-white
    if (r > 240 && g > 240 && b > 240) {
      data[i + 3] = 0; // make transparent
    } else if (alpha < 20) {
      data[i + 3] = 0; // keep transparent pixels transparent
    }
  }

  await sharp(data, {
    raw: info
  })
    .png()
    .toFile(outputPath);

  return path.resolve(outputPath);

}

/**
 * Rasterize an uploaded icon (PNG or SVG) into a clean, high-res
 * transparent-background square PNG. 400x400 source ensures crisp
 * downscaling no matter how big the icon is displayed in the video.
 */
async function processIcon(inputPath, size = 400) {
  const outputPath = path.join(
    "uploads",
    `icon_${Date.now()}_${Math.round(Math.random() * 1e6)}.png`
  );

  const ext = path.extname(inputPath).toLowerCase();

  // For SVGs, set a high density so rasterization is sharp
  const input = ext === ".svg"
    ? sharp(inputPath, { density: 300 })
    : sharp(inputPath);

  await input
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(outputPath);

  return path.resolve(outputPath);
}

/**
 * Create a fully transparent placeholder PNG, used when an item
 * has no icon. Keeps the ffmpeg input count consistent (3 per item).
 */
async function createBlankIcon(size = 10) {
  const outputPath = path.join(
    "uploads",
    `icon_blank_${Date.now()}_${Math.round(Math.random() * 1e6)}.png`
  );

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toFile(outputPath);

  return path.resolve(outputPath);
}

module.exports = { processImage, processIcon, createBlankIcon };