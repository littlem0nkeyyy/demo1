export function QueryResult({
  queryText,
  bucket,
  baselineRank,
  enrichedRank,
}: {
  queryText: string;
  bucket: 'SURFACE' | 'HARD' | 'UNRESOLVED' | 'unclassified';
  baselineRank: number | null;
  enrichedRank: number | null;
}) {
  const bucketColor = {
    SURFACE: 'bg-machina-warn/20 text-machina-warn',
    HARD: 'bg-machina-accent/20 text-machina-accent',
    UNRESOLVED: 'bg-machina-bad/20 text-machina-bad',
    unclassified: 'bg-machina-muted/20 text-machina-muted',
  }[bucket];

  const rankLabel = (r: number | null) => (r === null ? 'not found' : `#${r}`);
  const improved = (enrichedRank ?? Infinity) < (baselineRank ?? Infinity);
  const regressed = (enrichedRank ?? Infinity) > (baselineRank ?? Infinity);

  return (
    <div className="card p-3 flex items-center gap-3">
      <span className={`badge ${bucketColor}`}>{bucket}</span>
      <span className="flex-1 text-sm truncate">{queryText}</span>
      <span className="text-xs text-machina-muted">{rankLabel(baselineRank)}</span>
      <span className="text-xs text-machina-muted">&rarr;</span>
      <span
        className={`text-xs font-semibold ${improved ? 'text-machina-accent' : regressed ? 'text-machina-bad' : 'text-machina-text'}`}
      >
        {rankLabel(enrichedRank)}
      </span>
    </div>
  );
}
