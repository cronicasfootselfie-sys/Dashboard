"use client";
import React from "react";

type Tab = { id: string; label: string };
type Props = {
  tabs: Tab[];
  value: string;
  onChange: (id: string) => void;
};

export default function Tabs({ tabs, value, onChange }: Props) {
  return (
    <div className="border-b border-neutral-800">
      <nav className="flex gap-1">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`px-4 py-2.5 text-base font-medium rounded-t-md border border-b-0 ${
              value === t.id
                ? "bg-neutral-900 border-neutral-800"
                : "border-transparent hover:bg-neutral-900/40"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
