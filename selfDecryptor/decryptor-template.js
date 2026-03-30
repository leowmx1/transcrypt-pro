// Standalone self-decryptor template (Windows).
// It is designed to be built into `decryptor-template-win32.exe` and then appended with encrypted data.
//
// Container format (at the end of the exe):
// [template...][encrypted(tclock bytes)][name bytes][encLen(8)][nameLen(2)][version(1)][magic(4)]
// Tail fields are little-endian:
// - encLen: uint64
// - nameLen: uint16
// - version: uint8
// - magic: 4 bytes "TCDX"

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const yauzl = require('yauzl');

const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16; // GCM auth tag

const ENCRYPTION_MAGIC = Buffer.from('TCLK');
const ENCRYPTION_VERSION = 1;

const SELF_DECRYPT_EXE_MAGIC = Buffer.from('TCDX');
const SELF_DECRYPT_EXE_VERSION = 1;
const SELF_DECRYPT_EXE_TAIL_LENGTH = 8 + 2 + 1 + 4;

const KDF_SALT = 'a-hardcoded-salt-for-key-derivation';

function deriveKeyFromPassword(password) {
  // Must match main process deriveKeyFromPassword()
  const keyMaterial = Buffer.from(password, 'utf8');
  return crypto.scryptSync(keyMaterial, KDF_SALT, 32);
}

function decryptAesGcmToBuffer(key, iv, authTag, encryptedDataBuffer) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encryptedDataBuffer), decipher.final()]);
}

function readArgValue(argv, flag) {
  const idx = argv.indexOf(flag);
  if (idx === -1) return null;
  return argv[idx + 1] ?? null;
}

function parseArgs(argv) {
  const args = {
    password: null,
    out: null,
    overwrite: false,
    noWait: false,
  };

  args.password = readArgValue(argv, '--password') || readArgValue(argv, '-p');
  args.out = readArgValue(argv, '--out') || readArgValue(argv, '-o');
  args.overwrite = argv.includes('--overwrite');
  args.noWait = argv.includes('--no-wait');

  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('Usage: decryptor-template.exe [--password <pwd>] [--out <path>] [--overwrite]');
    process.exit(0);
  }

  return args;
}

async function waitForExitIfNeeded({ noWait }) {
  // When double-clicking, Windows closes the console window instantly without a blocking read.
  if (noWait) return;
  if (!process.stdin || !process.stdout) return;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;

  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('\n解密已结束。按回车键退出...', () => {
      rl.close();
      resolve();
    });
  });
}

async function promptPasswordMasked(promptText) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    stdout.write(promptText);

    let password = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const onData = (chunk) => {
      const ch = chunk;

      if (ch === '\r' || ch === '\n') {
        stdout.write('\n');
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        resolve(password);
        return;
      }

      // Ctrl+C
      if (ch === '\u0003') {
        process.exit(1);
      }

      // Backspace (DEL)
      if (ch === '\u007f') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          stdout.write('\b \b'); // erase last '*'
        }
        return;
      }

      password += ch;
      stdout.write('*');
    };

    stdin.on('data', onData);
  });
}

async function extractZipBufferToDirectory(zipBuffer, outputPath) {
  const fsp = fs.promises;
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(zipBuffer, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err || new Error('无法读取目录数据'));

      zipfile.on('entry', (entry) => {
        const entryName = String(entry.fileName).replace(/\\/g, '/');

        // Basic zip-slip prevention
        if (entryName.includes('..')) {
          return reject(new Error('压缩包包含非法路径，已终止解压'));
        }

        const entryPath = path.join(outputPath, entryName);

        if (/\/$/.test(entryName)) {
          fsp.mkdir(entryPath, { recursive: true })
            .then(() => zipfile.readEntry())
            .catch(reject);
          return;
        }

        zipfile.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr || !readStream) return reject(streamErr || new Error('无法读取目录项'));

          const dirName = path.dirname(entryPath);
          fsp.mkdir(dirName, { recursive: true })
            .then(() => {
              const writeStream = fs.createWriteStream(entryPath);
              readStream
                .pipe(writeStream)
                .on('finish', () => zipfile.readEntry())
                .on('error', reject);
            })
            .catch(reject);
        });
      });

      zipfile.on('end', resolve);
      zipfile.on('error', reject);
      zipfile.readEntry();
    });
  });
}

