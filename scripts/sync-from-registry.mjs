import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const REGISTRY_DIR = process.env.APPPACK_REGISTRY_DIR?.trim()
  ? path.resolve(process.env.APPPACK_REGISTRY_DIR.trim())
  : path.resolve(ROOT, '../protocol-registry');
const TARGET_DIR = path.join(ROOT, 'public', 'idl');

const CHECK_MODE = process.argv.includes('--check');

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function syncFile(srcPath, destPath, destName) {
  const src = await fs.readFile(srcPath, 'utf8');
  if (CHECK_MODE) {
    try {
      const dest = await fs.readFile(destPath, 'utf8');
      if (src !== dest) {
        throw new Error(`Out of date: ${destName}`);
      }
    } catch (e) {
      if (e.code === 'ENOENT') throw new Error(`Missing: ${destName}`);
      throw e;
    }
    return;
  }
  await fs.writeFile(destPath, src, 'utf8');
}

async function main() {
  const registry = await readJson(path.join(REGISTRY_DIR, 'registry.json'));
  const synced = [];
  const outOfDate = [];

  // Sync registry.json itself (but keep wallet's own version with /idl/ paths)
  // We need to rewrite paths from /codama/X.json to /idl/X.codama.json etc.
  const walletRegistry = JSON.parse(JSON.stringify(registry));
  
  // Keep token-index in wallet registry (it's wallet-only)
  // Add it back from the existing wallet registry
  try {
    const existingReg = await readJson(path.join(TARGET_DIR, 'registry.json'));
    const tokenIndex = existingReg.protocols?.find(p => p.id === 'token-index-mainnet');
    if (tokenIndex) {
      walletRegistry.protocols.push(tokenIndex);
    }
  } catch {}

  // Rewrite paths for wallet (flat /idl/ structure)
  for (const p of walletRegistry.protocols) {
    if (p.id === 'token-index-mainnet') continue;
    const slug = p.id.replace('-mainnet', '').replace(/-/g, '_');
    p.codamaIdlPath = `/idl/${slug}.codama.json`;
    p.agentRuntimePath = `/idl/${slug}.runtime.json`;
    if (p.ingestSpecPath) p.ingestSpecPath = `/idl/${slug}.ingest.json`;
    if (p.indexedReadsPath) p.indexedReadsPath = `/idl/${slug}.indexed-reads.json`;
  }

  if (!CHECK_MODE) {
    await fs.writeFile(
      path.join(TARGET_DIR, 'registry.json'),
      JSON.stringify(walletRegistry, null, 2) + '\n',
      'utf8'
    );
  }
  synced.push('registry.json');

  // Sync schemas
  for (const name of await fs.readdir(path.join(REGISTRY_DIR, 'schemas'))) {
    try {
      await syncFile(
        path.join(REGISTRY_DIR, 'schemas', name),
        path.join(TARGET_DIR, name),
        name
      );
      synced.push(name);
    } catch (e) {
      outOfDate.push(e.message);
    }
  }

  // Sync protocol files
  for (const p of registry.protocols) {
    const slug = p.id.replace('-mainnet', '').replace(/-/g, '_');
    const regSlug = p.id.replace('-mainnet', '');
    
    const mappings = [
      [`runtime/${regSlug}.json`, `${slug}.runtime.json`],
      [`codama/${regSlug}.json`, `${slug}.codama.json`],
    ];
    if (p.ingestSpecPath) mappings.push([`indexing/ingest/${regSlug}.json`, `${slug}.ingest.json`]);
    if (p.indexedReadsPath) mappings.push([`indexing/indexed-reads/${regSlug}.json`, `${slug}.indexed-reads.json`]);

    for (const [regFile, walletFile] of mappings) {
      try {
        await syncFile(
          path.join(REGISTRY_DIR, regFile),
          path.join(TARGET_DIR, walletFile),
          walletFile
        );
        synced.push(walletFile);
      } catch (e) {
        outOfDate.push(e.message);
      }
    }
  }

  // Sync action runners
  for (const name of await fs.readdir(path.join(REGISTRY_DIR, 'action-runners'))) {
    try {
      await syncFile(
        path.join(REGISTRY_DIR, 'action-runners', name),
        path.join(TARGET_DIR, name),
        name
      );
      synced.push(name);
    } catch (e) {
      outOfDate.push(e.message);
    }
  }

  if (CHECK_MODE && outOfDate.length > 0) {
    console.error(`Protocol registry sync check failed:\n${outOfDate.map(m => `  - ${m}`).join('\n')}`);
    process.exit(1);
  }

  console.log(`Synced ${synced.length} file(s) from ${REGISTRY_DIR}.`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
