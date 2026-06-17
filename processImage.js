const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const { removeBackground } = require("@imgly/background-removal-node");

async function processImage(inputPath) {
  const outputPath = path.join("uploads", `processed_${Date.now()}.png`);

  const imageData = fs.readFileSync(inputPath);
  const ext = path.extname(inputPath).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  const blob = new Blob([imageData], { type: mime });

  const resultBlob = await removeBackground(blob);
  const buf = Buffer.from(await resultBlob.arrayBuffer());

  // Zero out RGB channels to make a black silhouette, preserve alpha
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 0;
    data[i + 1] = 0;
    data[i + 2] = 0;
  }

  await sharp(data, { raw: info })
    .resize(512, 512, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(outputPath);

  return path.resolve(outputPath);
}

async function processIcon(inputPath, size = 400) {
  const outputPath = path.join(
    "uploads",
    `icon_${Date.now()}_${Math.round(Math.random() * 1e6)}.png`
  );

  const ext = path.extname(inputPath).toLowerCase();

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
