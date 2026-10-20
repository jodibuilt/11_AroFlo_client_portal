// SQLite's file locking is unreliable on network storage such as Azure App Service's
// /home share: a container being replaced can leave a lock behind that hangs the next
// one. On such hosts the database runs from local disk and is snapshotted back to the
// persistent folder. Snapshots are written to a temp file and renamed into place, so the
// saved copy is always a complete database.
import crypto from 'node:crypto';
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

// Writes a consistent copy of the open database to the persistent folder. The copy is
// made on local disk (VACUUM INTO blocks the server, and is quick only there), then
// copied to the share without blocking. Temp names are unique: while Azure swaps
// containers the old and new one run side by side, often with the same process id.
// `stillWanted()` is asked just before the copy replaces the saved one, so a newer save
// made meanwhile (on shutdown) is never overwritten by this older one.
export function snapshotTo(handle, persistDir, localDir, stillWanted = () => true) {
  const target = path.join(persistDir, DB_FILE);
  const id = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const local = path.join(localDir, `${DB_FILE}.snapshot-${id}`);
  const temp = `${target}.tmp-${id}`;
  handle.exec(`VACUUM INTO '${local.replace(/'/g, "''")}'`);
  return (async () => {
    try {
      await fs.promises.copyFile(local, temp);
      if (!stillWanted()) return;
      await fs.promises.rename(temp, target);
      // Journals from the old direct-on-share setup would not match the new file.
      for (const suffix of SIDE_FILES) await fs.promises.rm(target + suffix, { force: true });
    } finally {
      await fs.promises.rm(local, { force: true });
      await fs.promises.rm(temp, { force: true });
    }
  })();
}

// Same, but finished before returning: for shutdown, when there is no time to wait on.
export function snapshotToSync(handle, persistDir, localDir) {
  const target = path.join(persistDir, DB_FILE);
  const id = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const local = path.join(localDir, `${DB_FILE}.snapshot-${id}`);
  const temp = `${target}.tmp-${id}`;
  try {
    handle.exec(`VACUUM INTO '${local.replace(/'/g, "''")}'`);
    fs.copyFileSync(local, temp);
    fs.renameSync(temp, target);
    for (const suffix of SIDE_FILES) fs.rmSync(target + suffix, { force: true });
  } finally {
    fs.rmSync(local, { force: true });
    fs.rmSync(temp, { force: true });
  }
}
