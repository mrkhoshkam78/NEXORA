import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(process.cwd());
const dir = path.join(root, 'config');
const keyPath = path.join(dir, 'master.key');
const dataPath = path.join(dir, 'connection.enc.json');

async function ensureDir() { await fs.mkdir(dir, { recursive: true, mode: 0o700 }); }
async function getKey() {
  await ensureDir();
  try { return await fs.readFile(keyPath); } catch {}
  const key = crypto.randomBytes(32);
  await fs.writeFile(keyPath, key, { mode: 0o600 });
  return key;
}

export async function saveConnection(connection) {
  const key = await getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(connection), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  await ensureDir();
  await fs.writeFile(dataPath, JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: ciphertext.toString('base64')
  }), { mode: 0o600 });
}

export async function loadConnection() {
  try {
    const raw = JSON.parse(await fs.readFile(dataPath, 'utf8'));
    const key = await getKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(raw.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(raw.tag, 'base64'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(raw.data, 'base64')), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch { return null; }
}

export async function clearConnection() {
  try { await fs.unlink(dataPath); } catch {}
}
