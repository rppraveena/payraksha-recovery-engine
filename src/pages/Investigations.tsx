import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Flag,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Send,
  TimerReset,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Severity = "critical" | "high" | "medium" | "low";
type CaseStatus = "Open" | "Under review" | "Escalated" | "Closed";

interface CaseItem {
  id: string;
  title: string;
  merchant: string;
  severity: Severity;
  status: CaseStatus;
  createdAt: string;
  amountAtRisk: number;
  paymentsAffected: number;
  patternScore: number;
  summary: string;
  timeline: Array<{ time: string; label: string; detail?: string }>;
  evidence: string[];
}

const CASES: CaseItem[] = [
  {
    id: "INV-2026-0142",
    title: "Suspicious high-velocity payouts",
    merchant: "Merchant #4412 · Northwind Trading",
    severity: "critical",
    status: "Escalated",
    createdAt: "Sep 04",
    amountAtRisk: 12480,
    paymentsAffected: 34,
    patternScore: 92,
    summary:
      "34 payouts settled within 90 minutes to accounts opened in the last 48 hours. Amounts cluster around the $390–$420 threshold.",
    timeline: [
      { time: "Sep 05 13:05", label: "Escalated to fraud desk", detail: "Automated rule VL-17 triggered" },
      { time: "Sep 05 11:20", label: "Flagged for review", detail: "Pattern score crossed 85" },
      { time: "Sep 04 19:44", label: "Payout batch PB-2288 settled", detail: "18 payouts · $6,480.00" },
      { time: "Sep 04 19:12", label: "Merchant onboarding completed", detail: "KYC: business license + bank letter" },
    ],
    evidence: [
      "payout_batch_pb-2288.json",
      "device_fingerprints.csv",
      "kyc_docs_4412.pdf",
    ],
  },
  {
    id: "INV-2026-0138",
    title: "Chargeback cluster on merchant #3108",
    merchant: "Harbor & Finch",
    severity: "high",
    status: "Under review",
    createdAt: "Sep 03",
    amountAtRisk: 4210,
    paymentsAffected: 12,
    patternScore: 78,
    summary:
      "Chargeback rate of 4.2% over the trailing 14 days, up from 0.6%. 11 of 12 disputes share a common card-issuer and billing descriptor.",
    timeline: [
      { time: "Sep 05 09:40", label: "Dispute batch reconciled", detail: "5 new chargebacks filed" },
      { time: "Sep 04 16:22", label: "Evidence requested from merchant" },
      { time: "Sep 03 08:15", label: "Flagged for review", detail: "Chargeback ratio anomaly" },
    ],
    evidence: [
      "chargeback_report_3108.csv",
      "dispute_evidence_3108.zip",
    ],
  },
  {
    id: "INV-2026-0129",
    title: "Velocity spike on new merchant",
    merchant: "Atlas Freight Co.",
    severity: "medium",
    status: "Under review",
    createdAt: "Sep 02",
    amountAtRisk: 1930,
    paymentsAffected: 8,
    patternScore: 54,
    summary:
      "8 payments from 8 distinct cards to a merchant 11 days old. Average ticket is 4.1× the merchant cohort median.",
    timeline: [
      { time: "Sep 05 10:05", label: "Second review pass", detail: "No KYC exceptions found" },
      { time: "Sep 02 21:33", label: "Flagged for review", detail: "Velocity rule VL-04" },
    ],
    evidence: ["velocity_report_5217.csv"],
  },
  {
    id: "INV-2026-0117",
    title: "Refund loop detected",
    merchant: "Lakeshore Diner",
    severity: "low",
    status: "Closed",
    createdAt: "Aug 31",
    amountAtRisk: 640,
    paymentsAffected: 5,
    patternScore: 31,
    summary:
      "5 payment/refund cycles within 4 hours. Confirmed as a point-of-sale integration bug — merchant issued corrective credits.",
    timeline: [
      { time: "Sep 01 14:20", label: "Case closed", detail: "Merchant confirmed integration bug" },
      { time: "Aug 31 17:48", label: "Flagged for review", detail: "Refund loop rule RL-02" },
    ],
    evidence: ["refund_loop_2754.log"],
  },
];

const SEVERITY_META: Record<Severity, { label: string; className: string; dot: string }> = {
  critical: { label: "Critical", className: "border-transparent bg-danger/15 text-danger", dot: "bg-danger" },
  high: { label: "High", className: "border-transparent bg-warning/15 text-warning", dot: "bg-warning" },
  medium: { label: "Medium", className: "border-transparent bg-accent-tint text-accent-foreground", dot: "bg-accent" },
  low: { label: "Low", className: "border-transparent bg-muted text-muted-foreground", dot: "bg-muted-foreground" },
};

const STATUS_META: Record<CaseStatus, string> = {
  Open: "border-transparent bg-secondary text-secondary-foreground",
  "Under review": "border-transparent bg-warning/15 text-warning",
  Escalated: "border-transparent bg-danger/15 text-danger",
  Closed: "border-transparent bg-success/15 text-success",
};

const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);

