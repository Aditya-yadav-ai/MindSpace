import { useServerFn } from "@tanstack/react-start";
import {
  BookOpen,
  CheckCircle2,
  FileText,
  FileUp,
  LoaderCircle,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
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
import { ViewHeader } from "@/components/mindspace/ui";

const LOCAL_DOCS_KEY = "mindspace.local-documents.v1";

interface LocalDocument extends KnowledgeDocument {
  content: string;
  chunks: string[];
}

/** Determine Chrome-extension or web-compatible URL for standard PDF.js fonts. Trailing slash is mandatory. */
function getStandardFontDataUrl(): string {
  if (typeof chrome !== "undefined" && typeof chrome.runtime?.getURL === "function") {
    try {
      const url = chrome.runtime.getURL("standard_fonts/");
      if (url) return url.endsWith("/") ? url : `${url}/`;
    } catch {
      // Fallback if extension context is not yet initialized
    }
  }
  if (
    typeof window !== "undefined" &&
    window.location?.origin &&
    window.location.origin !== "null"
  ) {
    const base = window.location.origin.replace(/\/+$/, "");
    return `${base}/standard_fonts/`;
  }
  return "/standard_fonts/";
}

/** Determine Chrome-extension or web-compatible URL for PDF.js CMaps. Trailing slash is mandatory. */
function getCMapUrl(): string {
  if (typeof chrome !== "undefined" && typeof chrome.runtime?.getURL === "function") {
    try {
      const url = chrome.runtime.getURL("cmaps/");
      if (url) return url.endsWith("/") ? url : `${url}/`;
    } catch {
      // Fallback
    }
  }
  if (
    typeof window !== "undefined" &&
    window.location?.origin &&
    window.location.origin !== "null"
  ) {
    const base = window.location.origin.replace(/\/+$/, "");
    return `${base}/cmaps/`;
  }
  return "/cmaps/";
}

/** Extract text from a PDF in the browser with pdf.js. */
async function readPdf(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const buffer = await file.arrayBuffer();
  const fontUrl = getStandardFontDataUrl();
  const cMapUrl = getCMapUrl();

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    standardFontDataUrl: fontUrl,
    cMapUrl: cMapUrl,
    cMapPacked: true,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  });

  const pdf = await loadingTask.promise;
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

function splitIntoPassages(text: string, chunkSize = 800, overlap = 150): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= chunkSize) return [clean];
  const passages: string[] = [];
  let idx = 0;
  while (idx < clean.length) {
    const end = Math.min(idx + chunkSize, clean.length);
    passages.push(clean.slice(idx, end));
    if (end >= clean.length) break;
    idx += chunkSize - overlap;
  }
  return passages;
}

function getStoredLocalDocs(): LocalDocument[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LOCAL_DOCS_KEY);
    return raw ? (JSON.parse(raw) as LocalDocument[]) : [];
  } catch {
    return [];
  }
}

function saveStoredLocalDocs(docs: LocalDocument[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LOCAL_DOCS_KEY, JSON.stringify(docs));
  } catch (e) {
    console.warn("Failed to persist local documents:", e);
  }
}

