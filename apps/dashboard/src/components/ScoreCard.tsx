export function ScoreCard({
  label,
  value,
  sublabel,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  sublabel?: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}) {
  const toneColor = {
    neutral: 'text-machina-text',
    good: 'text-machina-accent',
    warn: 'text-machina-warn',
    bad: 'text-machina-bad',
  }[tone];

  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-machina-muted">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${toneColor}`}>{value}</div>
      {sublabel && <div className="text-xs text-machina-muted mt-1">{sublabel}</div>}
    </div>
  );
}
