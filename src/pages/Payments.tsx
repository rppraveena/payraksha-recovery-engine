import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/use-auth";
import {
  fetchPayments,
  supabaseConfig,
  type PaymentRow,
  type PaymentStatus,
} from "@/lib/supabase";
import {
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Download,
  Landmark,
  Loader2,
  Search,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";

const STATUS_META: Record<
  PaymentStatus,
  { label: string; className: string }
> = {
  CAPTURED: { label: "Captured", className: "border-transparent bg-success/15 text-success" },
  CAPTURED_AFTER_FAILURE: { label: "Recovered", className: "border-transparent bg-success/15 text-success" },
  AUTHORIZED: { label: "Authorized", className: "border-transparent bg-accent/15 text-accent-foreground" },
  PENDING_REVIEW: { label: "Review", className: "border-transparent bg-warning/15 text-warning" },
  FAILED: { label: "Failed", className: "border-transparent bg-danger/15 text-danger" },
  RECOVERY_PENDING: { label: "Recovery", className: "border-transparent bg-warning/15 text-warning" },
  ESCALATED: { label: "Escalated", className: "border-transparent bg-danger/15 text-danger" },
  BLOCKED: { label: "Blocked", className: "border-transparent bg-danger/15 text-danger" },
  RECOVERY_CANCELLED: { label: "Cancelled", className: "border-transparent bg-muted text-muted-foreground" },
};

const METHOD_META: Record<string, { label: string; icon: typeof CreditCard }> = {
  card: { label: "Card", icon: CreditCard },
  ach: { label: "ACH", icon: Landmark },
  wire: { label: "Wire", icon: Wallet },
  wallet: { label: "Wallet", icon: Wallet },
};

const FILTERS: Array<{ id: PaymentStatus | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "CAPTURED", label: "Captured" },
  { id: "CAPTURED_AFTER_FAILURE", label: "Recovered" },
  { id: "FAILED", label: "Failed" },
  { id: "RECOVERY_PENDING", label: "Recovery" },
  { id: "PENDING_REVIEW", label: "Review" },
  { id: "BLOCKED", label: "Blocked" },
  { id: "ESCALATED", label: "Escalated" },
];

const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);

export default function Payments() {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<PaymentStatus | "all">("all");
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);

  const tenantId = user?.tenantId;

  const loadPayments = useCallback(async () => {
    if (!tenantId) { setLoading(false); return; }
    try {
      const result = await fetchPayments(tenantId, { limit: 100 });
      if (result.ok) setPayments(result.data);
    } catch (err) {
      console.error("Failed to load payments:", err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { loadPayments(); }, [loadPayments]);

  const filtered = payments.filter((payment) => {
    const matchesStatus = status === "all" || payment.status === status;
    const needle = query.trim().toLowerCase();
    const matchesQuery =
      needle.length === 0 ||
      payment.payment_ref.toLowerCase().includes(needle) ||
      (payment.method ?? "").toLowerCase().includes(needle) ||
      (payment.bank ?? "").toLowerCase().includes(needle) ||
      (payment.psp ?? "").toLowerCase().includes(needle);
    return matchesStatus && matchesQuery;
  });

  const total = filtered.reduce((sum, p) => sum + p.amount, 0);

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Payments
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Event-sourced payment state from your tenant's history.
            </p>
          </div>
          <Button size="sm" variant="outline">
            <Download className="size-4" />
            Export CSV
          </Button>
        </div>

        {/* Filters */}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((filter) => {
              const active = status === filter.id;
              return (
                <Button
                  key={filter.id}
                  size="sm"
                  variant={active ? "default" : "outline"}
                  onClick={() => setStatus(filter.id)}
                  className="rounded-full"
                >
                  {filter.label}
                </Button>
              );
            })}
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search payment ref, method, bank…"
              className="h-9 bg-card pl-9"
            />
          </div>
        </div>

        {/* Table */}
        <Card className="mt-5 shadow-card">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base">Transactions</CardTitle>
            <p className="font-mono text-sm tabular-nums text-muted-foreground">
              {money(total)}{" "}
              <span className="text-xs">filtered</span>
            </p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs text-muted-foreground">Payment</TableHead>
                      <TableHead className="text-xs text-muted-foreground">Method</TableHead>
                      <TableHead className="text-xs text-muted-foreground">Bank / PSP</TableHead>
                      <TableHead className="text-right text-xs text-muted-foreground">Amount</TableHead>
                      <TableHead className="text-right text-xs text-muted-foreground">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((payment) => {
                      const badge = STATUS_META[payment.status] ?? {
                        label: payment.status,
                        className: "border-transparent bg-muted text-muted-foreground",
                      };
                      const method = METHOD_META[payment.method ?? ""];
                      return (
                        <TableRow key={payment.id}>
                          <TableCell>
                            <Link
                              to={`/payments/${payment.id}`}
                              className="font-mono text-xs text-accent-foreground hover:underline"
                            >
                              {payment.payment_ref}
                            </Link>
                          </TableCell>
                          <TableCell>
                            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                              {method ? <method.icon className="size-3.5" /> : null}
                              {method?.label ?? payment.method ?? "—"}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {[payment.bank, payment.psp].filter(Boolean).join(" · ") || "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm tabular-nums">
                            {money(payment.amount)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge className={badge.className}>{badge.label}</Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {filtered.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="py-10 text-center text-sm text-muted-foreground"
                        >
                          {supabaseConfig.configured
                            ? "No payments match your filters."
                            : "Connect Supabase and run the seed migration to see payment data."}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>

                {/* Footer */}
                <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
                  <p className="text-xs text-muted-foreground">
                    Showing {filtered.length} of {payments.length} payments
                  </p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="icon-sm" disabled>
                      <ChevronLeft className="size-4" />
                    </Button>
                    <Button variant="outline" size="icon-sm" disabled>
                      <ChevronRight className="size-4" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
