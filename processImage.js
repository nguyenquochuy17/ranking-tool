const fs = require("fs");
const path = require("path");
const axios = require("axios");
const FormData = require("form-data");
const sharp = require("sharp");

const API_KEY =
  "MDKb8EMcQuZxsYVfghKBMC28";

async function processImage(imagePath) {

  // =========================
  // REMOVE BACKGROUND
  // =========================

  const formData = new FormData();

  formData.append(
    "image_file",
    fs.createReadStream(imagePath)
  );

  formData.append("size", "auto");

  const response = await axios({
    method: "post",
    url: "https://api.remove.bg/v1.0/removebg",
    data: formData,
    responseType: "arraybuffer",
    headers: {
      ...formData.getHeaders(),
      "X-Api-Key": API_KEY
    }
  });

  // =========================
  // OUTPUT PATH
  // =========================

  const outputPath =
    path.join(
      "uploads",
      `processed_${Date.now()}.png`
    );

  // =========================
  // CREATE BLACK SILHOUETTE
  // =========================

  const image = sharp(
    Buffer.from(response.data)
  );

  const metadata =
    await image.metadata();

  const width = metadata.width;
  const height = metadata.height;

  // transparent canvas
  const blackLayer = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: {
        r: 0,
        g: 0,
        b: 0,
        alpha: 1
      }
    }
  })
    .png()
    .toBuffer();

  // use alpha from original cutout
  await sharp(blackLayer)
    .joinChannel(
      await image.extractChannel("alpha").toBuffer()
    )
    .png()
    .toFile(outputPath);

  // =========================
  // IMPORTANT
  // =========================

  return {
    image: outputPath
  };

}

module.exports = processImage;