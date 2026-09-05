import { AppShell, RoleBadge } from "@/components/AppShell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
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
  Activity,
  Building2,
  Cpu,
  Info,
  Server,
  ShieldCheck,
  Webhook,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const TEAM = [
  { name: "Maya Chen", email: "maya@payraksha.io", role: "admin", status: "Active", lastActive: "2 min ago" },
  { name: "Jonas Weber", email: "jonas@payraksha.io", role: "analyst", status: "Active", lastActive: "18 min ago" },
  { name: "Priya Nair", email: "priya@payraksha.io", role: "analyst", status: "Active", lastActive: "1 hr ago" },
  { name: "Sam Okafor", email: "sam@payraksha.io", role: "support", status: "Active", lastActive: "3 hrs ago" },
  { name: "Lena Fischer", email: "lena@payraksha.io", role: "member", status: "Invited", lastActive: "—" },
];

const FLAGS = [
  { id: "scoring", title: "Auto risk scoring", description: "ML scoring on every payment before settlement.", defaultOn: true },
  { id: "alerts", title: "Real-time alerts", description: "Stream case alerts to Slack and email instantly.", defaultOn: true },
  { id: "beta-routing", title: "Beta payout routing", description: "Route payouts through the new ledger service.", defaultOn: false },
  { id: "maintenance", title: "Maintenance mode", description: "Block new payouts while systems are updated.", defaultOn: false },
];

const SERVICES = [
  { name: "Payments API", detail: "99.98% uptime · p95 84ms", icon: Cpu, status: "Operational" },
  { name: "Webhooks", detail: "0 failed deliveries in 24h", icon: Webhook, status: "Operational" },
  { name: "Risk engine", detail: "Queue depth 12 · avg 0.8s", icon: Activity, status: "Operational" },
  { name: "Ledger store", detail: "3 regions · synced", icon: Server, status: "Operational" },
];

const ROLE_CLASS: Record<string, string> = {
  admin: "border-transparent bg-accent-tint text-accent-foreground",
  analyst: "border-transparent bg-success/15 text-success",
  support: "border-transparent bg-warning/15 text-warning",
  member: "border-transparent bg-muted text-muted-foreground",
};

export default function Admin() {
  const { user } = useAuth();
  const [environment, setEnvironment] = useState("production");
  const [flags, setFlags] = useState(() => new Map(FLAGS.map((f) => [f.id, f.defaultOn])));

  const isAdmin = user?.role === "admin";

  const toggleFlag = (id: string) => {
    setFlags((prev) => {
      const next = new Map(prev);
      next.set(id, !(next.get(id) ?? false));
      return next;
    });
    toast.success("Feature flag updated.");
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Admin
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Platform health, team access and feature flags.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1.5 rounded-full">
              <ShieldCheck className="size-3" />
              Signed in as
            </Badge>
            <RoleBadge role={user?.role ?? "member"} />
          </div>
        </div>

        {!isAdmin && (
          <Alert className="mt-6 border-warning/30 bg-warning/5">
            <Info className="size-4" />
            <AlertTitle className="text-sm">Read-only preview</AlertTitle>
            <AlertDescription>
              Admin actions are locked in this environment. Your account has
              member-level access.
            </AlertDescription>
          </Alert>
        )}

        {/* Stats */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Active merchants", value: "1,284", icon: Building2 },
            { label: "API uptime", value: "99.98%", icon: Cpu },
            { label: "Webhook failures", value: "0", icon: Webhook },
            { label: "Risk queue depth", value: "12", icon: Activity },
          ].map((stat) => (
            <Card key={stat.label} className="gap-4 p-5 shadow-card">
              <span className="flex size-9 items-center justify-center rounded-lg bg-accent-tint text-accent-foreground">
                <stat.icon className="size-4" />
              </span>
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  {stat.label}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
                  {stat.value}
                </p>
              </div>
            </Card>
          ))}
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          {/* Team table */}
          <Card className="shadow-card lg:col-span-2">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Team access</CardTitle>
                <CardDescription className="mt-1">
                  Members with access to this workspace
                </CardDescription>
              </div>
              <Button size="sm" onClick={() => toast("Invite flow opens in v2.")}>
                Invite
              </Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs text-muted-foreground">Member</TableHead>
                    <TableHead className="text-xs text-muted-foreground">Role</TableHead>
                    <TableHead className="text-xs text-muted-foreground">Status</TableHead>
                    <TableHead className="text-right text-xs text-muted-foreground">Last active</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {TEAM.map((member) => (
                    <TableRow key={member.email}>
                      <TableCell>
                        <p className="text-sm font-medium">{member.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {member.email}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge className={ROLE_CLASS[member.role]}>
                          {member.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span
                          className={
                            member.status === "Active"
                              ? "text-xs font-medium text-success"
                              : "text-xs font-medium text-muted-foreground"
                          }
                        >
                          {member.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {member.lastActive}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Environment + flags */}
          <div className="flex flex-col gap-6">
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="text-base">Environment</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Select value={environment} onValueChange={setEnvironment}>
                  <SelectTrigger className="w-full bg-background/60">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="production">Production</SelectItem>
                    <SelectItem value="sandbox">Sandbox</SelectItem>
                    <SelectItem value="staging">Staging</SelectItem>
                  </SelectContent>
                </Select>
                <ul className="flex flex-col gap-2">
                  {SERVICES.map((service) => (
                    <li
                      key={service.name}
                      className="flex items-center gap-2.5 rounded-lg border border-border/70 bg-background/40 px-3 py-2.5"
                    >
                      <service.icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0">
                        <span className="block text-xs font-medium">
                          {service.name}
                        </span>
                        <span className="block truncate font-mono text-[11px] text-muted-foreground">
                          {service.detail}
                        </span>
                      </span>
                      <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-medium text-success">
                        <span className="size-1.5 rounded-full bg-success" />
                        {service.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="text-base">Feature flags</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1">
                {FLAGS.map((flag) => (
                  <div
                    key={flag.id}
                    className="flex items-center justify-between gap-3 rounded-lg px-2 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{flag.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {flag.description}
                      </p>
                    </div>
                    <Switch
                      checked={flags.get(flag.id) ?? false}
                      onCheckedChange={() => toggleFlag(flag.id)}
                      aria-label={`Toggle ${flag.title}`}
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}