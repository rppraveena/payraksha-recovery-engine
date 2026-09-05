import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import logo from "@/assets/logo.svg";
import { motion } from "framer-motion";
import { ArrowRight, Check, Palette, Sparkles } from "lucide-react";
import { useState, type CSSProperties, type FormEvent } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------------------
   Style library — the chooser compares typography, controls and surfaces.
   Each style preview is rendered with tokens scoped to the card (surface,
   accent, radius, font) while the card chrome uses the global design tokens.
   --------------------------------------------------------------------------- */

interface StyleConfig {
  id: string;
  name: string;
  tagline: string;
  font: string;
  heading: string;
  radius: string;
  accent: string;
  surface: string;
  ink: string;
  border: string;
  shadow?: string;
  lined?: boolean;
  glass?: boolean;
  grid?: boolean;
  hard?: boolean;
}

const RECOMMENDED: StyleConfig[] = [
  {
    id: "minimalism",
    name: "Minimalism",
    tagline: "Clean essentials",
    font: '"Inter Variable", Inter, ui-sans-serif, system-ui, sans-serif',
    heading: '"Inter Variable", Inter, ui-sans-serif, system-ui, sans-serif',
    radius: "8px",
    accent: "#7c8aa0",
    surface: "#171726",
    ink: "#e6e9f2",
    border: "#262640",
  },
  {
    id: "modern",
    name: "Modern",
    tagline: "Crisp product polish",
    font: '"Inter Variable", Inter, ui-sans-serif, system-ui, sans-serif',
    heading: '"Inter Variable", Inter, ui-sans-serif, system-ui, sans-serif',
    radius: "6px",
    accent: "#4a6fa5",
    surface: "#1e1e32",
    ink: "#e9edf5",
    border: "#2b2b4a",
    shadow: "0 10px 32px -16px rgb(4 8 24 / 0.55)",
  },
  {
    id: "neobrutalism",
    name: "Neobrutalism",
    tagline: "Hard edges, controlled palette",
    font: '"Inter Variable", Inter, ui-sans-serif, system-ui, sans-serif',
    heading: '"Inter Variable", Inter, ui-sans-serif, system-ui, sans-serif',
    radius: "2px",
    accent: "#eab308",
    surface: "#14141f",
    ink: "#f4f4f5",
    border: "#f4f4f5",
    hard: true,
  },
];

