import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

const ROOT = process.cwd();
const PUBLIC_IDL_DIR = path.join(ROOT, 'public', 'idl');
const REGISTRY_PATH = path.join(PUBLIC_IDL_DIR, 'registry.json');
const CODAMA_BIN = path.join(ROOT, 'node_modules', '.bin', 'codama');

function fail(message) {
  throw new Error(message);
}

function asObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  return value;
}

function asString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${label} must be a non-empty string.`);
  }
  return value;
}

async function readFileOrNull(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

function resolvePublicIdlPath(assetPath, label) {
  const rel = asString(assetPath, label);
  if (!rel.startsWith('/idl/')) {
    fail(`${label} must start with /idl/.`);
  }
  return path.join(PUBLIC_IDL_DIR, rel.slice('/idl/'.length));
}

async function loadRegistry() {
  const raw = await fs.readFile(REGISTRY_PATH, 'utf8');
  return asObject(JSON.parse(raw), 'registry');
}

async function convertToCodama(sourcePath) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codama-compile-'));
  const outputPath = path.join(tmpDir, 'out.json');
  try {
    await execFile(CODAMA_BIN, ['convert', sourcePath, outputPath], {
      cwd: ROOT,
      env: process.env,
      maxBuffer: 8 * 1024 * 1024,
    });
    const output = await fs.readFile(outputPath, 'utf8');
    return output.endsWith('\n') ? output : `${output}\n`;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function listManagedCodamaExtras(expectedFiles) {
  const entries = await fs.readdir(PUBLIC_IDL_DIR, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith('.codama.json'))
    .filter((name) => !expectedFiles.has(name))
    .sort();
}

async function main() {
  const checkMode = process.argv.includes('--check');
  await fs.access(CODAMA_BIN).catch(() => fail(`Codama CLI not found: ${CODAMA_BIN}`));

  const registry = await loadRegistry();
  const protocols = Array.isArray(registry.protocols) ? registry.protocols : fail('registry.protocols must be an array.');
  const expectedFiles = new Set();
  const updates = [];
  const extras = [];

  for (const [index, protocolRaw] of protocols.entries()) {
    const protocol = asObject(protocolRaw, `registry.protocols[${index}]`);
    if (!protocol.idlPath || !protocol.codamaIdlPath) {
      continue;
    }
    const sourcePath = resolvePublicIdlPath(protocol.idlPath, `${protocol.id}.idlPath`);
    const targetPath = resolvePublicIdlPath(protocol.codamaIdlPath, `${protocol.id}.codamaIdlPath`);
    expectedFiles.add(path.basename(targetPath));

    const converted = await convertToCodama(sourcePath);
    if (checkMode) {
      const current = await readFileOrNull(targetPath);
      if (current !== converted) {
        updates.push(path.basename(targetPath));
      }
      continue;
    }

    await fs.writeFile(targetPath, converted, 'utf8');
    updates.push(path.basename(targetPath));
  }

  const extraFiles = await listManagedCodamaExtras(expectedFiles);
  if (checkMode) {
    extras.push(...extraFiles);
  } else {
    for (const name of extraFiles) {
      await fs.unlink(path.join(PUBLIC_IDL_DIR, name));
      extras.push(name);
    }
  }

  if (checkMode) {
    if (updates.length > 0 || extras.length > 0) {
      const chunks = [];
      if (updates.length > 0) {
        chunks.push(`Out of date Codama artifacts:\n- ${updates.join('\n- ')}`);
      }
      if (extras.length > 0) {
        chunks.push(`Unexpected managed Codama artifacts:\n- ${extras.join('\n- ')}`);
      }
      fail(
        `Codama-generated artifacts in ${PUBLIC_IDL_DIR} are out of date.\nEdit only the source IDLs and registry, then rerun npm run codama:compile.\n\n${chunks.join('\n\n')}`,
      );
    }
    console.log(`Codama artifacts are up to date in ${PUBLIC_IDL_DIR}. Do not edit *.codama.json by hand.`);
    return;
  }

  console.log(
    `Synced ${updates.length} Codama artifact(s) in ${PUBLIC_IDL_DIR} and removed ${extras.length} stale Codama file(s). Do not edit *.codama.json by hand.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
