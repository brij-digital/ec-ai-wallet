import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const RPC_FIXTURE_ROOT = path.join(ROOT, 'protocol-packs', 'rpc');
const SIM_FIXTURE_DIR = path.join(RPC_FIXTURE_ROOT, 'simulations');
const PARITY_FIXTURE_DIR = path.join(RPC_FIXTURE_ROOT, 'parity');

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

function asBoolean(value, label) {
  if (typeof value !== 'boolean') {
    fail(`${label} must be a boolean.`);
  }
  return value;
}

function asOptionalBoolean(value, label) {
  if (value === undefined) {
    return undefined;
  }
  return asBoolean(value, label);
}

function asStringArray(value, label) {
  const arr = asArray(value, label);
  for (let i = 0; i < arr.length; i += 1) {
    asString(arr[i], `${label}[${i}]`);
  }
  return arr;
}

async function pathExists(filepath) {
  try {
    await fs.access(filepath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(filepath, label) {
  const raw = await fs.readFile(filepath, 'utf8').catch(() => null);
  if (raw === null) {
    fail(`${label} not found: ${path.relative(ROOT, filepath)}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    fail(`${label} is not valid JSON: ${path.relative(ROOT, filepath)}`);
  }
}

async function listFixtureFiles(dir) {
  if (!(await pathExists(dir))) {
    return [];
  }
  const files = await fs.readdir(dir);
  return files.filter((entry) => entry.endsWith('.json')).sort();
}

async function rpcRequest(rpcUrl, method, params) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `${method}-${Date.now()}`,
      method,
      params,
    }),
  });

  if (!response.ok) {
    fail(`RPC ${method} failed with HTTP ${response.status} ${response.statusText}.`);
  }

  const json = await response.json();
  if (json.error) {
    fail(`RPC ${method} error: ${JSON.stringify(json.error)}`);
  }

  return json.result;
}

function getRpcUrl() {
  return (
    process.env.PACK_RPC_URL ||
    process.env.SOLANA_RPC_URL ||
    process.env.HELIUS_RPC_URL ||
    ''
  ).trim();
}

function assertLogInclusion(logs, required, label) {
  for (const needle of required) {
    const found = logs.some((line) => line.includes(needle));
    if (!found) {
      fail(`${label}: expected logs to include "${needle}".`);
    }
  }
}

async function runSimulationFixture(rpcUrl, filename) {
  const fixturePath = path.join(SIM_FIXTURE_DIR, filename);
  const fixture = asObject(await readJsonFile(fixturePath, `simulation fixture ${filename}`), filename);

  const name = asString(fixture.name, `${filename}.name`);
  const protocolId = asString(fixture.protocolId, `${filename}.protocolId`);
  const source = asString(fixture.source, `${filename}.source`);
  if (source !== 'replay_tx') {
    fail(`${filename}.source must be replay_tx.`);
  }

  const signature = asString(fixture.signature, `${filename}.signature`);
  const expect = asObject(fixture.expect ?? {}, `${filename}.expect`);
  const expectOk = asOptionalBoolean(expect.ok, `${filename}.expect.ok`);
  const allowError = expect.allowError === undefined ? true : asBoolean(expect.allowError, `${filename}.expect.allowError`);
  const logsInclude = expect.logsInclude === undefined ? [] : asStringArray(expect.logsInclude, `${filename}.expect.logsInclude`);
  const errorIncludes = expect.errorIncludes === undefined ? [] : asStringArray(expect.errorIncludes, `${filename}.expect.errorIncludes`);

  const txResult = await rpcRequest(rpcUrl, 'getTransaction', [
    signature,
    {
      encoding: 'base64',
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    },
  ]);
  if (!txResult || !txResult.transaction || !Array.isArray(txResult.transaction) || typeof txResult.transaction[0] !== 'string') {
    fail(`${filename}: getTransaction did not return base64 transaction.`);
  }

  const txBase64 = txResult.transaction[0];
  const simulationEnvelope = await rpcRequest(rpcUrl, 'simulateTransaction', [
    txBase64,
    {
      encoding: 'base64',
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: 'confirmed',
    },
  ]);
  const simulation =
    simulationEnvelope && typeof simulationEnvelope === 'object' && 'value' in simulationEnvelope
      ? simulationEnvelope.value
      : simulationEnvelope;

  const err = simulation?.err ?? null;
  const logs = Array.isArray(simulation?.logs) ? simulation.logs : [];
  const ok = err === null;

  if (expectOk !== undefined && ok !== expectOk) {
    fail(`${filename}: expected ok=${String(expectOk)} but got ${String(ok)}.`);
  }

  if (!allowError && err !== null) {
    fail(`${filename}: simulation returned error but allowError=false: ${JSON.stringify(err)}`);
  }

  if (logsInclude.length > 0) {
    assertLogInclusion(logs, logsInclude, filename);
  }

  if (errorIncludes.length > 0) {
    const renderedErr = JSON.stringify(err);
    for (const needle of errorIncludes) {
      if (!renderedErr.includes(needle)) {
        fail(`${filename}: expected error to include "${needle}", got ${renderedErr}.`);
      }
    }
  }

  return { name, protocolId, signature, ok, err, logsCount: logs.length };
}

function collectProgramIdsFromTransactionJson(txResult) {
  const message = txResult?.transaction?.message;
  if (!message) {
    return [];
  }

  const accountKeys = Array.isArray(message.accountKeys) ? message.accountKeys : [];
  const keyStrings = accountKeys.map((entry) => {
    if (typeof entry === 'string') {
      return entry;
    }
    if (entry && typeof entry === 'object' && typeof entry.pubkey === 'string') {
      return entry.pubkey;
    }
    return '';
  });

  const instructions = Array.isArray(message.instructions) ? message.instructions : [];
  const ids = [];
  for (const ix of instructions) {
    if (!ix || typeof ix !== 'object') {
      continue;
    }
    if (typeof ix.programId === 'string') {
      ids.push(ix.programId);
      continue;
    }
    if (typeof ix.programIdIndex === 'number') {
      const programId = keyStrings[ix.programIdIndex];
      if (programId) {
        ids.push(programId);
      }
    }
  }
  return ids;
}

async function runParityFixture(rpcUrl, filename) {
  const fixturePath = path.join(PARITY_FIXTURE_DIR, filename);
  const fixture = asObject(await readJsonFile(fixturePath, `parity fixture ${filename}`), filename);

  const name = asString(fixture.name, `${filename}.name`);
  const protocolId = asString(fixture.protocolId, `${filename}.protocolId`);
  const signature = asString(fixture.signature, `${filename}.signature`);
  const expect = asObject(fixture.expect ?? {}, `${filename}.expect`);

  const txResult = await rpcRequest(rpcUrl, 'getTransaction', [
    signature,
    {
      encoding: 'json',
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    },
  ]);
  if (!txResult) {
    fail(`${filename}: transaction not found for signature ${signature}.`);
  }

  const programIdsContains =
    expect.programIdsContains === undefined
      ? []
      : asStringArray(expect.programIdsContains, `${filename}.expect.programIdsContains`);
  const logsInclude =
    expect.logsInclude === undefined ? [] : asStringArray(expect.logsInclude, `${filename}.expect.logsInclude`);
  const errorIncludes =
    expect.errorIncludes === undefined ? [] : asStringArray(expect.errorIncludes, `${filename}.expect.errorIncludes`);

  const programIds = collectProgramIdsFromTransactionJson(txResult);
  const logMessages = Array.isArray(txResult.meta?.logMessages) ? txResult.meta.logMessages : [];
  const metaErrorText = JSON.stringify(txResult.meta?.err ?? null);

  for (const programId of programIdsContains) {
    if (!programIds.includes(programId)) {
      fail(`${filename}: expected programId ${programId} in top-level instructions.`);
    }
  }

  if (logsInclude.length > 0) {
    assertLogInclusion(logMessages, logsInclude, filename);
  }

  if (errorIncludes.length > 0) {
    for (const needle of errorIncludes) {
      if (!metaErrorText.includes(needle)) {
        fail(`${filename}: expected meta error to include "${needle}", got ${metaErrorText}.`);
      }
    }
  }

  return { name, protocolId, signature, programIdsCount: programIds.length, logsCount: logMessages.length };
}

async function run() {
  const rpcUrl = getRpcUrl();
  if (!rpcUrl) {
    console.log('Skipping RPC checks: PACK_RPC_URL (or SOLANA_RPC_URL / HELIUS_RPC_URL) is not set.');
    return;
  }

  const simulationFiles = await listFixtureFiles(SIM_FIXTURE_DIR);
  const parityFiles = await listFixtureFiles(PARITY_FIXTURE_DIR);

  let simulationCount = 0;
  let parityCount = 0;

  for (const file of simulationFiles) {
    await runSimulationFixture(rpcUrl, file);
    simulationCount += 1;
  }

  for (const file of parityFiles) {
    await runParityFixture(rpcUrl, file);
    parityCount += 1;
  }

  console.log(`RPC protocol-pack checks passed: simulation=${simulationCount}, parity=${parityCount}.`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
