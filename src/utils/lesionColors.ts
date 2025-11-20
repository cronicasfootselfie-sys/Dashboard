// Colores por clase (ES/EN y por id como string)
export const LESION_COLORS: Record<string, string> = {
  "piel sana": "#22c55e",    "healthy": "#22c55e",          "-1": "#22c55e",
  "callos": "#eab308",       "callus": "#eab308",            "0": "#eab308",
  "eritema": "#f97316",      "erythema": "#f97316",          "1": "#f97316",
  "fisuras": "#fb923c",      "fissures": "#fb923c",          "2": "#fb923c",
  "decoloración": "#f59e0b", "discoloration": "#f59e0b",     "3": "#f59e0b",
  "callo hemorrágico": "#f43f5e","hemorrhagic callus":"#f43f5e","4":"#f43f5e",
  "úlcera": "#ef4444",       "ulcer": "#ef4444",              "5": "#ef4444",
};

// Colores de respaldo (para clases desconocidas)
export const DEFAULT_COLORS = ["#60a5fa","#a78bfa","#34d399","#fbbf24","#f472b6","#f87171"];

// Hash simple para asignar un color estable a nombres desconocidos
export function colorForUnknown(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return DEFAULT_COLORS[h % DEFAULT_COLORS.length];
}
