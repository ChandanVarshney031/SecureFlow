"use client";

import { useState } from "react";
import { Trash2, Eye, AlertTriangle, CheckCircle2, Clock, Shield } from "lucide-react";
import type { PurgeTarget } from "@/lib/retention/policy";

interface RuleInfo {
  target: string;
  envVar: string;
  defaultDays: number;
  configuredDays: number;
  rationale: string;
}

interface TargetOutcome {
  target: PurgeTarget;
  affected: number;
  cutoff: string;
  retentionDays: number;
  batches: number;
  truncated: boolean;
  error?: string;
}

interface PurgeReport {
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  outcomes: TargetOutcome[];
  totalAffected: number;
  hadErrors: boolean;
}

const TARGET_LABELS: Record<string, string> = {
  auditLog: "Audit Logs",
  webhookEvent: "Webhook Events",
  scanResult: "Scan Results",
  findingSnippet: "Finding Code Snippets",
};

const TARGET_DESCRIPTIONS: Record<string, string> = {
  auditLog: "Per-action audit records with user identity and metadata",
  webhookEvent: "GitHub webhook delivery-id dedup records",
  scanResult: "PR scan history and associated findings (cascade delete)",
  findingSnippet: "Source-code excerpt stored with each finding (redacted, not deleted)",
};

export default function RetentionDashboard({
  rules,
  retentionEnabled,
}: {
  rules: RuleInfo[];
  retentionEnabled: boolean;
}) {
  const [report, setReport] = useState<PurgeReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runCleanup(dryRun: boolean) {
    setLoading(true);
    setError(null);
    setReport(null);

    try {
      const res = await fetch("/api/admin/cleanup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });

      const data: PurgeReport = await res.json();

      if (!res.ok && res.status !== 207) {
        setError((data as unknown as { error?: string }).error ?? "Unexpected error");
        return;
      }

      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* Header */}
      <div>
        <span className="text-sm font-medium uppercase tracking-widest text-primary">
          Admin Panel
        </span>
        <h1 className="mt-1 font-headline text-4xl font-extrabold tracking-tight">
          Data Retention
        </h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Manage how long findings, audit logs, and other records are retained.
          Use <strong>Dry Run</strong> to preview what would be purged before committing.
        </p>
      </div>

      {/* Status banner */}
      {!retentionEnabled && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-yellow-600 dark:text-yellow-400">
              Automatic retention is off
            </p>
            <p className="text-muted-foreground mt-0.5">
              Set <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">DATA_RETENTION_DAYS</code>{" "}
              (or any per-target env var below) to enable scheduled purging.
              Manual runs via this page always use the per-target defaults.
            </p>
          </div>
        </div>
      )}

      {/* Policy table */}
      <section>
        <h2 className="font-headline text-xl font-semibold mb-3 tracking-tight">
          Configured Policy
        </h2>
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Target</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Env Var</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Retention</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rules.map((rule) => (
                <tr key={rule.target} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium">{TARGET_LABELS[rule.target] ?? rule.target}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {TARGET_DESCRIPTIONS[rule.target] ?? rule.rationale}
                    </p>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <code className="text-xs font-mono text-primary">{rule.envVar}</code>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-mono font-semibold">{rule.configuredDays}d</span>
                    {rule.configuredDays !== rule.defaultDays && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        (default: {rule.defaultDays}d)
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Actions */}
      <section>
        <h2 className="font-headline text-xl font-semibold mb-3 tracking-tight">
          Manual Run
        </h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => runCleanup(true)}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-muted hover:bg-muted/70 text-sm font-medium transition-colors disabled:opacity-50"
          >
            <Eye className="w-4 h-4" />
            {loading ? "Running…" : "Dry Run (Preview)"}
          </button>
          <button
            onClick={() => {
              if (
                window.confirm(
                  "This will permanently delete or redact data older than the configured windows.\n\nContinue?"
                )
              ) {
                runCleanup(false);
              }
            }}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-destructive/50 bg-destructive/5 hover:bg-destructive/10 text-destructive text-sm font-medium transition-colors disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4" />
            Apply (Delete / Redact)
          </button>
        </div>
      </section>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Report */}
      {report && (
        <section className="space-y-4">
          <h2 className="font-headline text-xl font-semibold tracking-tight flex items-center gap-2">
            {report.hadErrors ? (
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
            ) : report.dryRun ? (
              <Eye className="w-5 h-5 text-primary" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-green-500" />
            )}
            {report.dryRun ? "Dry-Run Report" : "Applied Report"}
          </h2>

          <div className="text-xs text-muted-foreground flex items-center gap-4">
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {new Date(report.startedAt).toLocaleString()}
            </span>
            <span className="flex items-center gap-1">
              <Shield className="w-3.5 h-3.5" />
              Total affected: <strong className="ml-1">{report.totalAffected}</strong>
            </span>
          </div>

          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Target</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Affected</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Batches</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Cutoff</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.outcomes.map((outcome) => (
                  <tr key={outcome.target} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium">
                      {TARGET_LABELS[outcome.target] ?? outcome.target}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold">
                      {outcome.affected}
                    </td>
                    <td className="px-4 py-3 text-right hidden md:table-cell text-muted-foreground">
                      {outcome.batches}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground text-xs font-mono">
                      {new Date(outcome.cutoff).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      {outcome.error ? (
                        <span className="text-destructive text-xs flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          {outcome.error}
                        </span>
                      ) : outcome.truncated ? (
                        <span className="text-yellow-600 dark:text-yellow-400 text-xs">
                          Truncated — run again
                        </span>
                      ) : (
                        <span className="text-green-600 dark:text-green-400 text-xs flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Complete
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {report.hadErrors && (
            <p className="text-sm text-yellow-600 dark:text-yellow-400 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              One or more targets failed. The others completed successfully.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

