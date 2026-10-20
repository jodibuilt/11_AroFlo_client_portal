// Scripts and stylesheets go to browsers minified and without comments, so the browser's
// developer tools ("Inspect") show nothing about how the portal works inside. A file is
// processed on first request and again only when it changes on disk. Licence comments
// written as /*! ... */ are kept.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

let terserLoad = null;
const loadTerser = () => (terserLoad ??= import('terser').catch((err) => {
  console.warn(`Script minifier unavailable (${err.message}); scripts are sent as written.`);
  return null;
}));

async function minifyJs(source, file) {
  const terser = await loadTerser();
  if (!terser) return source;
  try {
    return (await terser.minify(source, { module: true, format: { comments: /^!/ } })).code;
  } catch (err) {
    console.warn(`Couldn't minify ${path.basename(file)} (${err.message}); sending it as written.`);
    return source;
  }
}

// Comments out, blank lines and indentation trimmed. Spacing inside rules is left alone,
// since it can matter in selectors (".a :hover" is not ".a:hover").
const minifyCss = (source) => source
  .replace(/\/\*(?!!)[\s\S]*?\*\//g, '')
  .split('\n').map((line) => line.trim()).filter(Boolean).join('\n');

const TYPES = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

// Returns get(urlPath) -> { body, gzip, type, etag } for a .js/.css file under publicDir, or null.
export function createAssets(publicDir) {
  const root = path.resolve(publicDir);
  const cache = new Map(); // urlPath -> { mtimeMs, built: Promise }
  return async function get(urlPath) {
    const ext = path.extname(urlPath).toLowerCase();
    if (!TYPES[ext]) return null;
    const file = path.resolve(root, `.${urlPath}`);
    if (!file.startsWith(root + path.sep)) return null;
    const stat = await fs.promises.stat(file).catch(() => null);
    if (!stat?.isFile()) return null;
    let entry = cache.get(file);
    if (!entry || entry.mtimeMs !== stat.mtimeMs) {
      entry = { mtimeMs: stat.mtimeMs, built: build(file, ext) };
      cache.set(file, entry);
    }
    return entry.built;
  };
}

async function build(file, ext) {
  const source = await fs.promises.readFile(file, 'utf8');
  const body = ext === '.js' ? await minifyJs(source, file) : minifyCss(source);
  const etag = `"${crypto.createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`;
  // Compressed once here rather than on every request.
  return { body, gzip: zlib.gzipSync(body, { level: 9 }), type: TYPES[ext], etag };
}
