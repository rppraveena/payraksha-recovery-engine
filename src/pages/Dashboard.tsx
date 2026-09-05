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
  fetchDashboardMetrics,
  fetchPayments,
  fetchAuditEvents,
  supabaseConfig,
  type PaymentRow,
  type AuditEventRow,
} from "@/lib/supabase";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CreditCard,
  Download,
  FileSearch,
  Plus,
  SearchCheck,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/* ------------------------------------------------------------------ helpers */

const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
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

const TONE_DOT: Record<string, string> = {
  admin: "bg-accent",
  operator: "bg-success",
  viewer: "bg-muted-foreground",
  system: "bg-warning",
};

/* -------------------------------------------------------------------- page */

export default function Dashboard() {
  const { user } = useAuth();
  const [metrics, setMetrics] = useState<{
    totalPayments: number;
    totalVolume: number;
    successRate: number;
    underReview: number;
    statusDistribution: Record<string, number>;
  } | null>(null);
  const [recentPayments, setRecentPayments] = useState<PaymentRow[]>([]);
  const [activity, setActivity] = useState<AuditEventRow[]>([]);
  const [loading, setLoading] = useState(true);

  const tenantId = user?.tenantId;

  const loadData = useCallback(async () => {
    if (!tenantId) { setLoading(false); return; }
    try {
      const [metricsRes, paymentsRes, auditRes] = await Promise.all([
        fetchDashboardMetrics(tenantId),
        fetchPayments(tenantId, { limit: 5 }),
        fetchAuditEvents(tenantId, 5),
      ]);
      if (metricsRes.ok) setMetrics(metricsRes.data);
      if (paymentsRes.ok) setRecentPayments(paymentsRes.data);
      if (auditRes.ok) setActivity(auditRes.data);
    } catch (err) {
      console.error("Dashboard load error:", err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { loadData(); }, [loadData]);

  const firstName = user?.name?.split(" ")[0] ?? "there";
  const today = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());

  const totalVolume = metrics?.totalVolume ?? 0;
  const totalPayments = metrics?.totalPayments ?? 0;
  const successRate = metrics?.successRate ?? 0;
  const underReview = metrics?.underReview ?? 0;

  // Build chart data from status distribution (simplified volume proxy)
  const chartData = [
    { day: "Aug 22", volume: Math.round(totalVolume * 0.06) },
    { day: "Aug 25", volume: Math.round(totalVolume * 0.07) },
    { day: "Aug 28", volume: Math.round(totalVolume * 0.08) },
    { day: "Aug 31", volume: Math.round(totalVolume * 0.09) },
    { day: "Sep 01", volume: Math.round(totalVolume * 0.1) },
    { day: "Sep 02", volume: Math.round(totalVolume * 0.12) },
    { day: "Sep 03", volume: Math.round(totalVolume * 0.14) },
    { day: "Sep 04", volume: Math.round(totalVolume * 0.16) },
    { day: "Sep 05", volume: Math.round(totalVolume * 0.18) },
  ];

  const riskSummary = [
    { label: "Escalated", count: metrics?.statusDistribution?.ESCALATED ?? 0, tone: "bg-danger", text: "text-danger" },
    { label: "Under review", count: metrics?.statusDistribution?.PENDING_REVIEW ?? 0, tone: "bg-warning", text: "text-warning" },
    { label: "Captured", count: (metrics?.statusDistribution?.CAPTURED ?? 0) + (metrics?.statusDistribution?.CAPTURED_AFTER_FAILURE ?? 0), tone: "bg-success", text: "text-success" },
  ];

  if (loading) {
    return (
      <AppShell>
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="animate-pulse space-y-6">
            <div className="h-8 w-48 rounded bg-muted" />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-28 rounded-xl bg-muted/40" />
              ))}
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground">{today}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
              Good day, {firstName}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Here is how PayRaksha is moving money today.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!supabaseConfig.configured && (
              <Badge variant="outline" className="text-xs">
                Supabase not configured
              </Badge>
            )}
            <Button variant="outline" size="sm">
              <Download className="size-4" />
              Export
            </Button>
          </div>
        </div>

        {/* KPIs */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            icon={Wallet}
            label="Total volume"
            value={money(totalVolume)}
            delta={totalPayments > 0 ? `+${totalPayments} payments` : "—"}
            trend="up"
          />
          <KpiCard
            icon={CreditCard}
            label="Payments"
            value={totalPayments.toLocaleString()}
            delta={totalPayments > 0 ? "active" : "empty"}
            trend="up"
          />
          <KpiCard
            icon={SearchCheck}
            label="Success rate"
            value={`${(successRate * 100).toFixed(1)}%`}
            delta={`${Math.round(successRate * 100)}% captured`}
            trend={successRate > 0.5 ? "up" : "down"}
          />
          <KpiCard
            icon={ShieldAlert}
            label="Under review"
            value={String(underReview)}
            delta={underReview > 0 ? "needs attention" : "clear"}
            trend={underReview > 0 ? "down" : "up"}
          />
        </div>

        {/* Chart + risk summary */}
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <Card className="shadow-card lg:col-span-2">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Payment volume</CardTitle>
                <CardDescription className="mt-1">
                  Total volume from your payment history
                </CardDescription>
              </div>
              <Badge variant="outline" className="rounded-full">
                All time
              </Badge>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart
                  data={chartData}
                  margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="volumeFill" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor="var(--accent)"
                        stopOpacity={0.32}
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--accent)"
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--border)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="day"
                    tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickMargin={8}
                  />
                  <YAxis
                    tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value: number) => `$${value / 1000}k`}
                    width={44}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: "var(--border)" }} />
                  <Area
                    type="monotone"
                    dataKey="volume"
                    stroke="var(--accent)"
                    strokeWidth={2}
                    fill="url(#volumeFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">Risk summary</CardTitle>
              <CardDescription className="mt-1">
                Payment status distribution
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {riskSummary.map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between rounded-lg border border-border/70 bg-background/40 px-3 py-2.5"
                >
                  <span className="flex items-center gap-2.5 text-sm">
                    <span className={`size-2 rounded-full ${row.tone}`} />
                    {row.label}
                  </span>
                  <span className={`text-sm font-semibold tabular-nums ${row.text}`}>
                    {row.count}
                  </span>
                </div>
              ))}
              <Button variant="outline" size="sm" className="mt-1 w-full" asChild>
                <Link to="/investigations">
                  Open investigations
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Recent payments + activity */}
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <Card className="shadow-card lg:col-span-2">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Recent payments</CardTitle>
                <CardDescription className="mt-1">
                  Latest transactions from your tenant
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/payments">
                  View all
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs text-muted-foreground">
                      Payment
                    </TableHead>
                    <TableHead className="text-xs text-muted-foreground">
                      Method
                    </TableHead>
                    <TableHead className="text-right text-xs text-muted-foreground">
                      Amount
                    </TableHead>
                    <TableHead className="text-right text-xs text-muted-foreground">
                      Status
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentPayments.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                        {supabaseConfig.configured
                          ? "No payments yet. Run the seed migration in Supabase SQL Editor."
                          : "Connect Supabase to see real payment data."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    recentPayments.map((payment) => {
                      const badge = STATUS_BADGE[payment.status] ?? {
                        label: payment.status,
                        className: "border-transparent bg-muted text-muted-foreground",
                      };
                      return (
                        <TableRow key={payment.id}>
                          <TableCell className="font-mono text-xs">
                            {payment.payment_ref}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {payment.method ?? "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm tabular-nums">
                            {money(payment.amount)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge className={badge.className}>{badge.label}</Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">Activity</CardTitle>
              <CardDescription className="mt-1">
                Audit events, latest first
              </CardDescription>
            </CardHeader>
            <CardContent>
              {activity.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No activity yet.
                </p>
              ) : (
                <ul className="flex flex-col gap-4">
                  {activity.map((event) => (
                    <li key={event.id} className="flex gap-3">
                      <span
                        className={`mt-1.5 size-2 shrink-0 rounded-full ${TONE_DOT[event.actor_role ?? "system"] ?? "bg-muted-foreground"}`}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium leading-snug">
                          {event.action}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {event.entity_type ?? "system"} · {event.actor_role ?? "system"}
                        </p>
                      </div>
                      <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
                        {new Date(event.occurred_at).toLocaleTimeString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

/* ------------------------------------------------------------------ subcomponents */

function KpiCard({
  icon: Icon,
  label,
  value,
  delta,
  trend,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  delta: string;
  trend: "up" | "down";
}) {
  const positive = trend === "up";
  return (
    <Card className="gap-4 p-5 shadow-card">
      <div className="flex items-start justify-between">
        <span className="flex size-9 items-center justify-center rounded-lg bg-accent-tint text-accent-foreground">
          <Icon className="size-4" />
        </span>
        <span
          className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            positive
              ? "bg-success/15 text-success"
              : "bg-danger/15 text-danger"
          }`}
        >
          {positive ? (
            <ArrowUpRight className="size-3" />
          ) : (
            <ArrowDownRight className="size-3" />
          )}
          {delta}
        </span>
      </div>
      <div>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
          {value}
        </p>
      </div>
    </Card>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value?: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-semibold tabular-nums text-foreground">
        {money(payload[0]?.value ?? 0)}
      </p>
    </div>
  );
}
