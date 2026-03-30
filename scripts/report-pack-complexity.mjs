import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const IDL_DIR = path.join(ROOT, 'public', 'idl');
const REGISTRY_PATH = path.join(IDL_DIR, 'registry.json');
const BUDGET_PATH = path.join(ROOT, 'protocol-packs', 'complexity-budget.json');

function asObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function asArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value;
}

function asNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

async function readJson(filePath, label) {
  const raw = await fs.readFile(filePath, 'utf8').catch(() => null);
  if (raw === null) {
    throw new Error(`${label} not found: ${path.relative(ROOT, filePath)}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${label} is invalid JSON: ${path.relative(ROOT, filePath)}`);
  }
}

function toLocalPublicPath(assetPath, label) {
  const cleaned = asNonEmptyString(assetPath, label);
  if (!cleaned.startsWith('/idl/')) {
    throw new Error(`${label} must start with /idl/.`);
  }
  const resolved = path.normalize(path.join(ROOT, 'public', cleaned.slice(1)));
  if (!resolved.startsWith(path.join(ROOT, 'public'))) {
    throw new Error(`${label} resolves outside public/.`);
  }
  return resolved;
}

function renderMarkdownTable(rows) {
  const header = [
    '| Protocol | Ops | Max Derive/Op | Max Compute/Op | Budget |',
    '|---|---:|---:|---:|---|',
  ];
  const body = rows.map((row) =>
    `| ${row.protocolId} | ${row.ops} | ${row.maxDerivePerOp} | ${row.maxComputePerOp} | ${row.withinBudget ? 'OK' : 'FAIL'} |`,
  );
  return [...header, ...body].join('\n');
}

async function appendGithubSummary(markdown, violations) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    return;
  }
  const lines = ['## Protocol Runtime Complexity', '', markdown, ''];
  if (violations.length === 0) {
    lines.push('Status: within configured complexity budget.');
  } else {
    lines.push('Status: budget violations detected.', '');
    for (const violation of violations) {
      lines.push(`- ${violation}`);
    }
  }
  lines.push('');
  await fs.appendFile(summaryPath, `${lines.join('\n')}\n`, 'utf8');
}

async function main() {
  const enforce = process.argv.includes('--enforce');
  const registry = asObject(await readJson(REGISTRY_PATH, 'IDL registry'), 'registry');
  const budgetConfig = asObject(await readJson(BUDGET_PATH, 'complexity budget'), 'budget');
  const global = asObject(budgetConfig.global, 'budget.global');
  const maxOperationsPerProtocol = Number(global.max_operations_per_protocol);
  const maxDerivePerOperation = Number(global.max_derive_per_operation);
  const maxComputePerOperation = Number(global.max_compute_per_operation);

  const protocols = asArray(registry.protocols, 'registry.protocols');
  const rows = [];
  const violations = [];

  for (const protocolRaw of protocols) {
    const protocol = asObject(protocolRaw, 'registry.protocol');
    if (protocol.status === 'inactive') {
      continue;
    }
    const protocolId = asNonEmptyString(protocol.id, 'registry.protocol.id');
    if (protocol.appPath !== undefined) {
      throw new Error(`${protocolId}: appPath is no longer allowed.`);
    }
    if (!protocol.agentRuntimePath) {
      continue;
    }

    const runtimePack = asObject(
      await readJson(toLocalPublicPath(protocol.agentRuntimePath, `${protocolId}.agentRuntimePath`), `${protocolId} agent runtime`),
      `${protocolId}.agentRuntime`,
    );
    const sections = [
      ...Object.entries(asObject(runtimePack.reads?.contract ?? {}, `${protocolId}.agentRuntime.reads.contract`)),
      ...Object.entries(asObject(runtimePack.reads?.index ?? {}, `${protocolId}.agentRuntime.reads.index`)),
      ...Object.entries(asObject(runtimePack.computes ?? {}, `${protocolId}.agentRuntime.computes`)),
      ...Object.entries(asObject(runtimePack.executions ?? {}, `${protocolId}.agentRuntime.executions`)),
    ];
    const opEntries = sections;
    const opCount = opEntries.length;
    let maxDerive = 0;
    let maxCompute = 0;
    for (const [operationId, opRaw] of opEntries) {
      const op = asObject(opRaw, `${protocolId}.agentRuntime.operation.${operationId}`);
      const derive = Array.isArray(op.derive) ? op.derive.length : 0;
      const compute = Array.isArray(op.compute) ? op.compute.length : 0;
      if (derive > maxDerive) {
        maxDerive = derive;
      }
      if (compute > maxCompute) {
        maxCompute = compute;
      }
    }

    const rowViolations = [];
    if (opCount > maxOperationsPerProtocol) {
      rowViolations.push(`ops ${opCount} > ${maxOperationsPerProtocol}`);
    }
    if (maxDerive > maxDerivePerOperation) {
      rowViolations.push(`max derive/op ${maxDerive} > ${maxDerivePerOperation}`);
    }
    if (maxCompute > maxComputePerOperation) {
      rowViolations.push(`max compute/op ${maxCompute} > ${maxComputePerOperation}`);
    }
    const withinBudget = rowViolations.length === 0;
    if (!withinBudget) {
      violations.push(`${protocolId}: ${rowViolations.join(', ')}`);
    }

    rows.push({
      protocolId,
      ops: opCount,
      maxDerivePerOp: maxDerive,
      maxComputePerOp: maxCompute,
      withinBudget,
    });
  }

  const markdown = renderMarkdownTable(rows);
  console.log('Protocol runtime complexity report');
  console.log(markdown);
  if (violations.length > 0) {
    console.log('\nBudget violations:');
    for (const violation of violations) {
      console.log(`- ${violation}`);
    }
  } else {
    console.log('\nAll runtime-backed protocols are within budget.');
  }

  await appendGithubSummary(markdown, violations);

  if (enforce && violations.length > 0) {
    throw new Error(`Complexity budget exceeded in ${violations.length} protocol(s).`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
