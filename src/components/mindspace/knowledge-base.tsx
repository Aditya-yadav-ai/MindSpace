import { useServerFn } from "@tanstack/react-start";
import { BookOpen, FileText, LoaderCircle, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  askKnowledge,
  deleteDocument,
  ingestDocument,
  listDocuments,
  reindexDocument,
  type KnowledgeAnswer,
  type KnowledgeDocument,
} from "@/lib/knowledge.functions";
import { cn } from "@/lib/utils";

/** Extract text from a PDF in the browser with pdf.js. */
async function readPdf(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const parts: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    parts.push(
      content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    );
  }
  return parts.filter(Boolean).join("\n\n");
}

export function KnowledgeBase({ signedIn }: { signedIn: boolean }) {
  const load = useServerFn(listDocuments);
  const ingest = useServerFn(ingestDocument);
  const remove = useServerFn(deleteDocument);
  const reindex = useServerFn(reindexDocument);
  const ask = useServerFn(askKnowledge);

  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(signedIn);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [scope, setScope] = useState<string>("all");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<KnowledgeAnswer | null>(null);
  const [asking, setAsking] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setDocs(await load({}));
      setError(null);
    } catch {
      setError("Your documents could not be loaded. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    if (signedIn) void refresh();
  }, [signedIn, refresh]);

  if (!signedIn) {
    return (
      <div className="mx-auto max-w-3xl">
        <Header />
        <div className="mt-7 grid min-h-72 place-items-center rounded-lg bg-panel/60 p-8 text-center ring-1 ring-foreground/5">
          <div>
            <BookOpen className="mx-auto size-6 text-primary" />
            <p className="mt-4 text-sm font-medium">Sign in to build your knowledge base</p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-foreground/50">
              Your documents stay private to your account, so this needs a real sign-in rather than
              the preview.
            </p>
          </div>
        </div>
      </div>
    );
  }

  async function addText() {
    if (!title.trim() || text.trim().length < 40 || busy) return;
    setBusy("add");
    setError(null);
    setNotice(null);
    try {
      await ingest({ data: { title: title.trim(), sourceName: title.trim(), kind: "text", text } });
      setTitle("");
      setText("");
      setNotice("Added and ready to search.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That text could not be added.");
    } finally {
      setBusy(null);
    }
  }

  async function addFile(file: File) {
    setBusy("add");
    setError(null);
    setNotice(null);
    try {
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      const content = isPdf ? await readPdf(file) : await file.text();
      if (content.trim().length < 40) {
        throw new Error(
          "No readable text was found in that file. A scanned PDF needs text, not just images.",
        );
      }
      await ingest({
        data: {
          title: file.name.replace(/\.[^.]+$/, "").slice(0, 200) || file.name,
          sourceName: file.name.slice(0, 300),
          kind: isPdf ? "pdf" : file.name.endsWith(".md") ? "markdown" : "text",
          text: content.slice(0, 600_000),
        },
      });
      setNotice(`${file.name} is indexed and ready.`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That file could not be read.");
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function submitQuestion() {
    if (question.trim().length < 3 || asking) return;
    setAsking(true);
    setError(null);
    setAnswer(null);
    try {
      setAnswer(
        await ask({
          data: {
            question: question.trim(),
            ...(scope === "all" ? {} : { documentId: scope }),
          },
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That question could not be answered.");
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl pb-8">
      <Header />

      <section className="mt-6 rounded-lg bg-panel/70 p-4 ring-1 ring-foreground/5 backdrop-blur-md">
        <h2 className="text-sm font-semibold">Add to your knowledge base</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.txt,.md,.markdown,text/plain,application/pdf"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void addFile(file);
            }}
          />
          <Button size="sm" disabled={busy === "add"} onClick={() => fileInput.current?.click()}>
            {busy === "add" ? <LoaderCircle className="animate-spin" /> : <Upload />}
            {busy === "add" ? "Reading…" : "Upload PDF or text"}
          </Button>
          <span className="text-xs text-foreground/45">PDF, .txt or .md · text-based files</span>
        </div>

        <label className="mt-4 block text-xs font-medium text-foreground">
          Or paste text — title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Research notes"
            className="mt-1.5 h-10 w-full rounded-md border border-input bg-background/70 px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
        </label>
        <label className="mt-3 block text-xs font-medium text-foreground">
          Text
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={5}
            placeholder="Paste the passage you want to be able to ask about…"
            className="mt-1.5 w-full resize-y rounded-md border border-input bg-background/70 p-3 text-sm leading-6 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
        </label>
        <Button
          size="sm"
          variant="secondary"
          className="mt-3"
          disabled={busy === "add" || !title.trim() || text.trim().length < 40}
          onClick={() => void addText()}
        >
          <FileText />
          Add text
        </Button>

        {error && (
          <p
            role="alert"
            className="mt-3 rounded-md bg-secondary px-3 py-2 text-xs text-secondary-foreground"
          >
            {error}
          </p>
        )}
        {notice && !error && (
          <p
            role="status"
            className="mt-3 rounded-md bg-secondary px-3 py-2 text-xs text-secondary-foreground"
          >
            {notice}
          </p>
        )}
      </section>

      <section className="mt-4 rounded-lg bg-panel/70 p-4 ring-1 ring-foreground/5 backdrop-blur-md">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Your documents</h2>
          <Button variant="ghost" size="sm" onClick={() => void refresh()}>
            <RefreshCw />
            Refresh
          </Button>
        </div>

        {loading ? (
          <p className="mt-4 flex items-center gap-2 text-xs text-foreground/50">
            <LoaderCircle className="size-3.5 animate-spin" /> Loading your documents…
          </p>
        ) : docs.length === 0 ? (
          <p className="mt-4 text-xs leading-5 text-foreground/50">
            Nothing here yet. Upload a PDF or paste some text and it becomes searchable.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {docs.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{doc.title}</p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-foreground/45">
                    {doc.kind} · {doc.chunk_count} passages · {doc.char_count.toLocaleString()}{" "}
                    characters
                  </p>
                  {doc.error && <p className="mt-1 text-[11px] text-caution">{doc.error}</p>}
                </div>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 font-mono text-[10px]",
                    doc.status === "ready"
                      ? "bg-positive/15 text-positive"
                      : doc.status === "failed"
                        ? "bg-caution/15 text-caution"
                        : "bg-foreground/10 text-foreground/60",
                  )}
                >
                  {doc.status}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy === doc.id}
                  onClick={async () => {
                    setBusy(doc.id);
                    setError(null);
                    try {
                      await reindex({ data: { documentId: doc.id } });
                      await refresh();
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : "Re-indexing failed.");
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  {busy === doc.id ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                  Re-index
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete ${doc.title}`}
                  disabled={busy === doc.id}
                  onClick={async () => {
                    setBusy(doc.id);
                    setError(null);
                    try {
                      await remove({ data: { documentId: doc.id } });
                      if (scope === doc.id) setScope("all");
                      await refresh();
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : "Delete failed.");
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-4 rounded-lg bg-panel/70 p-4 ring-1 ring-foreground/5 backdrop-blur-md">
        <h2 className="text-sm font-semibold">Ask your documents</h2>
        <p className="mt-1 text-xs leading-5 text-foreground/50">
          Answers come only from your own files, with numbered sources you can check.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <select
            value={scope}
            onChange={(event) => setScope(event.target.value)}
            className="h-10 rounded-md border border-input bg-background/70 px-2 text-xs outline-none focus:border-primary"
          >
            <option value="all">All documents</option>
            {docs.map((doc) => (
              <option key={doc.id} value={doc.id}>
                {doc.title}
              </option>
            ))}
          </select>
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submitQuestion();
            }}
            placeholder="What does my document say about…?"
            className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background/70 px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
          <Button
            disabled={asking || question.trim().length < 3}
            onClick={() => void submitQuestion()}
          >
            {asking ? <LoaderCircle className="animate-spin" /> : <Search />}
            {asking ? "Searching…" : "Ask"}
          </Button>
        </div>

        {answer && (
          <div className="mt-4 rounded-md bg-background/60 p-4 ring-1 ring-foreground/5">
            <p className="whitespace-pre-wrap text-sm leading-6 text-foreground/85">
              {answer.answer}
            </p>
            <p className="mt-2 font-mono text-[10px] text-foreground/40">
              {answer.grounded ? `${answer.sources.length} sources` : "no matching sources"} ·{" "}
              {answer.latencyMs} ms
            </p>
            {answer.sources.length > 0 && (
              <ol className="mt-3 space-y-2">
                {answer.sources.map((source) => (
                  <li
                    key={`${source.documentId}-${source.part}`}
                    className="rounded-md bg-panel/70 p-2.5"
                  >
                    <p className="font-mono text-[11px] text-primary">
                      [{source.index}] {source.documentTitle} · part {source.part} · match{" "}
                      {Math.round(source.similarity * 100)}%
                    </p>
                    <p className="mt-1 text-xs leading-5 text-foreground/60">{source.excerpt}…</p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function Header() {
  return (
    <>
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary">
        Knowledge base
      </p>
      <h1 className="mt-2 font-display text-3xl font-medium">Ask your own documents</h1>
      <p className="mt-2 max-w-xl text-sm leading-6 text-foreground/60">
        Upload PDFs or paste text. MindSpace reads them, remembers the passages and answers strictly
        from what you added.
      </p>
    </>
  );
}
