import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const IDL_DIR = path.join(ROOT, 'public', 'idl');
const REGISTRY_PATH = path.join(IDL_DIR, 'registry.json');

function fail(message) {
  throw new Error(message);
}

async function loadJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function main() {
  const registry = await loadJson(REGISTRY_PATH);
  if (!registry || typeof registry !== 'object' || !Array.isArray(registry.protocols)) {
    fail(`Invalid registry: ${REGISTRY_PATH}`);
  }

  let loadedRuntimePacks = 0;
  for (const protocol of registry.protocols) {
    if (!protocol || typeof protocol !== 'object') {
      fail('Registry contains an invalid protocol entry.');
    }
    if (protocol.appPath !== undefined) {
      fail(`Protocol ${protocol.id ?? 'unknown'} still declares appPath.`);
    }
    const runtimeSpecPath = typeof protocol.runtimeSpecPath === 'string' ? protocol.runtimeSpecPath : null;
    if (!runtimeSpecPath) {
      continue;
    }
    if (!runtimeSpecPath.startsWith('/idl/')) {
      fail(`Protocol ${protocol.id ?? 'unknown'} has invalid runtimeSpecPath.`);
    }
    const filePath = path.join(IDL_DIR, runtimeSpecPath.slice('/idl/'.length));
    const parsed = await loadJson(filePath);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      fail(`${filePath} did not parse as a JSON object.`);
    }
    if (!parsed.operations || typeof parsed.operations !== 'object' || Array.isArray(parsed.operations)) {
      fail(`${filePath} is missing runtime operations.`);
    }
    loadedRuntimePacks += 1;
  }

  console.log(`Wallet runtime pack smoke succeeded for ${loadedRuntimePacks} runtime pack file(s).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
