/* eslint-disable @typescript-eslint/no-explicit-any */
export default function Card({ title, children }: { title: string; children: any }) {
  return (
    <section className="rounded-lg border border-neutral-800 p-4 bg-neutral-950">
      <h2 className="text-lg font-semibold mb-2">{title}</h2>
      {children}
    </section>
  );
}
