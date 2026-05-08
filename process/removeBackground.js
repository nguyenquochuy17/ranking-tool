const axios = require("axios");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");
const sharp = require("sharp");

async function removeBackground(imagePath) {

  // ====================================
  // REMOVE BACKGROUND
  // ====================================

  const formData = new FormData();

  formData.append(
    "image_file",
    fs.createReadStream(imagePath)
  );

  formData.append(
    "size",
    "auto"
  );

  const removedPath = path.join(
    "uploads",
    `removed_${Date.now()}.png`
  );

  const response = await axios({

    method: "post",

    url:
      "https://api.remove.bg/v1.0/removebg",

    data: formData,

    responseType: "arraybuffer",

    headers: {

      ...formData.getHeaders(),

      "X-Api-Key":
        process.env.REMOVE_BG_API_KEY

    }

  });

  fs.writeFileSync(
    removedPath,
    response.data
  );

  // ====================================
  // CREATE BLACK SILHOUETTE
  // ====================================

  const outputPath = path.join(
    "uploads",
    `shadow_${Date.now()}.png`
  );

  await sharp(removedPath)

    .grayscale()

    .linear(0, -255)

    .threshold(1)

    .png()

    .toFile(outputPath);

  return outputPath;
}

module.exports = removeBackground;