import type { Issue, Severity } from "./types";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const money = (n: number) => usd.format(n);
export const range = (lo: number, hi: number) => (lo === hi ? money(lo) : `${money(lo)}–${money(hi)}`);

export const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, urgent: 3 };
export const SEVERITY_COLOR: Record<Severity, string> = {
  low: "#2a9d8f",
  medium: "#e9c46a",
  high: "#f4a261",
  urgent: "#e63946",
};

export const activeIssues = (issues: Issue[]) => issues.filter((i) => i.status !== "dismissed");

export function totals(issues: Issue[]) {
  const a = activeIssues(issues);
  return {
    count: a.length,
    low: a.reduce((s, i) => s + i.estCostLow, 0),
    high: a.reduce((s, i) => s + i.estCostHigh, 0),
  };
}

export function worstSeverity(issues: Issue[]): Severity | null {
  let worst: Severity | null = null;
  for (const i of activeIssues(issues)) {
    if (i.status === "done") continue;
    if (!worst || SEVERITY_RANK[i.severity] > SEVERITY_RANK[worst]) worst = i.severity;
  }
  return worst;
}
