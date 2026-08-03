"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

// CPR-130 dictation. THE BROWSER DOES ALL OF IT. There is no transcription service in this product, no
// audio is uploaded by us, and no audio is stored anywhere. This component starts the browser's own
// SpeechRecognition, receives text, and hands it to whatever field asked for it. The practitioner then
// reads it and saves it like anything else they typed.
//
// THE DISCLOSURE IS NOT OPTIONAL, and it is the reason this component is larger than a button.
//
// In Chrome -- and in most browsers that implement this API -- speech recognition is NOT on-device. The
// audio is streamed to the browser vendor's speech service and transcribed there. Dictating a
// consultation therefore sends a recording of a clinician describing a patient to a third party that has
// no relationship with this practice and no obligation to it.
//
// That is a fact about the browser, not about Competen, and we cannot change it. What we can do is
// refuse to let a practitioner discover it afterwards. So the first use in a session shows the
// disclosure and requires an explicit acknowledgement, and the wording says what actually happens rather
// than the reassuring version of it.
//
// The acknowledgement is per session (component state), not stored. A permission that is remembered
// forever stops being a decision.

/* eslint-disable @typescript-eslint/no-explicit-any */

const speechCtor = () =>
  typeof window === "undefined" ? null : ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null);

// Support detection through useSyncExternalStore rather than an effect. The API lives on `window`, so it
// cannot be read during the server render; the server snapshot is "unknown" (renders nothing) and the
// client snapshot is the real answer. An effect that setState'd on mount would do the same job while
// triggering a cascading render, which is what react-hooks/set-state-in-effect exists to catch.
const NEVER_CHANGES = () => () => {};

export default function Dictation({ onText, label = "Dictate" }: {
  onText: (text: string) => void;
  label?: string;
}) {
  const support = useSyncExternalStore(
    NEVER_CHANGES,
    () => (speechCtor() ? "supported" : "unsupported"),
    () => "unknown",
  );
  const [acknowledged, setAcknowledged] = useState(false);
  const [showDisclosure, setShowDisclosure] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  // A page that navigates away mid-dictation must not leave the microphone open.
  useEffect(() => () => { try { recognitionRef.current?.stop(); } catch { /* already stopped */ } }, []);

  const start = () => {
    const Ctor = speechCtor();
    if (!Ctor) return;
    setError(null);

    const recognition = new Ctor();
    recognition.continuous = true;
    // INTERIM RESULTS ARE OFF. They rewrite themselves as the recogniser changes its mind, and text that
    // rewrites itself inside a clinical note is a way to end up saving a sentence nobody said.
    recognition.interimResults = false;
    recognition.lang = navigator.language || "en-GB";

    recognition.onresult = (event: any) => {
      let text = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) text += event.results[i][0].transcript;
      }
      if (text.trim()) onText(text.trim());
    };
    recognition.onerror = (event: any) => {
      setError(
        event.error === "not-allowed"
          ? "The browser refused access to the microphone."
          : event.error === "no-speech" ? "Nothing was heard."
            : `Dictation stopped: ${event.error}.`,
      );
      setListening(false);
    };
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  };

  const stop = () => {
    try { recognitionRef.current?.stop(); } catch { /* already stopped */ }
    setListening(false);
  };

  if (support === "unknown") return null;

  if (support === "unsupported") {
    return (
      <span className="text-[10px] text-gray-400" title="Speech recognition is not available in this browser.">
        Dictation unavailable in this browser
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {listening && (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-[var(--cmp-text-critical)]">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--cmp-color-critical)]" />
            listening
          </span>
        )}
        <button type="button"
          onClick={() => {
            if (listening) return stop();
            if (!acknowledged) return setShowDisclosure(true);
            start();
          }}
          className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
            listening
              ? "border border-[var(--cmp-color-critical)] text-[var(--cmp-text-critical)] hover:bg-[var(--cmp-surface-critical)]"
              : "border border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
          {listening ? "Stop" : label}
        </button>
      </div>

      {error && <p className="text-[10px] text-[var(--cmp-text-critical)]">{error}</p>}

      {showDisclosure && (
        <div className="w-72 rounded-lg border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-3 text-left">
          <p className="text-[11px] font-bold text-[var(--cmp-text-warning)]">Before you dictate</p>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-800">
            Dictation uses your browser&apos;s own speech recognition. In most browsers, including Chrome,
            that means the audio is sent to the browser vendor&apos;s service to be transcribed &mdash; not
            to Competen, and not to anywhere this practice controls.
          </p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-gray-800">
            Competen stores no audio. But a recording of you describing a patient does leave this device.
            Do not dictate anything you would not send to a third party.
          </p>
          <div className="mt-2 flex gap-1.5">
            <button type="button"
              onClick={() => { setAcknowledged(true); setShowDisclosure(false); start(); }}
              className="rounded-lg bg-[var(--cp-primary)] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[var(--cp-primary-deep)]">
              I understand, start
            </button>
            <button type="button" onClick={() => setShowDisclosure(false)}
              className="rounded-lg border border-gray-300 px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-white">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
