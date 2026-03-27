import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const TARGET_DIR = path.join(ROOT, 'public/idl');
const RUNTIME_DIR = process.env.APPPACK_RUNTIME_DIR?.trim()
  ? path.resolve(process.env.APPPACK_RUNTIME_DIR.trim())
  : path.resolve(ROOT, '../apppack-runtime');
const SOURCE_DIR = path.join(RUNTIME_DIR, 'schemas');
const FILES = [
  'meta_idl.schema.v0.6.json',
  'meta_idl.core.schema.v0.6.json',
  'meta_view.schema.v0.2.json',
  'meta_view.schema.v0.3.json',
  'meta_app.schema.v0.1.json',
];

function fail(message) {
  throw new Error(message);
}

async function readFileOrNull(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

async function main() {
  const checkMode = process.argv.includes('--check');
  const updates = [];

  await fs.access(SOURCE_DIR).catch(() => fail(`Runtime schema source not found: ${SOURCE_DIR}`));

  for (const fileName of FILES) {
    const sourcePath = path.join(SOURCE_DIR, fileName);
    const targetPath = path.join(TARGET_DIR, fileName);
    const sourceText = await fs.readFile(sourcePath, 'utf8');
    const normalized = sourceText.endsWith('\n') ? sourceText : `${sourceText}\n`;

    if (checkMode) {
      const current = await readFileOrNull(targetPath);
      if (current !== normalized) {
        updates.push(fileName);
      }
      continue;
    }

    await fs.writeFile(targetPath, normalized, 'utf8');
    updates.push(fileName);
  }

  if (checkMode) {
    if (updates.length > 0) {
      fail(`Runtime-owned schema copies are out of date:\n- ${updates.join('\n- ')}`);
    }
    console.log(`Runtime schema copies are up to date from ${SOURCE_DIR}`);
    return;
  }

  console.log(`Synced ${updates.length} runtime-owned schema file(s) from ${SOURCE_DIR}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
