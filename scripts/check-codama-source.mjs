import fs from 'node:fs/promises';
import path from 'node:path';
import { PublicKey } from '@solana/web3.js';

const ROOT = process.cwd();
const PUBLIC_IDL_DIR = path.join(ROOT, 'public', 'idl');
const REGISTRY_PATH = path.join(PUBLIC_IDL_DIR, 'registry.json');

function fail(message) {
  throw new Error(message);
}

function asObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  return value;
}

function asArray(value, label) {
  if (!Array.isArray(value)) {
    fail(`${label} must be an array.`);
  }
  return value;
}

function asString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${label} must be a non-empty string.`);
  }
  return value;
}

function normalizePubkey(value, label) {
  try {
    return new PublicKey(asString(value, label)).toBase58();
  } catch {
    fail(`${label} must be a valid public key.`);
  }
}

function resolveIdlPath(assetPath, label) {
  const rel = asString(assetPath, label);
  if (!rel.startsWith('/idl/')) {
    fail(`${label} must start with /idl/.`);
  }
  return path.join(PUBLIC_IDL_DIR, rel.slice('/idl/'.length));
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    fail(`${label} could not be read: ${path.relative(ROOT, filePath)} (${error instanceof Error ? error.message : String(error)})`);
  }
}

async function main() {
  const registry = asObject(await readJson(REGISTRY_PATH, 'registry'), 'registry');
  const protocols = asArray(registry.protocols, 'registry.protocols');

  for (const [index, rawProtocol] of protocols.entries()) {
    const protocol = asObject(rawProtocol, `registry.protocols[${index}]`);
    const id = asString(protocol.id, `registry.protocols[${index}].id`);
    const status = asString(protocol.status, `${id}.status`);
    if (status !== 'active' && status !== 'inactive') {
      fail(`${id}.status must be active or inactive.`);
    }

    const programId = normalizePubkey(protocol.programId, `${id}.programId`);
    const codamaIdlPath = resolveIdlPath(protocol.codamaIdlPath, `${id}.codamaIdlPath`);
    const codama = asObject(await readJson(codamaIdlPath, `${id} codama`), `${id} codama`);
    if (codama.standard !== 'codama') {
      fail(`${id}.codamaIdlPath is not a Codama IDL.`);
    }
    const program = asObject(codama.program, `${id}.codama.program`);
    const codamaProgramId = normalizePubkey(program.publicKey, `${id}.codama.program.publicKey`);
    if (codamaProgramId !== programId) {
      fail(`${id}: registry.programId (${programId}) does not match codama.program.publicKey (${codamaProgramId}).`);
    }

    if (protocol.idlPath !== undefined) {
      fail(`${id}.idlPath is no longer allowed.`);
    }
  }

  console.log(`Codama source-of-truth checks passed for ${protocols.length} protocol(s).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