const MORE_STYLES: StyleConfig[] = [
  {
    id: "papery",
    name: "Papery",
    tagline: "Newsroom minimalism",
    font: "Georgia, 'Times New Roman', serif",
    heading: "Georgia, 'Times New Roman', serif",
    radius: "2px",
    accent: "#9a7b4f",
    surface: "#efe9dd",
    ink: "#2a2620",
    border: "#d8cdb8",
  },
  {
    id: "notebook",
    name: "Notebook",
    tagline: "Lined and hand-kept",
    font: "Georgia, 'Times New Roman', serif",
    heading: "Georgia, 'Times New Roman', serif",
    radius: "0px",
    accent: "#60a5fa",
    surface: "#16162a",
    ink: "#dde3f2",
    border: "#2a2a52",
    lined: true,
  },
  {
    id: "studio",
    name: "Studio",
    tagline: "Soft modern editorial",
    font: '"Inter Variable", Inter, ui-sans-serif, system-ui, sans-serif',
    heading: "Georgia, 'Times New Roman', serif",
    radius: "12px",
    accent: "#a78bfa",
    surface: "#201d33",
    ink: "#ece9f8",
    border: "#37335a",
  },
  {
    id: "claymorphism",
    name: "Claymorphism",
    tagline: "Soft surfaces",
    font: '"Inter Variable", Inter, ui-sans-serif, system-ui, sans-serif',
    heading: '"Inter Variable", Inter, ui-sans-serif, system-ui, sans-serif',
    radius: "20px",
    accent: "#f472b6",
    surface: "#2b2038",
    ink: "#f6e9f0",
    border: "#4a3554",
    shadow:
      "inset 0 2px 8px rgb(255 255 255 / 0.08), 0 18px 34px -14px rgb(0 0 0 / 0.6)",
  },
  {
    id: "vintage",
    name: "Vintage",
    tagline: "Aged and elegant",
    font: "Georgia, 'Times New Roman', serif",
    heading: "Georgia, 'Times New Roman', serif",
    radius: "4px",
    accent: "#d4a373",
    surface: "#241d15",
    ink: "#ede4d5",
    border: "#4a3c29",
  },
  {
    id: "glassmorphism",
    name: "Glassmorphism",
    tagline: "Light translucent depth",
    font: '"Inter Variable", Inter, ui-sans-serif, system-ui, sans-serif',
    heading: '"Inter Variable", Inter, ui-sans-serif, system-ui, sans-serif',
    radius: "16px",
    accent: "#a5b4fc",
    surface: "rgb(255 255 255 / 0.06)",
    ink: "#eef1ff",
    border: "rgb(255 255 255 / 0.14)",
    glass: true,
  },
  {
    id: "terminal",
    name: "Terminal",
    tagline: "Light technical precision",
    font: '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace',
    heading: '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace',
    radius: "0px",
    accent: "#4ade80",
    surface: "#0d120e",
    ink: "#d1fadf",
    border: "rgb(74 222 128 / 0.22)",
  },
  {
    id: "swiss",
    name: "Swiss",
    tagline: "Graphic grid clarity",
    font: '"Inter Variable", Inter, ui-sans-serif, system-ui, sans-serif',
    heading: '"Inter Variable", Inter, ui-sans-serif, system-ui, sans-serif',
    radius: "0px",
    accent: "#e5484d",
    surface: "#101016",
    ink: "#ececf1",
    border: "#2e2e3a",
    grid: true,
  },
];

const ALL_STYLES = [...RECOMMENDED, ...MORE_STYLES];

/** Pick legible foreground for a preview accent (light accents get dark text). */
function readableOn(hex: string) {
  const value = hex.replace("#", "");
  if (value.length !== 6) return "#ffffff";
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 150 ? "#12141c" : "#ffffff";
}

