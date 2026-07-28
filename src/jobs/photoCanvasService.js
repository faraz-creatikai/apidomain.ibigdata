// services/photoCanvasService.js
//
// Node has no PIL, so `sharp` fills that role. This replicates the canvas
// prep from the Python make_zoom_clip(): fit the whole photo inside the
// frame with no cropping (ImageOps.contain), then center it on a black
// background of the exact target video size (foreground.paste onto
// black_background). The result is one fixed-size PNG per photo that
// ffmpeg's zoompan filter can then animate.
//
// npm i sharp

import sharp from "sharp";

const VIDEO_WIDTH = 720;
const VIDEO_HEIGHT = 1280;
const SAFETY_MARGIN = 0.96; // leaves headroom so the largest zoom frame never clips the photo

export async function buildPhotoCanvas(inputPath, outputPath) {
  const maxWidth = Math.max(1, Math.round(VIDEO_WIDTH * SAFETY_MARGIN));
  const maxHeight = Math.max(1, Math.round(VIDEO_HEIGHT * SAFETY_MARGIN));

  const resizedBuffer = await sharp(inputPath)
    .rotate() // respect EXIF orientation, same as opening with PIL
    .resize({
      width: maxWidth,
      height: maxHeight,
      fit: "inside",
      withoutEnlargement: true,
    })
    .toBuffer();

  const resizedMeta = await sharp(resizedBuffer).metadata();

  await sharp({
    create: {
      width: VIDEO_WIDTH,
      height: VIDEO_HEIGHT,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite([
      {
        input: resizedBuffer,
        left: Math.round((VIDEO_WIDTH - resizedMeta.width) / 2),
        top: Math.round((VIDEO_HEIGHT - resizedMeta.height) / 2),
      },
    ])
    .png()
    .toFile(outputPath);

  return outputPath;
}

export { VIDEO_WIDTH, VIDEO_HEIGHT };