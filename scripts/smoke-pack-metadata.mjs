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

  let loadedPackFiles = 0;
  for (const protocol of registry.protocols) {
    if (!protocol || typeof protocol !== 'object') {
      fail('Registry contains an invalid protocol entry.');
    }
    const appPath = typeof protocol.appPath === 'string' ? protocol.appPath : null;
    if (!appPath || !appPath.startsWith('/idl/')) {
      fail(`Protocol ${protocol.id ?? 'unknown'} is missing a valid appPath.`);
    }
    const filePath = path.join(IDL_DIR, appPath.slice('/idl/'.length));
    const parsed = await loadJson(filePath);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      fail(`${filePath} did not parse as a JSON object.`);
    }
    if (!parsed.operations || typeof parsed.operations !== 'object' || Array.isArray(parsed.operations)) {
      fail(`${filePath} is missing operations.`);
    }
    loadedPackFiles += 1;
  }

  console.log(`Wallet pack metadata smoke succeeded for ${loadedPackFiles} protocol pack file(s).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
