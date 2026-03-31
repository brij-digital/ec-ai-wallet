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
    const agentRuntimePath = typeof protocol.agentRuntimePath === 'string' ? protocol.agentRuntimePath : null;
    const indexingSpecPath = typeof protocol.indexingSpecPath === 'string' ? protocol.indexingSpecPath : null;
    if (!agentRuntimePath || !indexingSpecPath) {
      continue;
    }
    if (!agentRuntimePath.startsWith('/idl/')) {
      fail(`Protocol ${protocol.id ?? 'unknown'} has invalid agentRuntimePath.`);
    }
    if (!indexingSpecPath.startsWith('/idl/')) {
      fail(`Protocol ${protocol.id ?? 'unknown'} has invalid indexingSpecPath.`);
    }
    const agentRuntimeFilePath = path.join(IDL_DIR, agentRuntimePath.slice('/idl/'.length));
    const agentRuntime = await loadJson(agentRuntimeFilePath);
    if (!agentRuntime || typeof agentRuntime !== 'object' || Array.isArray(agentRuntime)) {
      fail(`${agentRuntimeFilePath} did not parse as a JSON object.`);
    }
    const hasCapabilities =
      (agentRuntime.index_views && typeof agentRuntime.index_views === 'object' && !Array.isArray(agentRuntime.index_views)) ||
      (agentRuntime.computes && typeof agentRuntime.computes === 'object' && !Array.isArray(agentRuntime.computes)) ||
      (agentRuntime.contract_writes && typeof agentRuntime.contract_writes === 'object' && !Array.isArray(agentRuntime.contract_writes));
    if (!hasCapabilities) {
      fail(`${agentRuntimeFilePath} is missing agent runtime capabilities.`);
    }
    const indexingFilePath = path.join(IDL_DIR, indexingSpecPath.slice('/idl/'.length));
    const indexing = await loadJson(indexingFilePath);
    if (!indexing || typeof indexing !== 'object' || Array.isArray(indexing)) {
      fail(`${indexingFilePath} did not parse as a JSON object.`);
    }
    if (!indexing.decoderArtifacts || typeof indexing.decoderArtifacts !== 'object' || Array.isArray(indexing.decoderArtifacts)) {
      fail(`${indexingFilePath} is missing indexing decoder artifacts.`);
    }
    loadedRuntimePacks += 1;
  }

  console.log(`Wallet runtime pack smoke succeeded for ${loadedRuntimePacks} runtime pack file(s).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