export default function Investigations() {
  const [cases, setCases] = useState(CASES);
  const [selectedId, setSelectedId] = useState(CASES[0].id);
  const [note, setNote] = useState("");

  const active = cases.find((c) => c.id === selectedId) ?? cases[0];

  const setStatus = (next: CaseStatus) => {
    setCases((prev) =>
      prev.map((c) => (c.id === active.id ? { ...c, status: next } : c)),
    );
    toast.success(`${active.id} moved to “${next}”.`);
  };

  const addNote = () => {
    const text = note.trim();
    if (!text) return;
    setCases((prev) =>
      prev.map((c) =>
        c.id === active.id
          ? {
              ...c,
              timeline: [
                {
                  time: "Now",
                  label: "Analyst note added",
                  detail: text,
                },
                ...c.timeline,
              ],
            }
          : c,
      ),
    );
    setNote("");
    toast.success("Note added to the case timeline.");
  };

  const severity = SEVERITY_META[active.severity];

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Investigations
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Fraud desk queue — {cases.filter((c) => c.status !== "Closed").length} open cases.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => toast("New investigation drafts in v2 — review the queue below.")}
          >
            <Plus className="size-4" />
            New investigation
          </Button>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[320px_1fr]">
          {/* Case list */}
          <div className="flex flex-col gap-2">
            {cases.map((c) => {
              const meta = SEVERITY_META[c.severity];
              const selected = c.id === active.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={cn(
                    "flex flex-col gap-1.5 rounded-xl border bg-card p-3.5 text-left shadow-card transition-all duration-150",
                    selected
                      ? "border-accent ring-1 ring-accent/40"
                      : "hover:border-border hover:shadow-md",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      {c.id}
                    </span>
                    <span className={`size-2 rounded-full ${meta.dot}`} />
                  </div>
                  <p className="text-sm font-semibold leading-snug">{c.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {c.merchant}
                  </p>
                  <div className="mt-1 flex items-center justify-between">
                    <Badge className={meta.className}>{meta.label}</Badge>
                    <span className="text-[11px] text-muted-foreground">
                      {c.createdAt}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Detail */}
          <div className="flex flex-col gap-6">
            <Card className="shadow-card">
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">
                    {active.id}
                  </span>
                  <Badge className={severity.className}>{severity.label}</Badge>
                  <Badge className={STATUS_META[active.status]}>
                    {active.status}
                  </Badge>
                </div>
                <CardTitle className="mt-1 text-xl">{active.title}</CardTitle>
                <CardDescription>{active.merchant}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-6">
                {/* Metrics */}
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    { label: "Amount at risk", value: money(active.amountAtRisk) },
                    { label: "Payments affected", value: String(active.paymentsAffected) },
                    { label: "Pattern score", value: `${active.patternScore}/100` },
                  ].map((metric) => (
                    <div
                      key={metric.label}
                      className="rounded-lg border border-border/70 bg-background/40 px-3.5 py-3"
                    >
                      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        {metric.label}
                      </p>
                      <p className="mt-1 font-mono text-lg font-semibold tabular-nums">
                        {metric.value}
                      </p>
                    </div>
                  ))}
                </div>

                <p className="text-sm leading-relaxed text-muted-foreground">
                  {active.summary}
                </p>

                {/* Evidence */}
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Evidence
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {active.evidence.map((file) => (
                      <span
                        key={file}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-2.5 py-1 font-mono text-[11px] text-foreground"
                      >
                        <ShieldAlert className="size-3 text-muted-foreground" />
                        {file}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Timeline */}
                <div>
                  <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Timeline
                  </p>
                  <ol className="relative flex flex-col gap-4 border-l border-border pl-4">
                    {active.timeline.map((event) => (
                      <li key={`${event.time}-${event.label}`} className="relative">
                        <span className="absolute -left-[21px] top-1 size-2.5 rounded-full border-2 border-background bg-accent" />
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {event.time}
                        </p>
                        <p className="mt-0.5 text-sm font-medium">{event.label}</p>
                        {event.detail && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {event.detail}
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>

                {/* Notes */}
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Add note
                  </p>
                  <div className="flex gap-2">
                    <Textarea
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Record a finding for the case timeline…"
                      className="min-h-[72px] flex-1 bg-background/60"
                    />
                    <Button
                      variant="outline"
                      className="h-auto self-stretch"
                      onClick={addNote}
                      disabled={!note.trim()}
                      aria-label="Add note"
                    >
                      <Send className="size-4" />
                    </Button>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setStatus("Under review")}
                  >
                    <TimerReset className="size-4" />
                    Reopen review
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-warning/40 text-warning hover:bg-warning/10 hover:text-warning"
                    onClick={() => setStatus("Escalated")}
                  >
                    <Flag className="size-4" />
                    Escalate
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-danger/40 text-danger hover:bg-danger/10 hover:text-danger"
                    onClick={() => toast("Merchant #4412 blocked — payouts paused.")}
                  >
                    <ShieldAlert className="size-4" />
                    Block merchant
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setStatus("Closed")}
                    disabled={active.status === "Closed"}
                  >
                    <ShieldCheck className="size-4" />
                    Mark resolved
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}