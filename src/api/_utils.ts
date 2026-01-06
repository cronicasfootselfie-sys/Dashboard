/* eslint-disable @typescript-eslint/no-explicit-any */
import * as admin from "firebase-admin";

export type Quantiles = { q1: number; q3: number };
export type StatsNum = { mean: number; median: number; std: number; iqr: Quantiles };

export async function requireAuth(req: any) {
  const h = req.headers?.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) throw new Error("NO_AUTH");
  return admin.auth().verifyIdToken(token);
}

export function toDate(v: admin.firestore.Timestamp | Date): Date {
  return v instanceof Date ? v : v.toDate();
}

export function startOfDay(d: Date) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

export function startOfWeek(d: Date) {
  // ISO week 
  const x = startOfDay(d);
  const dow = x.getUTCDay() || 7; // 1..7
  x.setUTCDate(x.getUTCDate() - (dow - 1));
  return x;
}

export function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

export function quantiles(sorted: number[]): Quantiles {
  const q = (p: number) => {
    if (!sorted.length) return 0;
    const pos = (sorted.length - 1) * p;
    const base = Math.floor(pos);
    const rest = pos - base;
    const next = sorted[base + 1] ?? sorted[base];
    return sorted[base] + (next - sorted[base]) * rest;
  };
  return { q1: q(0.25), q3: q(0.75) };
}

export function stats(arr: number[]): StatsNum {
  if (!arr.length) return { mean: 0, median: 0, std: 0, iqr: { q1: 0, q3: 0 } };
  const s = [...arr].sort((a, b) => a - b);
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const mid = Math.floor(s.length / 2);
  const median = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  const { q1, q3 } = quantiles(s);
  const std = Math.sqrt(arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length);
  return { mean, median, std, iqr: { q1, q3 } };
}

// Fecha de corte: solo mostrar datos desde el 18/12/2025
export const CUTOFF_DATE = new Date('2025-12-18T00:00:00.000Z');

/**
 * Aplica la fecha de corte: retorna la fecha más reciente entre la fecha calculada y el corte
 */
export function applyCutoffDate(calculatedDate: Date): Date {
  return calculatedDate < CUTOFF_DATE ? CUTOFF_DATE : calculatedDate;
}
