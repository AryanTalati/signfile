"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card } from "@/components/ui";

const ACCEPT = ".pdf,.docx,.doc,.odt,.rtf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword";
const MAX = 25 * 1024 * 1024;

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; pct: number }
  | { kind: "processing"; started: number }
  | { kind: "queued"; attempt: number }
  | { kind: "error"; message: string };
const BUSY_RETRIES = 12; // ~1 minute

export function UploadForm() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (phase.kind !== "processing") return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [phase.kind]);

  function choose(f: File | undefined | null) {
    if (!f) return;
    if (f.size > MAX) return setPhase({ kind: "error", message: `That file is ${(f.size / 1048576).toFixed(1)} MB. The limit is 25 MB.` });
    setFile(f);
    upload(f);
  }

  function upload(f: File, attempt = 0) {
    const body = new FormData();
    body.append("file", f);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/templates");
    xhr.upload.onprogress = (e) => e.lengthComputable && setPhase({ kind: "uploading", pct: Math.round((e.loaded / e.total) * 100) });
    xhr.upload.onload = () => setPhase({ kind: "processing", started: Date.now() });
    xhr.onload = () => {
      let data: { id?: string; error?: string } = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status === 201 && data.id) router.push(`/templates/${data.id}?new=1`);
      else if (xhr.status === 503 && attempt < BUSY_RETRIES) {
        // Server is processing other documents: wait our turn instead of failing.
        setPhase({ kind: "queued", attempt: attempt + 1 });
        setTimeout(() => upload(f, attempt + 1), 5000);
      }
      else if (xhr.status === 401) router.push("/login?next=/templates/new");
      else setPhase({ kind: "error", message: data.error ?? "Upload failed. Please try again." });
    };
    xhr.onerror = () => setPhase({ kind: "error", message: "The upload was interrupted. Check your connection and try again." });
    setPhase({ kind: "uploading", pct: 0 });
    xhr.send(body);
  }

  const busy = phase.kind === "uploading" || phase.kind === "processing" || phase.kind === "queued";
  const isWord = file && !/\.pdf$/i.test(file.name);
  const elapsed = phase.kind === "processing" ? Math.floor((now - phase.started) / 1000) : 0;
  const step =
    phase.kind === "queued"
      ? "Waiting for other documents to finish…"
      : phase.kind === "uploading"
      ? `Uploading… ${phase.pct}%`
      : phase.kind === "processing"
        ? isWord && elapsed < 25
          ? "Converting your Word document to PDF…"
          : "Finding signature fields…"
        : "";

  return (
    <div className="flex flex-col gap-4">
      {phase.kind === "error" && <Alert>{phase.message}</Alert>}
      <Card
        className={`flex flex-col items-center gap-3 border-2 border-dashed p-10 text-center transition ${drag ? "border-brand bg-blue-50/50" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (!busy) choose(e.dataTransfer.files?.[0]);
        }}
      >
        {busy ? (
          <>
            <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-neutral-200">
              <div
                className={`h-full bg-brand transition-all ${phase.kind === "processing" ? "w-1/3 animate-[slide_1.2s_ease-in-out_infinite]" : ""}`}
                style={phase.kind === "uploading" ? { width: `${phase.pct}%` } : undefined}
              />
            </div>
            <p className="font-medium" role="status" aria-live="polite">
              {step}
            </p>
            <p className="text-sm text-muted">
              {file?.name}
              {phase.kind === "processing" && elapsed > 3 ? ` · ${elapsed}s` : ""}
            </p>
            {isWord && phase.kind === "processing" && <p className="text-xs text-muted">Word documents take 10–30 seconds to convert.</p>}
          </>
        ) : (
          <>
            <p className="font-medium">Drop your agreement here</p>
            <p className="text-sm text-muted">PDF, Word (.docx, .doc), .odt or .rtf · up to 25 MB</p>
            <Button type="button" onClick={() => input.current?.click()}>
              Choose file
            </Button>
          </>
        )}
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          aria-label="Agreement file"
          data-testid="upload-input"
          onChange={(e) => {
            choose(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </Card>
      <p className="text-xs text-muted">Use test documents only on this demo. Password-protected PDFs can&apos;t be used: remove the password first.</p>
    </div>
  );
}
