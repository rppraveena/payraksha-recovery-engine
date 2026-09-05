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
import { useAuth } from "@/hooks/use-auth";
import {
  fetchPaymentById,
  fetchPaymentEvents,
  type PaymentRow,
  type PaymentEventRow,
} from "@/lib/supabase";
import {
  applyEvent,
  foldEvents,
  isTerminalState,
  type PaymentEventInput,
  type PaymentState,
} from "@/lib/payment-states";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  Loader2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";

const STATUS_BADGE: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  CAPTURED: { label: "Captured", className: "border-transparent bg-success/15 text-success", icon: CheckCircle2 },
  CAPTURED_AFTER_FAILURE: { label: "Recovered", className: "border-transparent bg-success/15 text-success", icon: CheckCircle2 },
  AUTHORIZED: { label: "Authorized", className: "border-transparent bg-accent/15 text-accent-foreground", icon: Clock },
  PENDING_REVIEW: { label: "Pending Review", className: "border-transparent bg-warning/15 text-warning", icon: Clock },
  FAILED: { label: "Failed", className: "border-transparent bg-danger/15 text-danger", icon: XCircle },
  RECOVERY_PENDING: { label: "Recovery Pending", className: "border-transparent bg-warning/15 text-warning", icon: Clock },
  ESCALATED: { label: "Escalated", className: "border-transparent bg-danger/15 text-danger", icon: AlertTriangle },
  BLOCKED: { label: "Blocked", className: "border-transparent bg-danger/15 text-danger", icon: XCircle },
  RECOVERY_CANCELLED: { label: "Recovery Cancelled", className: "border-transparent bg-muted text-muted-foreground", icon: XCircle },
};

const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);

