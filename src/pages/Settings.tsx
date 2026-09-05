import { AppShell, RoleBadge } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/use-auth";
import { Copy, KeyRound, RefreshCw, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const NOTIFICATIONS = [
  {
    id: "payments",
    title: "Payment alerts",
    description: "Failed or flagged payments notify you immediately.",
    defaultOn: true,
  },
  {
    id: "cases",
    title: "Investigation updates",
    description: "Status changes on cases you are assigned to.",
    defaultOn: true,
  },
  {
    id: "digest",
    title: "Weekly digest",
    description: "Volume, success rate and risk summary every Monday.",
    defaultOn: true,
  },
  {
    id: "security",
    title: "Security events",
    description: "Sign-ins from new devices and API key rotations.",
    defaultOn: true,
  },
];

export default function Settings() {
  const { user } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [company, setCompany] = useState("Meridian Payments Inc.");
  const [currency, setCurrency] = useState("USD");
  const [timezone, setTimezone] = useState("America/New_York");
  const [notifications, setNotifications] = useState(() =>
    new Map(NOTIFICATIONS.map((n) => [n.id, n.defaultOn])),
  );

  const toggleNotification = (id: string) => {
    setNotifications((prev) => {
      const next = new Map(prev);
      next.set(id, !(next.get(id) ?? false));
      return next;
    });
  };

  const initials = (name || user?.name || "G")
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Settings
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your profile, workspace preferences and security.
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-6">
          {/* Profile */}
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">Profile</CardTitle>
              <CardDescription className="mt-1">
                How you appear across the workspace.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="flex items-center gap-3">
                <span className="flex size-11 items-center justify-center rounded-xl bg-accent-tint text-sm font-semibold text-accent-foreground ring-1 ring-border">
                  {initials}
                </span>
                <div>
                  <RoleBadge role={user?.role} />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {user?.isAnonymous ? "Anonymous session" : "Verified account"}
                  </p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    Full name
                  </span>
                  <Input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="bg-background/60"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    Email
                  </span>
                  <Input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="bg-background/60"
                  />
                </label>
              </div>
              <div>
                <Button
                  size="sm"
                  onClick={() => toast.success("Profile saved.")}
                >
                  <Save className="size-4" />
                  Save changes
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Workspace */}
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">Workspace</CardTitle>
              <CardDescription className="mt-1">
                Company details and display preferences.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    Company
                  </span>
                  <Input
                    value={company}
                    onChange={(event) => setCompany(event.target.value)}
                    className="bg-background/60"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    Base currency
                  </span>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger className="w-full bg-background/60">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD — US Dollar</SelectItem>
                      <SelectItem value="EUR">EUR — Euro</SelectItem>
                      <SelectItem value="GBP">GBP — British Pound</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <label className="flex flex-col gap-1.5 sm:col-span-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    Timezone
                  </span>
                  <Select value={timezone} onValueChange={setTimezone}>
                    <SelectTrigger className="w-full bg-background/60">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="America/New_York">
                        America/New_York (ET)
                      </SelectItem>
                      <SelectItem value="Europe/London">
                        Europe/London (GMT)
                      </SelectItem>
                      <SelectItem value="Asia/Tokyo">Asia/Tokyo (JST)</SelectItem>
                      <SelectItem value="UTC">UTC</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              </div>
              <div>
                <Button
                  size="sm"
                  onClick={() => toast.success("Workspace preferences saved.")}
                >
                  <Save className="size-4" />
                  Save preferences
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Notifications */}
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">Notifications</CardTitle>
              <CardDescription className="mt-1">
                Choose what Meridian sends you.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              {NOTIFICATIONS.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-4 rounded-lg px-3 py-3 transition-colors hover:bg-muted/40"
                >
                  <div>
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                  <Switch
                    checked={notifications.get(item.id) ?? false}
                    onCheckedChange={() => toggleNotification(item.id)}
                    aria-label={`Toggle ${item.title}`}
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Security */}
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">API &amp; security</CardTitle>
              <CardDescription className="mt-1">
                Credentials for programmatic access.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                  Live secret key
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="flex flex-1 items-center gap-2 rounded-md border border-input bg-background/60 px-3 py-2">
                    <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                    <code className="font-mono text-sm tabular-nums">
                      mr_live_••••••••••••••••9f3k
                    </code>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        await navigator.clipboard.writeText("mr_live_redacted");
                        toast.success("Key copied to clipboard.");
                      }}
                    >
                      <Copy className="size-4" />
                      Copy
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        toast("Rotation requires admin confirmation — request sent.")
                      }
                    >
                      <RefreshCw className="size-4" />
                      Rotate
                    </Button>
                  </div>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Rotating a key invalidates it immediately. Store it somewhere
                  safe.
                </p>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-background/40 px-3 py-2.5">
                <Badge className="border-transparent bg-success/15 text-success">
                  Healthy
                </Badge>
                <p className="text-xs text-muted-foreground">
                  All webhook endpoints responding · last check 2 min ago
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Danger zone */}
          <Card className="border-danger/30 shadow-card">
            <CardHeader>
              <CardTitle className="text-base text-danger">
                Danger zone
              </CardTitle>
              <CardDescription className="mt-1">
                Irreversible actions for the workspace.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">Delete workspace</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Removes all merchants, payments and cases. This cannot be
                  undone.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 border-danger/40 text-danger hover:bg-danger/10 hover:text-danger"
                onClick={() => toast("Deletion request requires two admins to approve.")}
              >
                <Trash2 className="size-4" />
                Delete workspace
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}