// SQLite's file locking is unreliable on network storage such as Azure App Service's
// /home share: a container being replaced can leave a lock behind that hangs the next
// one. On such hosts the database runs from local disk and is snapshotted back to the
// persistent folder. Snapshots are written to a temp file and renamed into place, so the
// saved copy is always a complete database.
import fs from 'node:fs';
import path from 'node:path';

const DB_FILE = 'portal.db';
const SIDE_FILES = ['-journal', '-wal', '-shm'];

// Copies the saved database to local disk and returns the local folder to open it from.
export function prepareLocalCopy(persistDir, localDir) {
  fs.mkdirSync(persistDir, { recursive: true });
  fs.rmSync(localDir, { recursive: true, force: true });
  fs.mkdirSync(localDir, { recursive: true });
  const saved = path.join(persistDir, DB_FILE);
  if (fs.existsSync(saved)) {
    fs.copyFileSync(saved, path.join(localDir, DB_FILE));
    // A database last used directly on the share may have an unfinished journal; bring it
    // along so SQLite can recover it locally.
    for (const suffix of SIDE_FILES) {
      if (fs.existsSync(saved + suffix)) fs.copyFileSync(saved + suffix, path.join(localDir, DB_FILE + suffix));
    }
  }
  return localDir;
}

// Writes a consistent copy of the open database to the persistent folder.
export function snapshotTo(handle, persistDir) {
  const target = path.join(persistDir, DB_FILE);
  const temp = `${target}.tmp-${process.pid}`;
  fs.rmSync(temp, { force: true });
  handle.exec(`VACUUM INTO '${temp.replace(/'/g, "''")}'`);
  fs.renameSync(temp, target);
  // Journals from the old direct-on-share setup would not match the new file.
  for (const suffix of SIDE_FILES) fs.rmSync(target + suffix, { force: true });
}
