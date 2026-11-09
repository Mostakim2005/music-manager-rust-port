/**
 * fetch-binaries.mjs
 * Ensures required external binaries (yt-dlp and ffmpeg) exist under resources/bin.
 * Runs in postinstall and before portable/win build targets.
 */
import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const projectRoot = path.resolve(__dirname, '..');
const binDir = path.join(projectRoot, 'resources', 'bin');

if (!fs.existsSync(binDir)) {
  fs.mkdirSync(binDir, { recursive: true });
}

// 1. ffmpeg binary resolution
//
// This is the app's ONLY ffmpeg copy. It is downloaded on demand and shipped
// once via extraResources (`resources/bin` -> `bin`). Do not reintroduce the
// `ffmpeg-static` npm package: unpacking it added a second 79 MB binary that
// nothing used, because every caller goes through `getFfmpegPath()`.
const isWindows = process.platform === 'win32';
const ffmpegBinaryName = isWindows ? 'ffmpeg.exe' : 'ffmpeg';
const ffmpegTarget = path.join(binDir, ffmpegBinaryName);

// A pinned, small essentials build. Only use direct-binary URLs here: this
// helper streams raw bytes to disk and cannot unpack an archive.
const FFMPEG_URLS = [
  'https://github.com/eugeneware/ffmpeg-static/releases/latest/download/ffmpeg-win32-x64'
];

if (!fs.existsSync(ffmpegTarget)) {
  console.log('[fetch-binaries] ffmpeg missing; attempting download...');
  let ok = false;
  for (const url of FFMPEG_URLS) {
    try {
      await downloadFile(url, ffmpegTarget);
      console.log('[fetch-binaries] ffmpeg downloaded from', url);
      ok = true;
      break;
    } catch (err) {
      console.warn('[fetch-binaries] ffmpeg download failed from', url, '-', err.message);
    }
  }
  if (!ok) {
    console.warn(
      '[fetch-binaries] Could not fetch ffmpeg automatically. Place ffmpeg.exe in resources/bin manually.'
    );
  }
} else {
  console.log('[fetch-binaries] ffmpeg binary already exists at:', ffmpegTarget);
}

// 2. yt-dlp binary resolution
const ytDlpBinaryName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
const ytDlpTarget = path.join(binDir, ytDlpBinaryName);

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'MusicManager/5.4.1' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(downloadFile(res.headers.location, destPath));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Failed to download ${url}: HTTP status ${res.statusCode}`));
        }
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on('finish', () => {
          file.close(() => {
            fs.chmodSync(destPath, 0o755);
            resolve();
          });
        });
        file.on('error', (err) => {
          fs.unlink(destPath, () => reject(err));
        });
      })
      .on('error', reject);
  });
}

const YT_DLP_URLS = [
  `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytDlpBinaryName}`,
  `https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/${ytDlpBinaryName}`
];

if (!fs.existsSync(ytDlpTarget)) {
  console.log(`[fetch-binaries] Downloading latest ${ytDlpBinaryName} from GitHub releases...`);
  let ok = false;
  for (const url of YT_DLP_URLS) {
    try {
      await downloadFile(url, ytDlpTarget);
      console.log(`[fetch-binaries] ${ytDlpBinaryName} downloaded successfully from`, url);
      ok = true;
      break;
    } catch (err) {
      console.warn(`[fetch-binaries] Failed to download ${ytDlpBinaryName} from ${url}:`, err.message);
    }
  }
  if (!ok) {
    console.warn(`[fetch-binaries] Could not fetch ${ytDlpBinaryName} automatically.`);
  }
} else {
  console.log('[fetch-binaries] yt-dlp binary already exists at:', ytDlpTarget);
}
