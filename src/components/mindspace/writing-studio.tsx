import { useServerFn } from "@tanstack/react-start";
import { Copy, LoaderCircle, PenLine } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { generateWriting } from "@/lib/writing.functions";
import { cn } from "@/lib/utils";

const KINDS = [
  { id: "draft" as const, label: "Draft" },
  { id: "rewrite" as const, label: "Rewrite" },
  { id: "shorten" as const, label: "Shorten" },
  { id: "expand" as const, label: "Expand" },
];

const TONES = [
  { id: "neutral" as const, label: "Neutral" },
  { id: "friendly" as const, label: "Friendly" },
  { id: "formal" as const, label: "Formal" },
  { id: "concise" as const, label: "Concise" },
];

export function WritingStudio({ seedText = "" }: { seedText?: string }) {
  const run = useServerFn(generateWriting);
  const [kind, setKind] = useState<(typeof KINDS)[number]["id"]>("draft");
  const [tone, setTone] = useState<(typeof TONES)[number]["id"]>("neutral");
  const [instruction, setInstruction] = useState("");
  const [draft, setDraft] = useState(seedText);
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit() {
    if (!instruction.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await run({ data: { instruction, draft, tone, kind } });
      setResult(response.text);
    } catch {
      setError("The writing assistant could not finish that. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary">Writing</p>
      <h1 className="mt-2 font-display text-3xl font-medium">Write with MindSpace</h1>
      <p className="mt-2 max-w-xl text-sm leading-6 text-foreground/60">
        Draft something new, or paste your own text to rewrite, shorten or expand it.
      </p>

      <section className="mt-6 rounded-lg bg-panel/70 p-4 ring-1 ring-foreground/5 backdrop-blur-md">
        <div className="flex flex-wrap gap-2">
          {KINDS.map((item) => (
            <button
              key={item.id}
              onClick={() => setKind(item.id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                kind === item.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-background/60 text-foreground/60 hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
          <span className="mx-1 w-px self-stretch bg-border" />
          {TONES.map((item) => (
            <button
              key={item.id}
              onClick={() => setTone(item.id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs transition-colors",
                tone === item.id
                  ? "bg-secondary text-secondary-foreground"
                  : "text-foreground/50 hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <label className="mt-4 block text-xs font-medium text-foreground">
          What should it say?
          <input
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="A short summary email about this research…"
            className="mt-1.5 h-10 w-full rounded-md border border-input bg-background/70 px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
        </label>

        {kind !== "draft" && (
          <label className="mt-3 block text-xs font-medium text-foreground">
            Your text
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={6}
              placeholder="Paste the text to work on…"
              className="mt-1.5 w-full resize-y rounded-md border border-input bg-background/70 p-3 text-sm leading-6 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
          </label>
        )}

        <Button
          className="mt-4"
          disabled={busy || !instruction.trim()}
          onClick={() => void submit()}
        >
          {busy ? <LoaderCircle className="animate-spin" /> : <PenLine />}
          {busy ? "Writing…" : "Write it"}
        </Button>

        {error && (
          <p
            role="alert"
            className="mt-3 rounded-md bg-secondary px-3 py-2 text-xs text-secondary-foreground"
          >
            {error}
          </p>
        )}
      </section>

      {result && (
        <section className="mt-4 rounded-lg bg-panel/70 p-4 ring-1 ring-foreground/5 backdrop-blur-md">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Result</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(result);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              }}
            >
              <Copy />
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground/80">{result}</p>
        </section>
      )}
    </div>
  );
}