function StylePreview({ style }: { style: StyleConfig }) {
  const vars = {
    "--pv-font": style.font,
    "--pv-heading": style.heading,
    "--pv-radius": style.radius,
    "--pv-accent": style.accent,
    "--pv-surface": style.surface,
    "--pv-ink": style.ink,
    "--pv-border": style.border,
    "--pv-shadow": style.shadow ?? "none",
  } as CSSProperties;

  return (
    <div
      className="relative flex flex-col gap-2 overflow-hidden p-4"
      style={{
        ...vars,
        background: style.glass
          ? "linear-gradient(140deg, rgb(255 255 255 / 0.1), rgb(255 255 255 / 0.03))"
          : style.surface,
        borderRadius: "var(--pv-radius)",
        border: `1px solid var(--pv-border)`,
        boxShadow:
          style.glass || style.hard
            ? "0 16px 40px -18px rgb(0 0 0 / 0.65)"
            : "var(--pv-shadow)",
        color: "var(--pv-ink)",
      }}
    >
      {style.lined && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "repeating-linear-gradient(transparent 0 22px, rgb(96 165 250 / 0.14) 22px 23px), linear-gradient(90deg, transparent 0 22px, rgb(239 68 68 / 0.28) 22px 23px)",
          }}
        />
      )}
      {style.grid && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "linear-gradient(rgb(255 255 255 / 0.05) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.05) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
      )}
      {style.hard && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[2px]"
          style={{ boxShadow: "4px 4px 0 0 var(--pv-accent)" }}
        />
      )}

      <div className="relative flex items-start justify-between">
        <span
          className="text-2xl font-bold leading-none"
          style={{ fontFamily: "var(--pv-font)" }}
        >
          Aa
        </span>
        <span
          className="text-[10px] uppercase tracking-[0.14em] opacity-70"
          style={{ fontFamily: "var(--pv-font)" }}
        >
          Design system
        </span>
      </div>

      <div className="relative mt-1">
        <p
          className="text-[15px] font-semibold tracking-tight"
          style={{ fontFamily: "var(--pv-heading)" }}
        >
          Heading
        </p>
        <p
          className="mt-0.5 text-[11px] leading-relaxed opacity-75"
          style={{ fontFamily: "var(--pv-font)" }}
        >
          Clear, reusable interface elements.
        </p>
      </div>

      <div className="relative mt-1 flex items-center gap-2">
        <span
          className="text-[10px] uppercase tracking-wider opacity-60"
          style={{ fontFamily: "var(--pv-font)" }}
        >
          Primary
        </span>
        <span
          className="inline-flex h-6 items-center rounded px-2.5 text-[11px] font-semibold"
          style={{
            background: "var(--pv-accent)",
            borderRadius: "calc(var(--pv-radius) * 0.7)",
            fontFamily: "var(--pv-font)",
            color: readableOn(style.accent),
          }}
        >
          Button
        </span>
      </div>

      <div
        className="relative mt-auto flex items-end justify-between border-t pt-2.5"
        style={{ borderColor: "var(--pv-border)" }}
      >
        <span
          className="text-[10px] uppercase tracking-wider opacity-60"
          style={{ fontFamily: "var(--pv-font)" }}
        >
          Total
        </span>
        <span
          className="text-[13px] font-semibold tabular-nums"
          style={{ fontFamily: 'var(--font-family-mono)' }}
        >
          $24.8k
        </span>
      </div>
    </div>
  );
}

function StyleCard({
  style,
  selected,
  onUse,
}: {
  style: StyleConfig;
  selected: boolean;
  onUse: (style: StyleConfig) => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "group relative flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-card transition-all duration-200",
        selected
          ? "border-accent ring-2 ring-accent/40"
          : "hover:-translate-y-0.5 hover:border-border hover:shadow-md",
      )}
    >
      {selected && (
        <span className="absolute -top-2 right-4 z-10 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground shadow-sm">
          <Check className="size-3" />
          In use
        </span>
      )}
      <StylePreview style={style} />
      <div className="flex items-center justify-between gap-2 px-1 pb-0.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight">
            {style.name}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {style.tagline}
          </p>
        </div>
        <Button
          size="sm"
          variant={selected ? "outline" : "default"}
          onClick={() => onUse(style)}
          className="shrink-0"
        >
          {selected ? "Applied" : "Use this"}
        </Button>
      </div>
    </motion.div>
  );
}

function SectionHeading({
  title,
  count,
}: {
  title: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-3">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <Badge variant="secondary" className="rounded-full px-2">
        {count}
      </Badge>
      <span className="hidden h-px flex-1 bg-border sm:block" />
    </div>
  );
}