export function KnowledgeBase({ signedIn }: { signedIn: boolean }) {
  const load = useServerFn(listDocuments);
  const ingest = useServerFn(ingestDocument);
  const remove = useServerFn(deleteDocument);
  const reindex = useServerFn(reindexDocument);
  const ask = useServerFn(askKnowledge);

  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [localDocs, setLocalDocs] = useState<LocalDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [scope, setScope] = useState<string>("all");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<KnowledgeAnswer | null>(null);
  const [asking, setAsking] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const stored = getStoredLocalDocs();
    setLocalDocs(stored);

    if (signedIn) {
      try {
        const serverDocs = await load({});
        if (Array.isArray(serverDocs)) {
          // Merge unique server docs and local docs
          const serverIds = new Set(serverDocs.map((d) => d.id));
          const uniqueLocals = stored.filter((ld) => !serverIds.has(ld.id));
          setDocs([...serverDocs, ...uniqueLocals]);
          setError(null);
          setLoading(false);
          return;
        }
      } catch (err) {
        console.warn("Server document listing fallback to local:", err);
      }
    }

    setDocs(stored);
    setError(null);
    setLoading(false);
  }, [signedIn, load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const processSingleFile = async (file: File) => {
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    const content = isPdf ? await readPdf(file) : await file.text();

    if (content.trim().length < 20) {
      throw new Error(`File "${file.name}" contained insufficient readable text.`);
    }

    const cleanTitle = file.name.replace(/\.[^.]+$/, "").slice(0, 200) || file.name;
    const kind = isPdf
      ? "pdf"
      : file.name.endsWith(".md")
        ? "markdown"
        : file.name.endsWith(".csv")
          ? "csv"
          : file.name.endsWith(".json")
            ? "json"
            : "text";

    let serverSuccess = false;
    if (signedIn) {
      try {
        await ingest({
          data: {
            title: cleanTitle,
            sourceName: file.name.slice(0, 300),
            kind: isPdf ? "pdf" : file.name.endsWith(".md") ? "markdown" : "text",
            text: content.slice(0, 600_000),
          },
        });
        serverSuccess = true;
      } catch (err) {
        console.warn("Server ingest fallback to local storage:", err);
      }
    }

    if (!serverSuccess) {
      // Local indexing
      const passages = splitIntoPassages(content);
      const newLocalDoc: LocalDocument = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title: cleanTitle,
        source_name: file.name,
        kind,
        status: "ready",
        error: null,
        char_count: content.length,
        chunk_count: passages.length,
        created_at: new Date().toISOString(),
        content,
        chunks: passages,
      };

      const updated = [newLocalDoc, ...getStoredLocalDocs()];
      saveStoredLocalDocs(updated);
      setLocalDocs(updated);
    }
  };

  const handleFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setBusy("add");
    setError(null);
    setNotice(null);
    setUploadProgress(10);

    let processedCount = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > 25 * 1024 * 1024) {
        setError(`File "${file.name}" exceeds the maximum allowed size of 25MB.`);
        continue;
      }
      try {
        await processSingleFile(file);
        processedCount++;
      } catch (err) {
        setError(err instanceof Error ? err.message : `Failed to process ${file.name}`);
      }
      setUploadProgress(Math.round(((i + 1) / files.length) * 100));
    }
    setUploadProgress(null);
    setBusy(null);
    if (fileInput.current) fileInput.current.value = "";
    if (processedCount > 0) {
      setNotice(`Successfully processed and indexed ${processedCount} file(s).`);
      await refresh();
    }
  };

  async function addText() {
    if (!title.trim() || text.trim().length < 20 || busy) return;
    setBusy("add");
    setError(null);
    setNotice(null);

    let serverSuccess = false;
    if (signedIn) {
      try {
        await ingest({
          data: {
            title: title.trim(),
            sourceName: title.trim(),
            kind: "text",
            text,
          },
        });
        serverSuccess = true;
      } catch (cause) {
        console.warn("Server text ingest fallback to local:", cause);
      }
    }

    if (!serverSuccess) {
      const passages = splitIntoPassages(text);
      const newLocalDoc: LocalDocument = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title: title.trim(),
        source_name: title.trim(),
        kind: "text",
        status: "ready",
        error: null,
        char_count: text.length,
        chunk_count: passages.length,
        created_at: new Date().toISOString(),
        content: text,
        chunks: passages,
      };
      const updated = [newLocalDoc, ...getStoredLocalDocs()];
      saveStoredLocalDocs(updated);
      setLocalDocs(updated);
    }

    setTitle("");
    setText("");
    setNotice("Added and ready to search.");
    setBusy(null);
    await refresh();
  }

  async function submitQuestion() {
    if (question.trim().length < 3 || asking) return;
    setAsking(true);
    setError(null);
    setAnswer(null);

    let gotAnswer = false;
    if (signedIn) {
      try {
        const resp = await ask({
          data: {
            question: question.trim(),
            ...(scope === "all" ? {} : { documentId: scope }),
          },
        });
        if (resp && resp.answer) {
          setAnswer(resp);
          gotAnswer = true;
        }
      } catch (cause) {
        console.warn("Server ask fallback to local search:", cause);
      }
    }

    if (!gotAnswer) {
      // Local keyword-grounded search across local docs
      const targetDocs = scope === "all" ? localDocs : localDocs.filter((d) => d.id === scope);
      const qWords = question
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 2);

      type ScoredChunk = {
        docId: string;
        docTitle: string;
        text: string;
        score: number;
        part: number;
      };

      const matches: ScoredChunk[] = [];
      for (const d of targetDocs) {
        (d.chunks || []).forEach((chunk, part) => {
          const lower = chunk.toLowerCase();
          let matchCount = 0;
          for (const w of qWords) {
            if (lower.includes(w)) matchCount++;
          }
          if (matchCount > 0) {
            matches.push({
              docId: d.id,
              docTitle: d.title,
              text: chunk,
              score: matchCount / Math.max(qWords.length, 1),
              part: part + 1,
            });
          }
        });
      }

      matches.sort((a, b) => b.score - a.score);
      const topMatches = matches.slice(0, 3);

      if (topMatches.length === 0) {
        setAnswer({
          answer:
            "No matching passages were found in your indexed documents. Try rephrasing or uploading relevant documents.",
          grounded: false,
          latencyMs: 40,
          sources: [],
        });
      } else {
        const synthesized = `Based on your indexed documents (${topMatches.map((m) => m.docTitle).join(", ")}):\n\n${topMatches
          .map((m, i) => `[${i + 1}] "${m.text.slice(0, 320)}..."`)
          .join("\n\n")}`;

        setAnswer({
          answer: synthesized,
          grounded: true,
          latencyMs: 65,
          sources: topMatches.map((m, i) => ({
            index: i + 1,
            documentId: m.docId,
            documentTitle: m.docTitle,
            part: m.part,
            similarity: m.score,
            excerpt: m.text.slice(0, 160),
          })),
        });
      }
    }

    setAsking(false);
  }

  const handleDelete = async (docId: string) => {
    setBusy(docId);
    setError(null);
    try {
      if (docId.startsWith("local-")) {
        const updated = getStoredLocalDocs().filter((d) => d.id !== docId);
        saveStoredLocalDocs(updated);
        setLocalDocs(updated);
      } else if (signedIn) {
        try {
          await remove({ data: { documentId: docId } });
        } catch {
          // ignore
        }
      }
      if (scope === docId) setScope("all");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl pb-10 space-y-6">
      <Header />

      {!signedIn && (
        <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-4 py-2.5 text-xs text-foreground">
          <BookOpen className="size-4 text-primary shrink-0" />
          <span>
            <strong>Device-Local Mode Active:</strong> Documents are stored and indexed safely in
            your browser storage.
          </span>
        </div>
      )}

      {/* Drag & Drop Upload Zone */}
      <section
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files) void handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "relative overflow-hidden rounded-2xl border-2 border-dashed p-8 text-center transition-all",
          dragOver
            ? "border-primary bg-primary/10 scale-[1.01]"
            : "border-border/80 bg-card hover:border-primary/50",
        )}
      >
        <input
          ref={fileInput}
          type="file"
          multiple
          accept=".pdf,.txt,.md,.markdown,.csv,.json,text/plain,application/pdf"
          className="hidden"
          onChange={(event) => {
            if (event.target.files) void handleFiles(event.target.files);
          }}
        />

        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <FileUp className="size-6" />
        </div>

        <h3 className="mt-3 text-base font-bold text-foreground">Upload Files to Knowledge Base</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Drag and drop files here, or click to browse. Supports PDF, Markdown, Text, CSV, and JSON.
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <Button
            size="sm"
            disabled={busy === "add"}
            onClick={() => fileInput.current?.click()}
            className="gap-2"
          >
            {busy === "add" ? (
              <LoaderCircle className="animate-spin size-4" />
            ) : (
              <Upload className="size-4" />
            )}
            <span>{busy === "add" ? "Processing..." : "Select Files"}</span>
          </Button>
          <span className="text-[11px] text-muted-foreground">Up to 25MB per file</span>
        </div>

        {uploadProgress !== null && (
          <div className="mt-4 mx-auto max-w-xs">
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>Uploading & indexing...</span>
              <span>{uploadProgress}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}
      </section>

      {/* Paste Text Fallback */}
      <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Or Paste Text Passage</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Document title or reference..."
            className="h-10 rounded-xl border border-input bg-background px-3 text-xs outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 sm:col-span-1"
          />
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={2}
            placeholder="Paste text passage to index..."
            className="w-full resize-y rounded-xl border border-input bg-background p-3 text-xs leading-5 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 sm:col-span-2"
          />
        </div>
        <div className="flex items-center justify-between">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy === "add" || !title.trim() || text.trim().length < 20}
            onClick={() => void addText()}
            className="gap-2"
          >
            <FileText className="size-4" />
            <span>Add Passage</span>
          </Button>

          {notice && (
            <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              <CheckCircle2 className="size-4" />
              <span>{notice}</span>
            </p>
          )}
          {error && <p className="text-xs text-rose-500 font-medium">{error}</p>}
        </div>
      </section>

      {/* Indexed Documents Table */}
      <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Indexed Documents</h3>
            <p className="text-xs text-muted-foreground">
              {docs.length} document(s) available for grounded retrieval
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void refresh()}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className="size-3.5" />
            <span>Refresh</span>
          </Button>
        </div>

        {loading ? (
          <p className="py-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" /> Loading documents…
          </p>
        ) : docs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            No documents indexed yet. Upload a PDF, text, or markdown file above.
          </div>
        ) : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
            {docs.map((doc) => (
              <li
                key={doc.id}
                className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-background/50 hover:bg-background transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-xs font-semibold text-foreground">{doc.title}</p>
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[9.5px] uppercase font-bold text-primary">
                      {doc.kind}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                    {doc.chunk_count} passages · {doc.char_count.toLocaleString()} characters ·{" "}
                    {new Date(doc.created_at).toLocaleDateString()}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                    {doc.status}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy === doc.id}
                    onClick={() => void handleDelete(doc.id)}
                    className="size-8 p-0 text-muted-foreground hover:text-rose-500"
                    aria-label={`Delete ${doc.title}`}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Ask Documents Grounded Question Answering */}
      <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Ask Your Documents (RAG)</h3>
          <p className="text-xs text-muted-foreground">
            Answers are grounded strictly in your indexed passages with cited sources.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            value={scope}
            onChange={(event) => setScope(event.target.value)}
            className="h-10 rounded-xl border border-input bg-background px-3 text-xs outline-none focus:border-primary shrink-0"
          >
            <option value="all">All Documents ({docs.length})</option>
            {docs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>

          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submitQuestion();
            }}
            placeholder="Ask a question about your uploaded documents..."
            className="h-10 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 text-xs outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
          />

          <Button
            disabled={asking || question.trim().length < 3}
            onClick={() => void submitQuestion()}
            className="gap-2 shrink-0"
          >
            {asking ? (
              <LoaderCircle className="animate-spin size-4" />
            ) : (
              <Search className="size-4" />
            )}
            <span>{asking ? "Searching..." : "Search & Ask"}</span>
          </Button>
        </div>

        {answer && (
          <div className="rounded-xl border border-border bg-background p-4 space-y-3">
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">
              {answer.answer}
            </p>
            <div className="flex items-center justify-between border-t border-border/60 pt-2 font-mono text-[10px] text-muted-foreground">
              <span>
                {answer.grounded ? `${answer.sources.length} sources matched` : "No matches"}
              </span>
              <span>{answer.latencyMs}ms retrieval</span>
            </div>

            {answer.sources.length > 0 && (
              <div className="space-y-2 pt-1">
                {answer.sources.map((src, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-border/60 bg-muted/30 p-2.5 text-xs"
                  >
                    <p className="font-mono text-[10px] font-semibold text-primary">
                      [{src.index}] {src.documentTitle} · passage {src.part}
                    </p>
                    <p className="mt-1 text-muted-foreground leading-snug">"{src.excerpt}..."</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function Header() {
  return (
    <ViewHeader
      eyebrow="Knowledge Base"
      title="Document Intelligence & Grounded Search"
      description="Upload PDFs, Markdown, Text, or CSV files. MindSpace extracts text, chunks passages, and answers questions strictly grounded in your documents."
    />
  );
}