export default function PaymentDetail() {
  const { paymentId } = useParams<{ paymentId: string }>();
  const { user } = useAuth();
  const [payment, setPayment] = useState<PaymentRow | null>(null);
  const [events, setEvents] = useState<PaymentEventRow[]>([]);
  const [reconstructedState, setReconstructedState] = useState<PaymentState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!paymentId) { setError("No payment ID"); setLoading(false); return; }
    try {
      const [paymentRes, eventsRes] = await Promise.all([
        fetchPaymentById(paymentId),
        fetchPaymentEvents(paymentId),
      ]);
      if (!paymentRes.ok) {
        setError(paymentRes.error);
        setLoading(false);
        return;
      }
      setPayment(paymentRes.data);
      if (eventsRes.ok) {
        setEvents(eventsRes.data);
        // Reconstruct state from events
        const inputs: PaymentEventInput[] = eventsRes.data.map((e) => ({
          type: e.event_type,
          timestamp: e.occurred_at,
          payload: e.raw_payload,
        }));
        const foldResult = foldEvents(inputs);
        if (foldResult.state) {
          setReconstructedState(foldResult.state);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load payment");
    } finally {
      setLoading(false);
    }
  }, [paymentId]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return (
      <AppShell>
        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        </div>
      </AppShell>
    );
  }

  if (error || !payment) {
    return (
      <AppShell>
        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
          <p className="text-sm text-destructive">{error ?? "Payment not found"}</p>
          <Button variant="ghost" size="sm" asChild className="mt-4">
            <Link to="/payments">
              <ArrowLeft className="size-4" />
              Back to payments
            </Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  const statusMeta = STATUS_BADGE[reconstructedState ?? payment.status] ?? {
    label: payment.status,
    className: "border-transparent bg-muted text-muted-foreground",
    icon: Clock,
  };
  const StatusIcon = statusMeta.icon;
  const terminal = isTerminalState(reconstructedState ?? payment.status as PaymentState);

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Back link */}
        <Button variant="ghost" size="sm" asChild className="mb-4">
          <Link to="/payments">
            <ArrowLeft className="size-4" />
            Back to payments
          </Link>
        </Button>

        {/* Payment header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl font-mono">
                {payment.payment_ref}
              </h1>
              <Badge className={statusMeta.className}>
                <StatusIcon className="mr-1 size-3" />
                {statusMeta.label}
              </Badge>
              {terminal && (
                <Badge variant="outline" className="text-xs">
                  Terminal
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {payment.method ?? "—"} · {payment.bank ?? "—"} · {payment.psp ?? "—"}
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-semibold tabular-nums tracking-tight">
              {money(payment.amount)}
            </p>
            <p className="text-xs text-muted-foreground">{payment.currency}</p>
          </div>
        </div>

        {/* Event History */}
        <Card className="mt-8 shadow-card">
          <CardHeader>
            <CardTitle className="text-base">Event History</CardTitle>
            <CardDescription>
              {events.length} persisted events — state reconstructed via the transition contract
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative">
              {/* Vertical timeline line */}
              <div className="absolute left-[15px] top-0 bottom-0 w-px bg-border" />

              <div className="flex flex-col gap-0">
                {events.map((event, index) => {
                  const result = applyEvent(
                    (index > 0
                      ? foldEvents(
                          events.slice(0, index).map((e) => ({
                            type: e.event_type,
                            timestamp: e.occurred_at,
                            payload: e.raw_payload,
                          }))
                        ).state
                      : "PENDING_REVIEW") as PaymentState,
                    { type: event.event_type, timestamp: event.occurred_at, payload: event.raw_payload }
                  );

                  return (
                    <div key={event.id} className="relative flex gap-4 py-3">
                      {/* Timeline dot */}
                      <div className="relative z-10 flex size-[30px] shrink-0 items-center justify-center">
                        <span
                          className={`size-3 rounded-full ${
                            result.ok
                              ? "bg-success"
                              : "bg-danger"
                          } ring-4 ring-background`}
                        />
                      </div>

                      {/* Event content */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-medium">
                            {event.event_type}
                          </span>
                          {result.ok && result.state !== (index > 0 ? "PENDING_REVIEW" : "PENDING_REVIEW") && (
                            <span className="text-xs text-muted-foreground">
                              → {result.state}
                            </span>
                          )}
                          {!result.ok && (
                            <Badge variant="outline" className="text-[10px] border-danger/40 text-danger">
                              Invalid transition
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                          {event.provider_event_id}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {new Date(event.occurred_at).toLocaleString()}
                        </p>
                        {event.raw_payload && Object.keys(event.raw_payload).length > 0 && (
                          <pre className="mt-2 max-h-24 overflow-auto rounded-md border border-border/60 bg-background/40 p-2 text-[10px] leading-4 text-muted-foreground">
                            {JSON.stringify(event.raw_payload, null, 2)}
                          </pre>
                        )}
                      </div>
                    </div>
                  );
                })}

                {events.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No events recorded for this payment.
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* State Reconstruction */}
        <Card className="mt-6 shadow-card">
          <CardHeader>
            <CardTitle className="text-base">State Reconstruction</CardTitle>
            <CardDescription>
              Current state derived from {events.length} events via the transition contract
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg border border-border/70 bg-background/40 px-4 py-3">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Persisted status
                </p>
                <p className="mt-1 font-mono text-lg font-semibold">
                  {payment.status}
                </p>
              </div>
              <div className="rounded-lg border border-border/70 bg-background/40 px-4 py-3">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Reconstructed state
                </p>
                <p className="mt-1 font-mono text-lg font-semibold">
                  {reconstructedState ?? "—"}
                </p>
              </div>
              <div className="rounded-lg border border-border/70 bg-background/40 px-4 py-3">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Terminal?
                </p>
                <p className="mt-1 font-mono text-lg font-semibold">
                  {terminal ? "Yes" : "No"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Metadata */}
        <Card className="mt-6 shadow-card">
          <CardHeader>
            <CardTitle className="text-base">Payment Metadata</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { label: "Payment ID", value: payment.id },
                { label: "Reference", value: payment.payment_ref },
                { label: "Amount", value: money(payment.amount) },
                { label: "Currency", value: payment.currency },
                { label: "Method", value: payment.method ?? "—" },
                { label: "Bank", value: payment.bank ?? "—" },
                { label: "PSP", value: payment.psp ?? "—" },
                { label: "Created", value: new Date(payment.created_at).toLocaleString() },
                { label: "Updated", value: new Date(payment.updated_at).toLocaleString() },
                { label: "Events", value: String(events.length) },
              ].map((item) => (
                <div key={item.label} className="flex items-baseline justify-between gap-2 rounded-lg border border-border/70 bg-background/40 px-3 py-2">
                  <span className="text-xs text-muted-foreground">{item.label}</span>
                  <span className="font-mono text-xs font-medium">{item.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
