// Push-to-talk speech recognition + speech output using the browser's speech services.
import { useCallback, useEffect, useRef, useState } from "react";

type Rec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
};

export function useVoice(onFinal: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<Rec | null>(null);
  const finalRef = useRef("");
  const cb = useRef(onFinal);
  cb.current = onFinal;

  useEffect(() => {
    const W = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) return;
    setSupported(true);
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      finalRef.current = text;
      setInterim(text);
    };
    rec.onerror = (e) => {
      if (e.error !== "aborted" && e.error !== "no-speech") setError(`Microphone: ${e.error}`);
    };
    rec.onend = () => {
      setListening(false);
      const t = finalRef.current.trim();
      finalRef.current = "";
      setInterim("");
      if (t) cb.current(t);
    };
    recRef.current = rec;
    return () => rec.stop();
  }, []);

  const start = useCallback(() => {
    if (!recRef.current || listening) return;
    window.speechSynthesis?.cancel();
    setError(null);
    try {
      recRef.current.start();
      setListening(true);
    } catch {
      /* already started */
    }
  }, [listening]);

  const stop = useCallback(() => recRef.current?.stop(), []);

  const speak = useCallback((text: string) => {
    if (!("speechSynthesis" in window) || !text) return;
    const clean = text.replace(/[*_#`>\[\]()]/g, "").slice(0, 1200);
    const u = new SpeechSynthesisUtterance(clean);
    const voices = speechSynthesis.getVoices();
    u.voice = voices.find((v) => /en-GB/i.test(v.lang) && /male|daniel|george/i.test(v.name)) ?? voices.find((v) => /en-GB/i.test(v.lang)) ?? null;
    u.rate = 1.02;
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }, []);

  const silence = useCallback(() => {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }, []);

  return { supported, listening, interim, speaking, error, start, stop, speak, silence };
}
