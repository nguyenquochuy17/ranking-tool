const fsPromises = require("fs").promises;
const path = require("path");
const http = require("http");
const sharp = require("sharp");


let modelServer = null;
let modelServerPort = null;


function startModelServer() {
 if (modelServer) return Promise.resolve(modelServerPort);


 const distPath = path.resolve(
   require.resolve("@imgly/background-removal-node"),
   "../../dist"
 );


 return new Promise((resolve, reject) => {
   const fs = require("fs");
   const server = http.createServer((req, res) => {
     const filePath = path.join(distPath, req.url.split("?")[0]);
     fs.readFile(filePath, (err, data) => {
       if (err) {
         res.writeHead(404);
         res.end("Not found");
         return;
       }
       res.writeHead(200);
       res.end(data);
     });
   });


   server.listen(0, "127.0.0.1", () => {
     modelServer = server;
     modelServerPort = server.address().port;
     console.log(`📦 Model server started on port ${modelServerPort}`);
     resolve(modelServerPort);
   });


   server.on("error", reject);
 });
}


async function removeBackground(imagePath) {
 if (!imagePath) throw new Error("Image path is required");


 const { removeBackground: imglyRemove } = require("@imgly/background-removal-node");


 console.log("🖼️ Running local background removal (@imgly)...");


 const port = await startModelServer();
 const publicPath = `http://127.0.0.1:${port}/`;


 const resultBlob = await imglyRemove(imagePath, {
   publicPath,
   model: "medium",
   output: { format: "image/png", type: "foreground" },
 });


 const arrayBuffer = await resultBlob.arrayBuffer();
 const removedPath = path.join("uploads", `removed_${Date.now()}.png`);
 await fsPromises.writeFile(removedPath, Buffer.from(arrayBuffer));


 // Build black silhouette from alpha channel using sharp
 const silhouettePath = path.join("uploads", `silhouette_${Date.now()}.png`);
 try {
   await sharp(removedPath)
     .extractChannel("alpha")
     .threshold(1)
     .negate()
     .png()
     .toFile(silhouettePath);
 } catch (sharpErr) {
   console.warn("⚠️ sharp silhouette failed, using transparent as fallback:", sharpErr.message);
   await fsPromises.copyFile(removedPath, silhouettePath);
 }


 console.log(`✅ Background removed: ${silhouettePath}`);


 return {
   silhouette: silhouettePath,
   transparent: removedPath,
 };
}


module.exports = removeBackground;



