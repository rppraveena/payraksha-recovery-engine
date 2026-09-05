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
import {
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Download,
  Landmark,
  Search,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

type PaymentStatus = "succeeded" | "pending" | "failed" | "refunded";

interface Payment {
  id: string;
  date: string;
  customer: string;
  method: "card" | "ach" | "wire" | "wallet";
  amount: number;
  status: PaymentStatus;
}

const PAYMENTS: Payment[] = [
  { id: "pay_9f3kLq", date: "Sep 05, 14:32", customer: "Northwind Trading", method: "ach", amount: 1842.0, status: "succeeded" },
  { id: "pay_8e2vNc", date: "Sep 05, 13:58", customer: "Cascade Coffee Roasters", method: "card", amount: 86.4, status: "succeeded" },
  { id: "pay_7m2xVp", date: "Sep 05, 12:44", customer: "Harbor & Finch", method: "wallet", amount: 640.5, status: "succeeded" },
  { id: "pay_6q5rBd", date: "Sep 05, 11:17", customer: "Ironwood Logistics", method: "wire", amount: 4290.0, status: "pending" },
  { id: "pay_4d8wZt", date: "Sep 04, 18:02", customer: "Atlas Freight Co.", method: "ach", amount: 2190.0, status: "pending" },
  { id: "pay_3c1tHy", date: "Sep 04, 16:41", customer: "Blue Oak Dental", method: "card", amount: 312.75, status: "succeeded" },
  { id: "pay_2b6nRj", date: "Sep 04, 15:26", customer: "Redwood Supply", method: "card", amount: 97.25, status: "failed" },
  { id: "pay_1c9pKs", date: "Sep 04, 14:03", customer: "Summit Retail Group", method: "ach", amount: 430.8, status: "succeeded" },
  { id: "pay_0a7wQm", date: "Sep 04, 11:38", customer: "Lakeshore Diner", method: "wallet", amount: 24.0, status: "refunded" },
];

const STATUS_META: Record<
  PaymentStatus,
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
  refunded: {
    label: "Refunded",
    className: "border-transparent bg-muted text-muted-foreground",
  },
};

const METHOD_META: Record<Payment["method"], { label: string; icon: typeof CreditCard }> = {
  card: { label: "Card", icon: CreditCard },
  ach: { label: "ACH", icon: Landmark },
  wire: { label: "Wire", icon: Wallet },
  wallet: { label: "Wallet", icon: Wallet },
};

const FILTERS: Array<{ id: PaymentStatus | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "succeeded", label: "Succeeded" },
  { id: "pending", label: "Pending" },
  { id: "failed", label: "Failed" },
  { id: "refunded", label: "Refunded" },
];

const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);

export default function Payments() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<PaymentStatus | "all">("all");

  const filtered = PAYMENTS.filter((payment) => {
    const matchesStatus = status === "all" || payment.status === status;
    const needle = query.trim().toLowerCase();
    const matchesQuery =
      needle.length === 0 ||
      payment.id.toLowerCase().includes(needle) ||
      payment.customer.toLowerCase().includes(needle);
    return matchesStatus && matchesQuery;
  });

  const total =
    status === "all"
      ? PAYMENTS.reduce((sum, payment) => sum + payment.amount, 0)
      : filtered.reduce((sum, payment) => sum + payment.amount, 0);

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
              Every transaction across your merchant network.
            </p>
          </div>
          <Button size="sm">
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
                  {filter.id !== "all" && (
                    <span
                      className={cn(
                        "tabular-nums",
                        active ? "opacity-70" : "text-muted-foreground",
                      )}
                    >
                      {PAYMENTS.filter((p) => p.status === filter.id).length}
                    </span>
                  )}
                </Button>
              );
            })}
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search payment ID or customer…"
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
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs text-muted-foreground">Payment</TableHead>
                  <TableHead className="text-xs text-muted-foreground">Date</TableHead>
                  <TableHead className="text-xs text-muted-foreground">Customer</TableHead>
                  <TableHead className="text-xs text-muted-foreground">Method</TableHead>
                  <TableHead className="text-right text-xs text-muted-foreground">Amount</TableHead>
                  <TableHead className="text-right text-xs text-muted-foreground">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((payment) => {
                  const badge = STATUS_META[payment.status];
                  const method = METHOD_META[payment.method];
                  return (
                    <TableRow key={payment.id}>
                      <TableCell className="font-mono text-xs">{payment.id}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {payment.date}
                      </TableCell>
                      <TableCell className="text-sm font-medium">
                        {payment.customer}
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                          <method.icon className="size-3.5" />
                          {method.label}
                        </span>
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
                      colSpan={6}
                      className="py-10 text-center text-sm text-muted-foreground"
                    >
                      No payments match your filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

            {/* Footer */}
            <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
              <p className="text-xs text-muted-foreground">
                Showing {filtered.length} of 1,284 payments
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
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}