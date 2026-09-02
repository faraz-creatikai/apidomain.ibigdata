import crypto from "crypto";

// Node 18+ has global fetch built in. If your Node version is older,
// run: npm install node-fetch
// and uncomment the line below.
// import fetch from "node-fetch";

const FETCH_TIMEOUT_MS = 8000;

function extToMime(ext) {
  const map = { jpg: "jpeg", jpe: "jpeg" };
  return map[ext] || ext;
}

async function fetchRemoteImage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Some CDNs (Cloudinary included, depending on config) block
        // requests with no browser-like User-Agent.
        "User-Agent": "Mozilla/5.0 (compatible; CreatikAI-Mailer/1.0)",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get("content-type") || "image/png";
    const subtype = extToMime(contentType.split("/")[1]?.split(";")[0] || "png");
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, subtype };
  } finally {
    clearTimeout(timer);
  }
}

// Converts EVERY <img> in the given HTML — whether src is a data: URI or a
// remote http(s) URL — into a cid: reference backed by a real MIME
// attachment. This is the only way to guarantee an image actually renders
// in the inbox: data: URIs get stripped outright by Gmail/Outlook, and
// remote URLs depend on the recipient's client successfully fetching them
// at open-time (which silently fails for all sorts of reasons — hotlink
// protection, expired signed URLs, "display images" being blocked, etc).
// CID attachments are delivered as part of the message itself, so nothing
// external has to succeed at render time.
//
// Intended to run ONCE per campaign, on the shared template HTML — before
// per-customer token substitution — since the images are identical for
// every recipient. Do not call this inside the per-customer loop or you'll
// refetch the same logo hundreds of times.
export async function inlineAllImages(html) {
  if (!html) return { html, attachments: [] };

  const attachments = [];
  const resolved = new Map(); // src -> cid, de-dupes repeated images (e.g. logo in header + footer)
  const imgRegex = /<img([^>]*)\ssrc=["']([^"']+)["']([^>]*)>/gi;
  const seenSrcs = [...html.matchAll(imgRegex)].map((m) => m[2]);

  for (const src of new Set(seenSrcs)) {
    try {
      if (src.startsWith("data:image/")) {
        const match = src.match(/^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/i);
        if (!match) continue;
        const [, subtype, base64Data] = match;
        const cid = `img_${crypto.randomBytes(8).toString("hex")}@creatikai`;
        attachments.push({
          filename: `inline.${extToMime(subtype)}`,
          content: base64Data,
          encoding: "base64",
          cid,
          contentDisposition: "inline",
        });
        resolved.set(src, cid);
      } else if (/^https?:\/\//i.test(src)) {
        const { buffer, subtype } = await fetchRemoteImage(src);
        const cid = `img_${crypto.randomBytes(8).toString("hex")}@creatikai`;
        attachments.push({
          filename: `inline.${subtype}`,
          content: buffer,
          cid,
          contentDisposition: "inline",
        });
        resolved.set(src, cid);
      }
      // anything else (e.g. cid: already, or an unsupported scheme) is left as-is
    } catch (err) {
      console.warn(`[inlineImages] failed to fetch "${src}":`, err.message);
      // leave this one image unresolved — it'll just fall back to its
      // original src rather than breaking the whole send
    }
  }

  const rewritten = html.replace(imgRegex, (fullMatch, before, src, after) => {
    const cid = resolved.get(src);
    return cid ? `<img${before} src="cid:${cid}"${after}>` : fullMatch;
  });

  return { html: rewritten, attachments };
}