"use client";

import { useEffect, useRef, useState } from "react";

// In-session capture tools for the Conduct Assessment cockpit — all native
// browser APIs, no external services: canvas signature pad, MediaRecorder
// voice notes, and BarcodeDetector QR/barcode scanning (Chromium only; the
// scan button hides itself where unsupported).

// ── Signature pad ────────────────────────────────────────────────────────────
export function SignaturePad({ label, disabled, onChange }: {
  label: string; disabled?: boolean; onChange: (dataUrl: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  };

  return (
    <div>
      <p className="text-[10px] font-semibold text-gray-500 mb-1">{label}</p>
      <canvas
        ref={canvasRef}
        width={320} height={96}
        className={`w-full h-20 bg-white border border-dashed rounded-lg touch-none ${hasInk ? "border-green-300" : "border-gray-300"} ${disabled ? "opacity-50" : "cursor-crosshair"}`}
        onPointerDown={e => {
          if (disabled) return;
          drawing.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          const ctx = e.currentTarget.getContext("2d")!;
          ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#1e293b";
          const p = pos(e);
          ctx.beginPath(); ctx.moveTo(p.x, p.y);
        }}
        onPointerMove={e => {
          if (!drawing.current || disabled) return;
          const ctx = e.currentTarget.getContext("2d")!;
          const p = pos(e);
          ctx.lineTo(p.x, p.y); ctx.stroke();
        }}
        onPointerUp={e => {
          if (!drawing.current) return;
          drawing.current = false;
          setHasInk(true);
          onChange(e.currentTarget.toDataURL("image/png"));
        }}
      />
      <div className="flex items-center justify-between mt-1">
        <span className="text-[9px] text-gray-400">{hasInk ? "✓ signed" : "sign above"}</span>
        {hasInk && !disabled && (
          <button type="button"
            onClick={() => {
              const c = canvasRef.current!;
              c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
              setHasInk(false);
              onChange(null);
            }}
            className="text-[9px] text-gray-400 hover:text-red-500">clear</button>
        )}
      </div>
    </div>
  );
}

// ── Voice note recorder ──────────────────────────────────────────────────────
export function VoiceNoteButton({ disabled, onFile, onError }: {
  disabled?: boolean; onFile: (f: File) => void; onError: (msg: string) => void;
}) {
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setSecs(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  useEffect(() => () => { recRef.current?.stream.getTracks().forEach(tr => tr.stop()); }, []);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = e => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(tr => tr.stop());
        const type = rec.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        const ext = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "m4a" : "webm";
        onFile(new File([blob], `voice-note-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.${ext}`, { type }));
      };
      rec.start();
      recRef.current = rec;
      setSecs(0);
      setRecording(true);
    } catch {
      onError("Microphone unavailable or permission denied");
    }
  }

  function stop() {
    recRef.current?.stop();
    setRecording(false);
  }

  return (
    <button type="button" disabled={disabled} onClick={recording ? stop : start}
      className={`text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
        recording ? "text-red-600 border-red-300 bg-red-50 animate-pulse" : "text-indigo-600 border-indigo-200 hover:bg-indigo-50"} disabled:opacity-40`}>
      {recording ? `⏹ Stop (${secs}s)` : "🎙 Voice note"}
    </button>
  );
}

// ── QR / barcode scanner (native BarcodeDetector — Chromium) ────────────────
type DetectedBarcode = { rawValue: string };
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
};

export function ScanButton({ disabled, onResult, onError }: {
  disabled?: boolean; onResult: (text: string) => void; onError: (msg: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [open, setOpen] = useState(false);
  const supported = typeof window !== "undefined" && "BarcodeDetector" in window;

  useEffect(() => () => { streamRef.current?.getTracks().forEach(tr => tr.stop()); }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const Detector = (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector;
    const detector = new Detector({ formats: ["qr_code", "code_128", "ean_13", "data_matrix"] });
    const timer = setInterval(async () => {
      const v = videoRef.current;
      if (!v || v.readyState < 2 || cancelled) return;
      try {
        const codes = await detector.detect(v);
        if (codes.length && !cancelled) {
          cancelled = true;
          clearInterval(timer);
          streamRef.current?.getTracks().forEach(tr => tr.stop());
          streamRef.current = null;
          setOpen(false);
          onResult(codes[0].rawValue);
        }
      } catch { /* frame not ready — keep polling */ }
    }, 400);
    return () => { cancelled = true; clearInterval(timer); };
  }, [open, onResult]);

  if (!supported) return null;

  async function openScanner() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      setOpen(true);
      requestAnimationFrame(() => {
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}); }
      });
    } catch {
      onError("Camera unavailable or permission denied");
    }
  }

  function close() {
    streamRef.current?.getTracks().forEach(tr => tr.stop());
    streamRef.current = null;
    setOpen(false);
  }

  return (
    <>
      <button type="button" disabled={disabled} onClick={openScanner}
        className="text-[11px] font-semibold text-indigo-600 border border-indigo-200 px-3 py-1.5 rounded-lg hover:bg-indigo-50 disabled:opacity-40 transition-colors">
        ⌗ Scan code
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={close}>
          <div className="bg-white rounded-xl p-4 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-semibold text-gray-900 mb-2">Scan QR / barcode</p>
            <video ref={videoRef} className="w-full rounded-lg bg-black aspect-video" muted playsInline />
            <p className="text-[10px] text-gray-400 mt-2">Point the camera at the code — it captures automatically.</p>
            <button onClick={close} className="mt-2 w-full text-xs font-semibold text-gray-600 border border-gray-200 rounded-lg py-2 hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}