function ensureUniquePath(desiredPath) {
  if (!fs.existsSync(desiredPath)) return desiredPath;
  const dir = path.dirname(desiredPath);
  const ext = path.extname(desiredPath);
  const baseName = path.basename(desiredPath, ext);

  let index = 1;
  while (true) {
    const candidate = path.join(dir, `${baseName}(${index})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
    index += 1;
  }
}

function parseEncryptedBytes(tclockBuffer) {
  if (
    tclockBuffer.length < ENCRYPTION_MAGIC.length + 2 + IV_LENGTH + AUTH_TAG_LENGTH ||
    !tclockBuffer.subarray(0, ENCRYPTION_MAGIC.length).equals(ENCRYPTION_MAGIC)
  ) {
    throw new Error('加密内容结构无效');
  }

  const version = tclockBuffer[ENCRYPTION_MAGIC.length];
  if (version !== ENCRYPTION_VERSION) {
    throw new Error(`不支持的加密版本: ${version}`);
  }

  const modeFlag = tclockBuffer[ENCRYPTION_MAGIC.length + 1]; // 1: directory(zip), 0: file
  const headerOffset = ENCRYPTION_MAGIC.length + 2;

  const iv = tclockBuffer.slice(headerOffset, headerOffset + IV_LENGTH);
  const authTag = tclockBuffer.slice(tclockBuffer.length - AUTH_TAG_LENGTH);
  const encryptedDataBuffer = tclockBuffer.slice(
    headerOffset + IV_LENGTH,
    tclockBuffer.length - AUTH_TAG_LENGTH
  );

  return { modeFlag, iv, authTag, encryptedDataBuffer };
}

async function main() {
  const argv = process.argv;
  const args = parseArgs(argv);

  const exePath = process.execPath;
  const stat = fs.statSync(exePath);
  const fileSize = stat.size;

  if (fileSize < SELF_DECRYPT_EXE_TAIL_LENGTH + 1) {
    throw new Error('自解密容器结构无效或文件不完整');
  }

  const fd = fs.openSync(exePath, 'r');
  let status = { ok: false, message: null };
  try {
    const tailBuf = Buffer.alloc(SELF_DECRYPT_EXE_TAIL_LENGTH);
    fs.readSync(fd, tailBuf, 0, SELF_DECRYPT_EXE_TAIL_LENGTH, fileSize - SELF_DECRYPT_EXE_TAIL_LENGTH);

    const encLenBig = tailBuf.readBigUInt64LE(0);
    const nameLen = tailBuf.readUInt16LE(8);
    const version = tailBuf.readUInt8(10);
    const magic = tailBuf.subarray(11, 15);

    if (magic.length !== 4 || !magic.equals(SELF_DECRYPT_EXE_MAGIC)) {
      throw new Error('未检测到自解密容器标记（TCDX）');
    }
    if (version !== SELF_DECRYPT_EXE_VERSION) {
      throw new Error(`不支持的自解密容器版本: ${version}`);
    }

    if (nameLen <= 0) throw new Error('自解密容器缺少文件名信息');

    if (encLenBig > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('加密内容过大，当前解密器不支持');
    }
    const encLen = Number(encLenBig);

    const nameStart = fileSize - SELF_DECRYPT_EXE_TAIL_LENGTH - nameLen;
    const encStart = nameStart - encLen;
    if (encStart < 0) throw new Error('自解密容器结构无效');

    const nameBuf = Buffer.alloc(nameLen);
    fs.readSync(fd, nameBuf, 0, nameLen, nameStart);
    const originalName = nameBuf.toString('utf8');

    const encryptedBuf = Buffer.alloc(encLen);
    fs.readSync(fd, encryptedBuf, 0, encLen, encStart);

    let password = args.password;
    if (!password) {
      password = await promptPasswordMasked('请输入解密密码: ');
    }
    if (typeof password !== 'string' || password.length === 0) {
      throw new Error('未提供密码');
    }

    const derivedKey = deriveKeyFromPassword(password);

    const parsed = parseEncryptedBytes(encryptedBuf);
    const decryptedBuffer = decryptAesGcmToBuffer(derivedKey, parsed.iv, parsed.authTag, parsed.encryptedDataBuffer);

    const shouldExtractDirectory = parsed.modeFlag === 1;

    const defaultOut = path.join(process.cwd(), originalName);
    let targetPath = args.out ? args.out : defaultOut;

    if (!args.overwrite) {
      targetPath = ensureUniquePath(targetPath);
    }

    if (shouldExtractDirectory) {
      fs.mkdirSync(targetPath, { recursive: true });
      await extractZipBufferToDirectory(decryptedBuffer, targetPath);
    } else {
      fs.writeFileSync(targetPath, decryptedBuffer);
    }

    status = { ok: true, message: `解密成功: ${targetPath}` };
    console.log(status.message);
  } finally {
    try { fs.closeSync(fd); } catch (e) { }
    await waitForExitIfNeeded({ noWait: args.noWait });
  }
}

main().catch((err) => {
  console.error(`解密失败: ${err && err.message ? err.message : String(err)}`);
  // Ensure prompt is visible even on double-click.
  // Avoid throwing async in catch: just block using readline.
  if (!process.stdin || !process.stdout) {
    process.exit(1);
  }
  if (process.stdin.isTTY && process.stdout.isTTY && !process.argv.includes('--no-wait')) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('\n解密失败。按回车键退出...', () => {
      rl.close();
      process.exit(1);
    });
  } else {
    process.exit(1);
  }
});

