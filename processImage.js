const fs = require("fs");
const path = require("path");
const axios = require("axios");
const FormData = require("form-data");
const sharp = require("sharp");

const API_KEY =
  "MDKb8EMcQuZxsYVfghKBMC28";

async function processImage(inputPath) {

  // =========================
  // REMOVE BACKGROUND
  // =========================

  const form = new FormData();

  form.append(
    "image_file",
    fs.createReadStream(inputPath)
  );

  form.append("size", "auto");

  const response = await axios({
    method: "post",
    url: "https://api.remove.bg/v1.0/removebg",
    data: form,
    responseType: "arraybuffer",
    headers: {
      ...form.getHeaders(),
      "X-Api-Key": API_KEY
    }
  });

  // =========================
  // OUTPUT PATH
  // =========================

  const outputPath = path.join(
    __dirname,
    "uploads",
    `processed_${Date.now()}.png`
  );

  // =========================
  // CREATE BLACK CHARACTER
  // =========================

  await sharp(Buffer.from(response.data))
    .grayscale()
    .linear(0, -255)
    .png()
    .toFile(outputPath);

  return outputPath;
}

module.exports = processImage;