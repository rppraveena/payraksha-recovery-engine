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

/* ------------------------------------------------------------------ mock data */

const VOLUME = [
  { day: "Aug 07", volume: 14200 },
  { day: "Aug 10", volume: 15800 },
  { day: "Aug 13", volume: 14900 },
  { day: "Aug 16", volume: 17200 },
  { day: "Aug 19", volume: 16800 },
  { day: "Aug 22", volume: 18900 },
  { day: "Aug 25", volume: 18100 },
  { day: "Aug 28", volume: 20400 },
  { day: "Aug 31", volume: 22100 },
  { day: "Sep 03", volume: 23900 },
  { day: "Sep 05", volume: 24800 },
];

const RECENT_PAYMENTS = [
  { id: "pay_9f3kLq", customer: "Northwind Trading", amount: 1842.0, status: "succeeded" },
  { id: "pay_7m2xVp", customer: "Harbor & Finch", amount: 640.5, status: "succeeded" },
  { id: "pay_4d8wZt", customer: "Atlas Freight Co.", amount: 2190.0, status: "pending" },
  { id: "pay_2b6nRj", customer: "Redwood Supply", amount: 97.25, status: "failed" },
  { id: "pay_1c9pKs", customer: "Summit Retail", amount: 430.8, status: "succeeded" },
];

const ACTIVITY = [
  {
    label: "Payout batch PB-2291 settled",
    detail: "$18,420.00 · 142 payments",
    time: "14:32",
    tone: "success",
  },
  {
    label: "Case INV-2026-0142 escalated",
    detail: "Chargeback cluster · merchant #4412",
    time: "13:05",
    tone: "danger",
  },
  {
    label: "Merchant API key rotated",
    detail: "Redwood Supply · ip 172.18.0.4",
    time: "11:47",
    tone: "accent",
  },
  {
    label: "Webhook delivery retried",
    detail: "Atlas Freight Co. · 2 attempts",
    time: "09:21",
    tone: "warning",
  },
];

const TONE_DOT: Record<string, string> = {
  success: "bg-success",
  danger: "bg-danger",
  warning: "bg-warning",
  accent: "bg-accent",
};

const STATUS_BADGE: Record<
  string,
  { label: string; className: string }
> = {
  succeeded: {
    label: "Succeeded",
    className: "border-transparent bg-success/15 text-success",
  },
  pending: {
    label: "Pending",
    className: "border-transparent bg-warning/15 text-warning",
  },
  failed: {
    label: "Failed",
    className: "border-transparent bg-danger/15 text-danger",
  },
};

const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);

/* ------------------------------------------------------------------ helpers */

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

/* -------------------------------------------------------------------- page */

export default function Dashboard() {
  const { user } = useAuth();

  const firstName = user?.name?.split(" ")[0] ?? "there";
  const today = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());

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
              Here is how Meridian is moving money today.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">
              <Download className="size-4" />
              Export
            </Button>
            <Button size="sm">
              <Plus className="size-4" />
              New payout
            </Button>
          </div>
        </div>

        {/* KPIs */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            icon={Wallet}
            label="Total volume"
            value="$24.8k"
            delta="+12.4%"
            trend="up"
          />
          <KpiCard
            icon={CreditCard}
            label="Payments"
            value="1,284"
            delta="+2.1%"
            trend="up"
          />
          <KpiCard
            icon={SearchCheck}
            label="Success rate"
            value="99.58%"
            delta="+0.3%"
            trend="up"
          />
          <KpiCard
            icon={ShieldAlert}
            label="Under review"
            value="6"
            delta="-2"
            trend="down"
          />
        </div>

        {/* Chart + risk summary */}
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <Card className="shadow-card lg:col-span-2">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Payment volume</CardTitle>
                <CardDescription className="mt-1">
                  Settled volume, last 30 days
                </CardDescription>
              </div>
              <Badge variant="outline" className="rounded-full">
                30d
              </Badge>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart
                  data={VOLUME}
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
                Active cases by severity
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {[
                { label: "Escalated", count: 2, tone: "bg-danger", text: "text-danger" },
                { label: "Under review", count: 4, tone: "bg-warning", text: "text-warning" },
                { label: "Resolved", count: 38, tone: "bg-success", text: "text-success" },
              ].map((row) => (
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
                  Latest transactions across merchants
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
                      Customer
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
                  {RECENT_PAYMENTS.map((payment) => {
                    const badge = STATUS_BADGE[payment.status];
                    return (
                      <TableRow key={payment.id}>
                        <TableCell className="font-mono text-xs">
                          {payment.id}
                        </TableCell>
                        <TableCell className="text-sm">
                          {payment.customer}
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
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">Activity</CardTitle>
              <CardDescription className="mt-1">
                Platform events, latest first
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-4">
                {ACTIVITY.map((event) => (
                  <li key={event.label} className="flex gap-3">
                    <span
                      className={`mt-1.5 size-2 shrink-0 rounded-full ${TONE_DOT[event.tone]}`}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-snug">
                        {event.label}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {event.detail}
                      </p>
                    </div>
                    <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
                      {event.time}
                    </span>
                  </li>
                ))}
              </ul>
              <Button variant="outline" size="sm" className="mt-5 w-full" asChild>
                <Link to="/settings">
                  <FileSearch className="size-4" />
                  Manage alerts
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}