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

function toRegistryStem(assetPath) {
  return path.posix.basename(assetPath, '.json');
}

function rewriteRootPathForWalletLayout(assetPath) {
  if (typeof assetPath !== 'string' || !assetPath.startsWith('/')) {
    return assetPath;
  }
  if (assetPath.startsWith('/idl/')) {
    return assetPath;
  }
  if (assetPath.startsWith('/schemas/')) {
    return `/idl/${path.posix.basename(assetPath)}`;
  }
  if (assetPath.startsWith('/codama/')) {
    return `/idl/${toRegistryStem(assetPath).replace(/-/gu, '_')}.codama.json`;
  }
  if (assetPath.startsWith('/runtime/')) {
    return `/idl/${toRegistryStem(assetPath).replace(/-/gu, '_')}.runtime.json`;
  }
  if (assetPath.startsWith('/indexing/ingest/')) {
    return `/idl/${toRegistryStem(assetPath).replace(/-/gu, '_')}.ingest.json`;
  }
  if (assetPath.startsWith('/indexing/indexed-reads/')) {
    return `/idl/${toRegistryStem(assetPath).replace(/-/gu, '_')}.indexed-reads.json`;
  }
  if (assetPath.startsWith('/indexing/entities/')) {
    return `/idl/${toRegistryStem(assetPath).replace(/-/gu, '_')}.entities.json`;
  }
  if (assetPath.startsWith('/action-runners/')) {
    return `/idl/${path.posix.basename(assetPath)}`;
  }
  return assetPath;
}

function rewriteWalletJson(value) {
  if (Array.isArray(value)) {
    return value.map(rewriteWalletJson);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const rewritten = {};
  for (const [key, child] of Object.entries(value)) {
    if (
      typeof child === 'string'
      && (
        key === '$schema'
        || key === 'codama_path'
        || key === 'codamaPath'
        || key === 'codamaIdlPath'
        || key === 'agentRuntimePath'
        || key === 'indexedReadsPath'
        || key === 'entitySchemaPath'
        || key === 'ingestSpecPath'
      )
    ) {
      rewritten[key] = rewriteRootPathForWalletLayout(child);
      continue;
    }
    rewritten[key] = rewriteWalletJson(child);
  }
  return rewritten;
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

async function syncJsonFile(srcPath, destPath, destName, transform = (value) => value) {
  const raw = await fs.readFile(srcPath, 'utf8');
  const src = JSON.stringify(transform(JSON.parse(raw)), null, 2) + '\n';
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

function toWalletSlug(value) {
  return value.replace(/-mainnet$/u, '').replace(/-/gu, '_');
}

async function main() {
  const registry = await readJson(path.join(REGISTRY_DIR, 'registry.json'));
  const synced = [];
  const outOfDate = [];

  // Sync registry.json itself for the wallet /idl/ layout.
  const walletRegistry = JSON.parse(JSON.stringify(registry));

  // Rewrite paths for wallet (flat /idl/ structure)
  for (const p of walletRegistry.protocols) {
    const slug = toWalletSlug(p.id);
    p.codamaIdlPath = `/idl/${slug}.codama.json`;
    p.agentRuntimePath = `/idl/${slug}.runtime.json`;
    if (p.indexedReadsPath) p.indexedReadsPath = `/idl/${slug}.indexed-reads.json`;
    delete p.ingestSpecPath;
  }

  walletRegistry.indexings = Array.isArray(walletRegistry.indexings)
    ? walletRegistry.indexings.map((indexing) => {
      const indexingSlug = toWalletSlug(indexing.id);
      return {
        ...indexing,
        entitySchemaPath: indexing.entitySchemaPath ? `/idl/${indexingSlug}.entities.json` : indexing.entitySchemaPath,
        sources: Array.isArray(indexing.sources)
          ? indexing.sources.map((source) => ({
            ...source,
            ingestSpecPath: `/idl/${toWalletSlug(source.protocolId)}.ingest.json`,
          }))
          : [],
      };
    })
    : [];

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
    const slug = toWalletSlug(p.id);
    const regSlug = p.id.replace(/-mainnet$/u, '');
    
    const mappings = [
      [`runtime/${regSlug}.json`, `${slug}.runtime.json`],
      [`codama/${regSlug}.json`, `${slug}.codama.json`],
    ];
    if (p.indexedReadsPath) mappings.push([`indexing/indexed-reads/${regSlug}.json`, `${slug}.indexed-reads.json`]);

    for (const [regFile, walletFile] of mappings) {
      try {
        const sync = regFile.startsWith('runtime/') || regFile.startsWith('indexing/indexed-reads/')
          ? syncJsonFile
          : syncFile;
        const transform = regFile.startsWith('runtime/') || regFile.startsWith('indexing/indexed-reads/')
          ? rewriteWalletJson
          : undefined;
        await sync(
          path.join(REGISTRY_DIR, regFile),
          path.join(TARGET_DIR, walletFile),
          walletFile,
          transform,
        );
        synced.push(walletFile);
      } catch (e) {
        outOfDate.push(e.message);
      }
    }
  }

  if (Array.isArray(registry.indexings)) {
    for (const indexing of registry.indexings) {
      const indexingSlug = toWalletSlug(indexing.id);
      if (indexing.entitySchemaPath) {
        try {
          await syncJsonFile(
            path.join(REGISTRY_DIR, indexing.entitySchemaPath.slice(1)),
            path.join(TARGET_DIR, `${indexingSlug}.entities.json`),
            `${indexingSlug}.entities.json`,
            rewriteWalletJson,
          );
          synced.push(`${indexingSlug}.entities.json`);
        } catch (e) {
          outOfDate.push(e.message);
        }
      }
      for (const source of Array.isArray(indexing.sources) ? indexing.sources : []) {
        const sourceSlug = toWalletSlug(source.protocolId);
        try {
          await syncJsonFile(
            path.join(REGISTRY_DIR, source.ingestSpecPath.slice(1)),
            path.join(TARGET_DIR, `${sourceSlug}.ingest.json`),
            `${sourceSlug}.ingest.json`,
            rewriteWalletJson,
          );
          synced.push(`${sourceSlug}.ingest.json`);
        } catch (e) {
          outOfDate.push(e.message);
        }
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
