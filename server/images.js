// Shrinks job photos for long-term storage: at most 1600px on the long edge, JPEG ~72%.
// A 3-4 MB phone photo typically becomes 200-400 KB and still reads well on screen and
// in the printed record. Originals stay available from AroFlo for "Download".
//
// sharp is loaded lazily; if it can't load on this machine, shrink() returns null and
// photos are simply kept as they are.
let sharpLoad = null;
function loadSharp() {
  sharpLoad ??= import('sharp').then((m) => m.default).catch((err) => {
    console.warn(`Photo compression unavailable (sharp failed to load): ${err.message}`);
    return null;
  });
  return sharpLoad;
}

export const SHRUNK_TYPE = 'image/jpeg';

export async function shrink(buffer) {
  const sharp = await loadSharp();
  if (!sharp) return null;
  try {
    return await sharp(buffer, { failOn: 'none' })
      .rotate() // apply the phone's EXIF orientation before metadata is dropped
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 72, mozjpeg: true })
      .toBuffer();
  } catch {
    return null; // unreadable or unusual image: keep the original
  }
}
