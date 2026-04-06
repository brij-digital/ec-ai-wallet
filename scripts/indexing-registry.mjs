export function listAllIndexingSources(registry) {
  const indexings = Array.isArray(registry?.indexings) ? registry.indexings : [];
  const results = [];
  for (const indexing of indexings) {
    if (!indexing || typeof indexing !== 'object') {
      continue;
    }
    const indexingId = typeof indexing.id === 'string' ? indexing.id : 'unknown-indexing';
    const sources = Array.isArray(indexing.sources) ? indexing.sources : [];
    for (const source of sources) {
      if (!source || typeof source !== 'object') {
        continue;
      }
      if (typeof source.protocolId !== 'string' || typeof source.ingestSpecPath !== 'string') {
        continue;
      }
      results.push({
        indexingId,
        sourceId: typeof source.id === 'string' ? source.id : `${indexingId}-source`,
        protocolId: source.protocolId,
        ingestSpecPath: source.ingestSpecPath,
      });
    }
  }
  return results;
}

export function listIndexingSourcesForProtocol(registry, protocolId) {
  return listAllIndexingSources(registry).filter((source) => source.protocolId === protocolId);
}
