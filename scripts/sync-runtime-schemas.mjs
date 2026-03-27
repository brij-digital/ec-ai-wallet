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
const MANAGED_SCHEMA_PATTERN = /^meta_.*\.schema\.v.*\.json$/;

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

async function listManagedSchemaExtras() {
  const entries = await fs.readdir(TARGET_DIR, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => MANAGED_SCHEMA_PATTERN.test(name))
    .filter((name) => !FILES.includes(name))
    .sort();
}

async function main() {
  const checkMode = process.argv.includes('--check');
  const updates = [];
  const extras = [];

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

  const extraManagedFiles = await listManagedSchemaExtras();
  if (checkMode) {
    extras.push(...extraManagedFiles);
  } else {
    for (const fileName of extraManagedFiles) {
      await fs.unlink(path.join(TARGET_DIR, fileName));
      extras.push(fileName);
    }
  }

  if (checkMode) {
    if (updates.length > 0 || extras.length > 0) {
      const chunks = [];
      if (updates.length > 0) {
        chunks.push(`Out of date copies:\n- ${updates.join('\n- ')}`);
      }
      if (extras.length > 0) {
        chunks.push(`Unexpected managed schema files:\n- ${extras.join('\n- ')}`);
      }
      fail(
        `Runtime-owned schema copies in ${TARGET_DIR} are out of date.\nEdit only ${SOURCE_DIR}, then rerun npm run schemas:sync.\n\n${chunks.join('\n\n')}`,
      );
    }
    console.log(`Runtime schema copies are up to date from ${SOURCE_DIR}. Do not edit ${TARGET_DIR} by hand.`);
    return;
  }

  console.log(
    `Synced ${updates.length} runtime-owned schema file(s) from ${SOURCE_DIR} and removed ${extras.length} stale managed file(s). Do not edit ${TARGET_DIR} by hand.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
