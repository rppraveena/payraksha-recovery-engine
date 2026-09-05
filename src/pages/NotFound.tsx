import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { Home } from "lucide-react";
import { Link } from "react-router";

export default function NotFound() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="flex min-h-screen flex-col bg-app-glow"
    >
      {/* Main Content */}
      <div className="flex flex-1 flex-col items-center justify-center px-4">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          404 · not found
        </p>
        <h1 className="mt-4 text-5xl font-semibold tracking-tight sm:text-6xl">
          Page missing
        </h1>
        <p className="mt-3 max-w-sm text-center text-sm leading-relaxed text-muted-foreground">
          The route you requested doesn&apos;t exist in this workspace — it may
          have moved or been removed.
        </p>
        <Button className="mt-8" asChild>
          <Link to="/">
            <Home className="size-4" />
            Back to the app
          </Link>
        </Button>
      </div>
    </motion.div>
  );
}