export default function Landing() {
  const [selected, setSelected] = useState("modern");
  const [customStyle, setCustomStyle] = useState("");

  const active = ALL_STYLES.find((style) => style.id === selected);

  const handleUse = (style: StyleConfig) => {
    setSelected(style.id);
    if (style.id === "modern") {
      toast.success("Modern is applied across the product.");
    } else {
      toast(`${style.name} previewed — Modern remains the active theme in v1.`);
    }
  };

  const handleCustom = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!customStyle.trim()) return;
    toast(
      `“${customStyle.trim()}” — custom styles ship in v2. Modern stays applied.`,
    );
    setCustomStyle("");
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="flex min-h-screen flex-col bg-app-glow"
    >
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-accent-tint ring-1 ring-border">
              <img src={logo} alt="" width={18} height={18} className="rounded" />
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-semibold tracking-tight">
                PayRaksha
              </span>
              <span className="block text-[11px] text-muted-foreground">
                Payment Intelligence
              </span>
            </span>
          </Link>
          <nav className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/auth">Sign in</Link>
            </Button>
            <Button size="sm" asChild>
              <Link to="/auth?returnTo=/dashboard">
                Open dashboard
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          {/* Hero */}
          <section className="pb-10 pt-16 sm:pt-24">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="mx-auto max-w-2xl text-center"
            >
              <Badge
                variant="outline"
                className="mb-5 gap-1.5 rounded-full px-3 py-1 text-xs text-muted-foreground"
              >
                <Palette className="size-3" />
                Fintech design system · v1 tokens
              </Badge>
              <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
                Choose a style
              </h1>
              <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
                Compare typography, controls, and surfaces. You can change this
                anytime.
              </p>

              {/* Describe your own */}
              <form
                onSubmit={handleCustom}
                className="mx-auto mt-8 flex max-w-md items-center gap-2"
              >
                <Input
                  value={customStyle}
                  onChange={(event) => setCustomStyle(event.target.value)}
                  placeholder="e.g. warm editorial with hand-drawn accents"
                  className="h-10 flex-1 bg-card"
                  aria-label="Describe your own style"
                />
                <Button type="submit" variant="outline" className="h-10 shrink-0">
                  Use this
                </Button>
              </form>

              {/* Active style banner */}
              {active && (
                <div className="mx-auto mt-8 flex w-fit items-center gap-2 rounded-full border border-accent/40 bg-accent-tint px-4 py-2">
                  <Sparkles className="size-3.5 text-accent-foreground" />
                  <p className="text-xs font-medium text-accent-foreground">
                    {active.name} — {active.tagline}
                  </p>
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    · applied across the product
                  </span>
                  <Link
                    to="/auth?returnTo=/dashboard"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-primary transition-colors hover:text-primary/80"
                  >
                    See it live
                    <ArrowRight className="size-3" />
                  </Link>
                </div>
              )}
            </motion.div>
          </section>

          {/* Recommended */}
          <section className="pb-12">
            <div className="mb-5">
              <SectionHeading title="Recommended" count={RECOMMENDED.length} />
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {RECOMMENDED.map((style) => (
                <StyleCard
                  key={style.id}
                  style={style}
                  selected={selected === style.id}
                  onUse={handleUse}
                />
              ))}
            </div>
          </section>

          {/* More styles */}
          <section className="pb-16">
            <div className="mb-5">
              <SectionHeading title="More styles" count={MORE_STYLES.length} />
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {MORE_STYLES.map((style) => (
                <StyleCard
                  key={style.id}
                  style={style}
                  selected={selected === style.id}
                  onUse={handleUse}
                />
              ))}
            </div>
          </section>

          {/* CTA band */}
          <section className="pb-20">
            <div className="relative overflow-hidden rounded-2xl border border-border bg-card px-6 py-12 text-center shadow-card sm:px-12">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    "radial-gradient(36rem 16rem at 50% -4rem, rgb(74 111 165 / 0.22), transparent 70%)",
                }}
              />
              <div className="relative">
                <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                  Your product is already running on{" "}                    <span className="text-primary">PayRaksha</span>
                </h2>
                <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
                  Every color, typeface, spacing, radius and shadow ships as a
                  CSS variable — the dashboard, payments, investigations,
                  settings and admin all share one token system.
                </p>
                <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
                  <Button size="lg" asChild>
                    <Link to="/auth?returnTo=/dashboard">
                      Open the app
                      <ArrowRight className="size-4" />
                    </Link>
                  </Button>
                  <Button size="lg" variant="outline" asChild>
                    <Link to="/auth">Sign in</Link>
                  </Button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/70">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:px-6">
          <p>                  © 2026 PayRaksha — Payment State & Recovery Intelligence.</p>
          <p className="font-mono">                    PayRaksha · Payment Intelligence
          </p>
        </div>
      </footer>
    </motion.div>
  );
}