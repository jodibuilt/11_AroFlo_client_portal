// Shrinks job photos for long-term storage: at most 1600px on the long edge, JPEG ~72%.
// A 3-4 MB phone photo typically becomes 200-400 KB and still reads well on screen and
// in the printed record. Originals stay available from AroFlo for "Download".
// Every output here is re-encoded, so no photo keeps its hidden (EXIF/XMP) metadata.
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

// True when photos can be processed here (sharp loaded).
export const canProcess = async () => Boolean(await loadSharp());

// Full-size copy without hidden metadata. Phone photos carry EXIF/XMP data such as the
// GPS location, device and app that saved them; re-encoding (orientation applied first)
// drops all of it while keeping the full resolution. Returns { body, type }, or null to
// keep the original (unusual format, unreadable file, or no sharp).
export async function cleanFullSize(buffer) {
  const sharp = await loadSharp();
  if (!sharp) return null;
  try {
    const image = sharp(buffer, { failOn: 'none' });
    const { format, pages } = await image.metadata();
    if (format === 'gif' && pages > 1) return null; // animated: keep as is
    const upright = image.rotate();
    if (format === 'png') return { body: await upright.png({ compressionLevel: 9 }).toBuffer(), type: 'image/png' };
    if (format === 'webp') return { body: await upright.webp({ quality: 90 }).toBuffer(), type: 'image/webp' };
    return { body: await upright.jpeg({ quality: 90, mozjpeg: true }).toBuffer(), type: 'image/jpeg' };
  } catch {
    return null;
  }
}

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
