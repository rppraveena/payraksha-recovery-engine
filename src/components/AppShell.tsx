import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useAuth } from "@/hooks/use-auth";
import logo from "@/assets/logo.svg";
import {
  CreditCard,
  FileSearch,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  AlertTriangle,
  BookOpen,
  ClipboardList,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { NavLink, useNavigate } from "react-router";
import { cn } from "@/lib/utils";

const NAV_SECTIONS = [
  {
    label: "Operations",
    items: [
      { to: "/dashboard", label: "Command Center", icon: LayoutDashboard },
      { to: "/payments", label: "Payments", icon: CreditCard },
      { to: "/investigations", label: "Investigations", icon: FileSearch },
      { to: "/investigations", label: "Incidents", icon: AlertTriangle },
    ],
  },
  {
    label: "Control",
    items: [
      { to: "/settings", label: "Policies", icon: BookOpen },
      { to: "/settings", label: "Audit", icon: ClipboardList },
    ],
  },
  {
    label: "Admin",
    items: [
      { to: "/settings", label: "Settings", icon: Settings },
      { to: "/admin", label: "Admin", icon: ShieldCheck },
    ],
  },
] as const;

function Brand() {
  return (
    <NavLink to="/dashboard" className="flex items-center gap-2.5">
      <span className="flex size-8 items-center justify-center rounded-lg bg-accent-tint ring-1 ring-border">
        <img src={logo} alt="" width={18} height={18} className="rounded" />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold tracking-tight text-sidebar-foreground">
          PayRaksha
        </span>
        <span className="block text-[11px] text-muted-foreground">
          Payment Intelligence
        </span>
      </span>
    </NavLink>
  );
}

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-6">
      {NAV_SECTIONS.map((section) => (
        <div key={section.label}>
          <p className="px-3 pb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {section.label}
          </p>
          <ul className="flex flex-col gap-1">
            {section.items.map((item) => (
              <li key={item.label}>
                <NavLink
                  to={item.to}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                    )
                  }
                >
                  <item.icon className="size-4 shrink-0" />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function UserCard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const name = user?.name ?? "Guest user";
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate("/");
    } catch (error) {
      console.error("Sign out error:", error);
    }
  };

  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-sidebar-border bg-sidebar p-2.5">
      <Avatar className="size-8 shrink-0">
        <AvatarFallback className="bg-accent-tint text-xs font-semibold text-accent-foreground">
          {initials || "?"}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-xs font-semibold text-sidebar-foreground">
          {name}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {user?.email ?? "Signed in"}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground hover:text-destructive"
        onClick={handleSignOut}
        aria-label="Sign out"
      >
        <LogOut className="size-4" />
      </Button>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-app-glow">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-4 py-5 lg:flex">
        <div className="px-1 pb-6">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto">
          <NavItems />
        </div>
        <div className="pt-4">
          <UserCard />
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-background/80 px-4 py-3 backdrop-blur lg:hidden">
          <Brand />
          <Sheet open={navOpen} onOpenChange={setNavOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Open menu">
                <Menu className="size-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 bg-sidebar p-4">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <div className="flex h-full flex-col">
                <div className="px-1 pb-6 pt-2">
                  <Brand />
                </div>
                <div className="flex-1">
                  <NavItems onNavigate={() => setNavOpen(false)} />
                </div>
                <div className="pt-4">
                  <UserCard />
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </header>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

export function RoleBadge({ role }: { role?: string | null }) {
  if (!role) {
    return <Badge variant="secondary">viewer</Badge>;
  }
  if (role === "super_admin") {
    return (
      <Badge className="border-transparent bg-danger/15 text-danger">
        super admin
      </Badge>
    );
  }
  if (role === "admin") {
    return (
      <Badge className="border-transparent bg-accent-tint text-accent-foreground">
        admin
      </Badge>
    );
  }
  if (role === "operator") {
    return (
      <Badge className="border-transparent bg-success/15 text-success">
        operator
      </Badge>
    );
  }
  return <Badge variant="outline">{role}</Badge>;
}
