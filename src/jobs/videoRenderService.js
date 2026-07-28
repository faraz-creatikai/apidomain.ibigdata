// services/videoRenderService.js
//
// v2: adds crossfade transitions between photos (via ffmpeg's xfade filter)
// instead of a hard concat cut, fixes zoompan framerate judder, and bumps
// encode quality. This is what actually closes the "looks like a slideshow"
// gap vs. the Python reference - the per-photo zoom motion was already fine,
// the hard cut between clips was the main quality gap.
//
// Design note on timing: each clip (except the last) is rendered
// TRANSITION_DURATION seconds *longer* than its assigned duration. The xfade
// chain then "spends" that extra time blending into the next clip, so the
// combined final video duration comes out exactly equal to
// sum(originalDurations) - matching the narration audio length untouched.
// No changes needed anywhere else in the pipeline (ttsService.js,
// mediaUtils.js, the controller) for this to work.

import fs from "fs/promises";
import path from "path";
import os from "os";
import { runFfmpeg, ffprobeDuration } from "../utils/mediaUtils.js";
import { buildPhotoCanvas, VIDEO_WIDTH, VIDEO_HEIGHT } from "./photoCanvasService.js";

const VIDEO_FPS = 30;
const ZOOM_AMOUNT = 0.08; // 8% movement, matches the Python ZOOM_AMOUNT
const TRANSITION_DURATION = 0.5; // seconds, standard crossfade length for this style of video
const TRANSITION_STYLE = "fade"; // ffmpeg xfade transition name - try "fadeblack", "dissolve", "smoothleft" too

function makeWorkDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "real-estate-video-"));
}

// Zoom expression for ffmpeg's zoompan `z` parameter: a smooth zoom-IN then
// zoom-OUT within a single clip, instead of the old one-direction-per-clip
// approach. Uses a cosine "hump" curve - scale(t) = 1 + amount*(1-cos(2*pi*t))/2
// for t in [0,1] - which has zero velocity at the start, at the peak (the
// moment it reverses direction), and at the end. That's what avoids a visible
// "kink" or snap when the motion switches from zooming in to zooming out.
function buildZoomExpression(totalFrames) {
  const framesMinusOne = Math.max(totalFrames - 1, 1);
  const t = `(on/${framesMinusOne})`;
  const hump = `((1-cos(2*PI*${t}))/2)`;

  return `1+(${ZOOM_AMOUNT}*${hump})`;
}

// Renders one photo into a video clip with a stable, centered Ken Burns
// zoom. `renderDuration` may be longer than the photo's assigned display
// duration - the extra tail is what the xfade transition consumes when
// blending into the next clip.
export async function renderZoomClip(photoCanvasPath, outputPath, renderDuration, index) {
  const totalFrames = Math.max(2, Math.round(renderDuration * VIDEO_FPS));
  const zoomExpr = buildZoomExpression(totalFrames);

  const filter =
    `scale=${VIDEO_WIDTH * 10}:${VIDEO_HEIGHT * 10}:flags=lanczos,` +
    `zoompan=z='${zoomExpr}':` +
    `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':` +
    `d=${totalFrames}:s=${VIDEO_WIDTH}x${VIDEO_HEIGHT}:fps=${VIDEO_FPS}`;

  await runFfmpeg([
    "-y",
    "-framerate", String(VIDEO_FPS), // locks the still-image loop to the same rate zoompan expects, fixes judder
    "-loop", "1",
    "-i", photoCanvasPath,
    "-vf", filter,
    "-t", renderDuration.toFixed(3),
    "-r", String(VIDEO_FPS),
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "18", // near-visually-lossless; default (23) was noticeably softer
    "-pix_fmt", "yuv420p",
    outputPath,
  ]);

  return outputPath;
}

// Chains all clips together with a crossfade between each pair, instead of
// a hard concat cut. Requires re-encoding (xfade needs decoded frames), so
// this replaces the old "-c copy" concat step.
async function crossfadeConcatenate(clipPaths, renderDurations, transitionDuration, outputPath) {
  const args = ["-y"];
  clipPaths.forEach((clipPath) => {
    args.push("-i", clipPath);
  });

  const filterParts = [];
  let runningLabel = "0:v";
  let cumulativeDuration = renderDurations[0];

  for (let i = 1; i < clipPaths.length; i += 1) {
    const outLabel = i === clipPaths.length - 1 ? "vout" : `x${i}`;
    const offset = cumulativeDuration - i * transitionDuration;

    filterParts.push(
      `[${runningLabel}][${i}:v]xfade=transition=${TRANSITION_STYLE}:` +
        `duration=${transitionDuration.toFixed(3)}:offset=${offset.toFixed(3)}[${outLabel}]`
    );

    runningLabel = outLabel;
    cumulativeDuration += renderDurations[i];
  }

  args.push(
    "-filter_complex", filterParts.join(";"),
    "-map", `[${runningLabel}]`,
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    outputPath
  );

  await runFfmpeg(args);
  return outputPath;
}

async function muxVideoWithAudio(videoPath, audioPath, outputPath, { trimToAudio = false } = {}) {
  const args = [
    "-y",
    "-i", videoPath,
    "-i", audioPath,
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
  ];

  if (trimToAudio) {
    const audioDuration = await ffprobeDuration(audioPath);
    args.push("-t", audioDuration.toFixed(3));
  } else {
    args.push("-shortest");
  }

  args.push("-movflags", "+faststart", outputPath);

  await runFfmpeg(args);
  return outputPath;
}

/**
 * High-level orchestration: given ordered photo paths and matching per-photo
 * durations, render every clip (with a bit of extra tail for the crossfade),
 * blend them together with xfade transitions, and mux with the final audio
 * track. Total output duration still matches sum(durations) exactly.
 */
export async function assembleFinalVideo({ photoPaths, durations, audioPath, finalOutputPath, trimToAudio = false }) {
  if (photoPaths.length !== durations.length) {
    throw new Error("Photo count and duration count must match");
  }

  const workDir = await makeWorkDir();

  try {
    // Keep the transition shorter than any single photo's duration so we
    // never render a negative-length or degenerate clip on very short slots.
    const shortestDuration = Math.min(...durations);
    const transitionDuration = photoPaths.length > 1
      ? Math.min(TRANSITION_DURATION, shortestDuration * 0.3)
      : 0;

    const clipPaths = [];
    const renderDurations = [];

    for (let index = 0; index < photoPaths.length; index += 1) {
      const isLast = index === photoPaths.length - 1;
      const renderDuration = Math.max(durations[index], 0.5) + (isLast ? 0 : transitionDuration);

      const canvasPath = path.join(workDir, `canvas_${index}.png`);
      const clipPath = path.join(workDir, `clip_${index}.mp4`);

      await buildPhotoCanvas(photoPaths[index], canvasPath);
      await renderZoomClip(canvasPath, clipPath, renderDuration, index);

      clipPaths.push(clipPath);
      renderDurations.push(renderDuration);
    }

    const silentVideoPath = path.join(workDir, "silent_video.mp4");

    if (clipPaths.length === 1) {
      // nothing to transition between - just use the single clip as-is
      await fs.copyFile(clipPaths[0], silentVideoPath);
    } else {
      await crossfadeConcatenate(clipPaths, renderDurations, transitionDuration, silentVideoPath);
    }

    await muxVideoWithAudio(silentVideoPath, audioPath, finalOutputPath, { trimToAudio });

    return finalOutputPath;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export { VIDEO_FPS, ZOOM_AMOUNT, TRANSITION_DURATION };