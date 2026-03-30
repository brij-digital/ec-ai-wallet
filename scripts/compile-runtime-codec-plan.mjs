import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const IDL_DIR = path.join(ROOT, 'public', 'idl');
const REGISTRY_PATH = path.join(IDL_DIR, 'registry.json');
const OUTPUT_PATH = path.join(IDL_DIR, 'runtime-codec-plan.json');

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
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function lowerFirst(value) {
  return value.length === 0 ? value : value[0].toLowerCase() + value.slice(1);
}

function toSnakeCase(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .replace(/__+/g, '_')
    .toLowerCase();
}

function toPascalCase(value) {
  return value
    .replace(/(^|[_-])([a-z0-9])/g, (_match, _sep, char) => char.toUpperCase())
    .replace(/[^A-Za-z0-9]/g, '');
}

function resolveIdlPath(assetPath, label) {
  const rel = asString(assetPath, label);
  if (!rel.startsWith('/idl/')) {
    fail(`${label} must start with /idl/.`);
  }
  return path.join(IDL_DIR, rel.slice('/idl/'.length));
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    fail(`Failed to read ${label}: ${path.relative(ROOT, filePath)}\n${error instanceof Error ? error.message : String(error)}`);
  }
}

function stableStringify(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function extractBytes(value, label) {
  const node = asObject(value, label);
  const encoding = asString(node.encoding, `${label}.encoding`);
  if (encoding !== 'base16') {
    fail(`${label}.encoding must be base16.`);
  }
  const data = asString(node.data, `${label}.data`);
  if (data.length % 2 !== 0) {
    fail(`${label}.data must have even hex length.`);
  }
  const bytes = [];
  for (let index = 0; index < data.length; index += 2) {
    bytes.push(Number.parseInt(data.slice(index, index + 2), 16));
  }
  return bytes;
}

function extractDiscriminatorField(fields, label) {
  const discriminatorField = fields.find((field) => field?.name === 'discriminator');
  if (!discriminatorField) {
    fail(`${label} is missing discriminator field.`);
  }
  const defaultValue = discriminatorField.defaultValue;
  if (!defaultValue) {
    fail(`${label}.discriminator defaultValue missing.`);
  }
  return extractBytes(defaultValue, `${label}.discriminator.defaultValue`);
}

function convertTypeNode(typeNode, context) {
  const node = asObject(typeNode, context);
  switch (node.kind) {
    case 'publicKeyTypeNode':
      return 'pubkey';
    case 'stringTypeNode':
      return 'string';
    case 'bytesTypeNode':
      return 'bytes';
    case 'numberTypeNode':
      return asString(node.format, `${context}.format`);
    case 'booleanTypeNode':
      return 'bool';
    case 'definedTypeLinkNode':
      return { defined: { name: toPascalCase(asString(node.name, `${context}.name`)) } };
    case 'optionTypeNode':
      return { option: convertTypeNode(node.item ?? node.type, `${context}.item`) };
    case 'arrayTypeNode': {
      const item = convertTypeNode(node.item, `${context}.item`);
      const count = asObject(node.count, `${context}.count`);
      if (count.kind === 'fixedCountNode') {
        return { array: [item, count.value] };
      }
      if (count.kind === 'prefixedCountNode') {
        return { vec: item };
      }
      fail(`${context}.count kind ${String(count.kind)} is unsupported.`);
    }
    case 'fixedSizeTypeNode': {
      const size = Number(node.size);
      const inner = asObject(node.type, `${context}.type`);
      if (inner.kind === 'bytesTypeNode') {
        return { array: ['u8', size] };
      }
      fail(`${context} fixedSizeTypeNode is unsupported unless wrapping bytes.`);
    }
    case 'sizePrefixTypeNode':
      return convertTypeNode(node.type, `${context}.type`);
    case 'tupleTypeNode': {
      const items = asArray(node.items, `${context}.items`).map((item, index) =>
        convertTypeNode(item, `${context}.items[${index}]`),
      );
      return { kind: 'struct', fields: items };
    }
    default:
      fail(`${context} kind ${String(node.kind)} is unsupported in runtime codec plan.`);
  }
}

function convertStructFields(fields, context) {
  return asArray(fields, `${context}.fields`)
    .filter((field) => field?.name !== 'discriminator')
    .map((field, index) => {
      const entry = asObject(field, `${context}.fields[${index}]`);
      return {
        name: toSnakeCase(asString(entry.name, `${context}.fields[${index}].name`)),
        type: convertTypeNode(entry.type, `${context}.fields[${index}].type`),
      };
    });
}

function convertEnumVariant(variant, context) {
  const entry = asObject(variant, context);
  const out = {
    name: toPascalCase(asString(entry.name, `${context}.name`)),
  };
  if (entry.kind === 'enumStructVariantTypeNode') {
    out.fields = convertStructFields(entry.struct?.fields ?? entry.fields, `${context}.fields`);
    return out;
  }
  if (entry.kind === 'enumTupleVariantTypeNode') {
    const items = entry.tuple?.items ?? entry.items;
    out.fields = asArray(items, `${context}.items`).map((item, index) =>
      convertTypeNode(item, `${context}.items[${index}]`),
    );
    return out;
  }
  return out;
}

function convertDefinedType(definedType, context) {
  const entry = asObject(definedType, context);
  const type = asObject(entry.type, `${context}.type`);
  const name = toPascalCase(asString(entry.name, `${context}.name`));
  if (type.kind === 'structTypeNode') {
    return {
      name,
      type: {
        kind: 'struct',
        fields: convertStructFields(type.fields, `${context}.type`),
      },
    };
  }
  if (type.kind === 'enumTypeNode') {
    return {
      name,
      type: {
        kind: 'enum',
        variants: asArray(type.variants, `${context}.type.variants`).map((variant, index) =>
          convertEnumVariant(variant, `${context}.type.variants[${index}]`),
        ),
      },
    };
  }
  if (type.kind === 'tupleTypeNode') {
    return {
      name,
      type: convertTypeNode(type, `${context}.type`),
    };
  }
  fail(`${context}.type kind ${String(type.kind)} is unsupported.`);
}

function convertInstructionAccount(account, context) {
  const entry = asObject(account, context);
  const output = {
    name: toSnakeCase(asString(entry.name, `${context}.name`)),
  };
  if (entry.isWritable === true) {
    output.writable = true;
  }
  if (entry.isSigner === true) {
    output.signer = true;
  }
  if (entry.isOptional === true) {
    output.optional = true;
  }
  const defaultValue = entry.defaultValue ? asObject(entry.defaultValue, `${context}.defaultValue`) : null;
  if (defaultValue?.kind === 'publicKeyValueNode') {
    output.address = asString(defaultValue.publicKey, `${context}.defaultValue.publicKey`);
  }
  return output;
}

function convertInstruction(instruction, context) {
  const entry = asObject(instruction, context);
  const argumentsNode = asArray(entry.arguments, `${context}.arguments`);
  const discriminatorArg = argumentsNode.find((argument) => argument?.name === 'discriminator');
  const discriminator = discriminatorArg
    ? extractBytes(asObject(discriminatorArg, `${context}.arguments.discriminator`).defaultValue, `${context}.arguments.discriminator.defaultValue`)
    : fail(`${context} is missing discriminator argument.`);
  return {
    name: toSnakeCase(asString(entry.name, `${context}.name`)),
    discriminator,
    accounts: asArray(entry.accounts, `${context}.accounts`).map((account, index) =>
      convertInstructionAccount(account, `${context}.accounts[${index}]`),
    ),
    args: argumentsNode
      .filter((argument) => argument?.name !== 'discriminator')
      .map((argument, index) => {
        const arg = asObject(argument, `${context}.arguments[${index}]`);
        return {
          name: toSnakeCase(asString(arg.name, `${context}.arguments[${index}].name`)),
          type: convertTypeNode(arg.type, `${context}.arguments[${index}].type`),
        };
      }),
  };
}

function convertAccount(account, context) {
  const entry = asObject(account, context);
  const data = asObject(entry.data, `${context}.data`);
  if (data.kind !== 'structTypeNode') {
    fail(`${context}.data kind ${String(data.kind)} is unsupported.`);
  }
  const fields = asArray(data.fields, `${context}.data.fields`);
  return {
    name: toPascalCase(asString(entry.name, `${context}.name`)),
    discriminator: extractDiscriminatorField(fields, `${context}.data`),
  };
}

function convertAccountType(account, context) {
  const entry = asObject(account, context);
  const data = asObject(entry.data, `${context}.data`);
  if (data.kind !== 'structTypeNode') {
    fail(`${context}.data kind ${String(data.kind)} is unsupported.`);
  }
  return {
    name: toPascalCase(asString(entry.name, `${context}.name`)),
    type: {
      kind: 'struct',
      fields: convertStructFields(data.fields, `${context}.data`),
    },
  };
}

function buildAnchorIdl(protocolId, programId, codama) {
  const program = asObject(codama.program, `${protocolId}.codama.program`);
  const accounts = asArray(program.accounts ?? [], `${protocolId}.codama.program.accounts`);
  const instructions = asArray(program.instructions ?? [], `${protocolId}.codama.program.instructions`);
  const definedTypes = asArray(program.definedTypes ?? [], `${protocolId}.codama.program.definedTypes`);

  return {
    address: programId,
    metadata: {
      name: toSnakeCase(asString(program.name, `${protocolId}.codama.program.name`)),
      version: asString(program.version ?? '0.1.0', `${protocolId}.codama.program.version`),
      spec: '0.1.0',
    },
    instructions: instructions.map((instruction, index) =>
      convertInstruction(instruction, `${protocolId}.codama.program.instructions[${index}]`),
    ),
    accounts: accounts.map((account, index) =>
      convertAccount(account, `${protocolId}.codama.program.accounts[${index}]`),
    ),
    types: [
      ...accounts.map((account, index) =>
        convertAccountType(account, `${protocolId}.codama.program.accounts[${index}]`),
      ),
      ...definedTypes.map((definedType, index) =>
        convertDefinedType(definedType, `${protocolId}.codama.program.definedTypes[${index}]`),
      ),
    ],
  };
}

async function main() {
  const checkMode = process.argv.includes('--check');
  const registry = asObject(await readJson(REGISTRY_PATH, 'registry'), 'registry');
  const protocols = asArray(registry.protocols, 'registry.protocols');
  const compiled = {
    schema: 'apppack-runtime-codec-plan.v1',
    version: '0.1.0',
    protocols: [],
  };

  for (const manifestRaw of protocols) {
    const manifest = asObject(manifestRaw, 'registry.protocol');
    if (manifest.status === 'inactive') {
      continue;
    }
    const protocolId = asString(manifest.id, 'registry.protocol.id');
    const programId = asString(manifest.programId, `${protocolId}.programId`);
    const runtimeSpecPath = resolveIdlPath(manifest.runtimeSpecPath, `${protocolId}.runtimeSpecPath`);
    const runtime = asObject(await readJson(runtimeSpecPath, `${protocolId} runtime`), `${protocolId} runtime`);
    const decoderArtifacts = asObject(runtime.decoderArtifacts, `${protocolId}.decoderArtifacts`);
    const artifacts = {};
    for (const [artifactName, artifactRaw] of Object.entries(decoderArtifacts)) {
      const artifact = asObject(artifactRaw, `${protocolId}.decoderArtifacts.${artifactName}`);
      const family = asString(artifact.family ?? 'codama', `${protocolId}.decoderArtifacts.${artifactName}.family`);
      if (family !== 'codama') {
        fail(`${protocolId}.${artifactName}: only codama decoder artifacts are supported.`);
      }
      const codamaPath = resolveIdlPath(artifact.codamaPath, `${protocolId}.decoderArtifacts.${artifactName}.codamaPath`);
      const codama = asObject(await readJson(codamaPath, `${protocolId}.${artifactName} codama`), `${protocolId}.${artifactName} codama`);
      artifacts[artifactName] = {
        artifact: asString(artifact.artifact, `${protocolId}.decoderArtifacts.${artifactName}.artifact`),
        family,
        codamaPath: artifact.codamaPath,
        anchorIdl: buildAnchorIdl(protocolId, programId, codama),
      };
    }
    compiled.protocols.push({
      protocolId,
      programId,
      artifacts,
    });
  }

  const output = stableStringify(compiled);
  if (checkMode) {
    const current = await fs.readFile(OUTPUT_PATH, 'utf8').catch(() => null);
    if (current !== output) {
      fail(`runtime-codec-plan.json is out of date. Rerun node scripts/compile-runtime-codec-plan.mjs`);
    }
    console.log(`runtime codec plan is up to date at ${path.relative(ROOT, OUTPUT_PATH)}.`);
    return;
  }

  await fs.writeFile(OUTPUT_PATH, output, 'utf8');
  console.log(`wrote ${path.relative(ROOT, OUTPUT_PATH)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
