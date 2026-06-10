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

module.exports = processImage;