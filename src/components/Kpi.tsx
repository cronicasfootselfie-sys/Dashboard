export default function Kpi({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-neutral-800 p-3 bg-neutral-950">
      <div className="text-xs opacity-70">{label}</div>
      <div className="text-xl font-bold">{value}</div>
      {sub && <div className="text-xs opacity-70">{sub}</div>}
    </div>
  );
}
