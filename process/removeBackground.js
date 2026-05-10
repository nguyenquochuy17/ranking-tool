// processed/removeBackground.js
const axios = require("axios");
const fs = require("fs");           // Main fs for createReadStream
const fsPromises = require("fs").promises;  // For async writeFile
const path = require("path");
const FormData = require("form-data");
const sharp = require("sharp");

async function removeBackground(imagePath) {
  if (!imagePath) throw new Error("Image path is required");

  try {
    const formData = new FormData();
    formData.append("image_file", fs.createReadStream(imagePath));
    formData.append("size", "auto");
    formData.append("type", "person");

    const apiKey = process.env.REMOVE_BG_API_KEY;

    if (!apiKey) {
      throw new Error("REMOVE_BG_API_KEY is missing in .env file!");
    }

    const response = await axios({
      method: "post",
      url: "https://api.remove.bg/v1.0/removebg",
      data: formData,
      responseType: "arraybuffer",
      headers: {
        ...formData.getHeaders(),
        "X-Api-Key": apiKey,
      },
      timeout: 20000,
    });

    const removedPath = path.join("uploads", `removed_${Date.now()}.png`);
    await fsPromises.writeFile(removedPath, response.data);

    // Create black silhouette
    const silhouettePath = path.join("uploads", `silhouette_${Date.now()}.png`);

    await sharp(removedPath)
      .extractChannel("alpha")
      .threshold(1)
      .negate()
      .png()
      .toFile(silhouettePath);

    console.log(`✅ Background removed: ${silhouettePath}`);

    return {
      silhouette: silhouettePath,
      transparent: removedPath
    };

  } catch (err) {
    console.error("Remove.bg Error:", err.message);
    
    if (err.response?.status === 403) {
      throw new Error("Invalid Remove.bg API Key");
    }
    if (err.response?.status === 429) {
      throw new Error("Remove.bg rate limit exceeded");
    }

    throw new Error("Background removal failed: " + err.message);
  }
}

module.exports = removeBackground;