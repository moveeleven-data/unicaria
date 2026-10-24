import workletUrl from "./processor.ts?worker&url";
import type { DesiredVoice, Performance } from "../performance/compiler";
import type { EngineMessage, EngineReply } from "./protocol";
export type AudioState = "off" | "loading" | "ready" | "error";
export class AudioController {
  private master = 0.65;
  context?: AudioContext;
  private node?: AudioWorkletNode;
  private initializing?: Promise<void>;
  private opening?: AbortController;
  private generation = 0;
  private epoch = 0;
  private sequence = 0;
  private heart?: ReturnType<typeof setInterval>;
  state: AudioState = "off";
  message = "Click Enable sound";
  rms = 0;
  active = 0;
  peak = 0;
  playing = false;
  playStart = 0;
  onChange = () => {};
  onEnd = () => {};
  private send(m: EngineMessage, transfer: Transferable[] = []) {
    this.node?.port.postMessage(m, transfer);
  }
  async enable() {
    if (this.initializing) return this.initializing;
    if (this.state === "ready" && this.context?.state !== "closed") {
      try {
        await this.context!.resume();
        return;
      } catch (error) {
        this.fail(String(error));
        throw error;
      }
    }
    this.initializing = this.initialize().finally(() => {
      this.initializing = undefined;
    });
    return this.initializing;
  }
  private async initialize() {
    this.releaseResources();
    const generation = ++this.generation;
    const opening = new AbortController();
    this.opening = opening;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let cancelReady: (() => void) | undefined;
    const current = () => {
      if (opening.signal.aborted || generation !== this.generation)
        throw new DOMException("Audio startup cancelled.", "AbortError");
    };
    this.state = "loading";
    this.message = "Loading local instruments…";
    this.onChange();
    try {
      this.context = new AudioContext({ latencyHint: "interactive" });
      const context = this.context;
      await context.resume();
      current();
      await context.audioWorklet.addModule(workletUrl);
      current();
      const node = new AudioWorkletNode(context, "unicaria-synth", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      this.node = node;
      node.connect(context.destination);
      const ready = new Promise<void>((resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Instrument initialization timed out.")),
          30000,
        );
        cancelReady = () =>
          reject(new DOMException("Audio startup cancelled.", "AbortError"));
        opening.signal.addEventListener("abort", cancelReady, { once: true });
        node.onprocessorerror = () => {
          if (generation !== this.generation) return;
          const error = new Error(
            "The audio processor stopped unexpectedly. Enable sound to retry.",
          );
          reject(error);
          if (this.state === "ready") this.fail(error.message);
        };
        node.port.onmessage = (e) => {
          if (generation !== this.generation) return;
          const m = e.data as EngineReply;
          if (m.type === "ready") {
            clearTimeout(timeout);
            resolve();
          }
          if (m.type === "error") {
            clearTimeout(timeout);
            reject(new Error(m.message));
            if (this.state === "ready") this.fail(m.message);
          }
          if (m.type === "stats") {
            this.rms = m.rms;
            this.active = m.active;
            this.peak = m.peak;
            this.onChange();
          }
          if (m.type === "ended" || m.type === "expired") {
            this.playing = false;
            this.onEnd();
            if (m.type === "expired")
              this.message = "Audio paused after an interrupted input session.";
            this.onChange();
          }
        };
      });
      const load = async () => {
        const response = await fetch(
          new URL("GeneralUser-GS.sf2", document.baseURI),
          { signal: opening.signal },
        );
        if (!response.ok)
          throw new Error("The bundled soundbank could not be read.");
        const bank = await response.arrayBuffer();
        current();
        node.port.postMessage({ type: "load", bank }, [bank]);
      };
      // Observe both promises immediately: either failure cancels the other,
      // without leaving an unhandled readiness timeout after a failed fetch.
      await Promise.all([ready, load()]);
      current();
      this.send({ type: "volume", volume: this.master });
      this.state = "ready";
      this.message = "General MIDI · ready";
      this.heart = setInterval(
        () => this.send({ type: "heartbeat", epoch: this.epoch }),
        100,
      );
      context.onstatechange = () => {
        if (context.state !== "running" && this.state === "ready") {
          this.stop();
          this.message = "Audio suspended. Enable sound to resume.";
          this.onEnd();
          this.onChange();
        }
      };
    } catch (error) {
      opening.abort();
      if (generation === this.generation) this.fail(String(error));
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
      if (cancelReady) opening.signal.removeEventListener("abort", cancelReady);
      if (this.opening === opening) this.opening = undefined;
      this.onChange();
    }
  }
  audition(voices: DesiredVoice[], retrigger = false) {
    if (this.state !== "ready") return;
    if (this.playing) this.stop();
    this.send({
      type: "snapshot",
      epoch: this.epoch,
      sequence: ++this.sequence,
      voices,
      retrigger,
    });
  }
  stop() {
    this.epoch++;
    this.sequence = 0;
    this.playing = false;
    this.active = 0;
    this.send({ type: "stop", epoch: this.epoch });
    this.onChange();
  }
  play(performance: Performance, offset = 0) {
    if (this.state !== "ready" || !this.context) return;
    this.stop();
    this.playing = true;
    this.playStart = this.context.currentTime + 0.03 - offset;
    this.send({
      type: "play",
      epoch: this.epoch,
      actions: performance.actions,
      duration: performance.duration,
      startAt: this.context.currentTime + 0.03,
      offset,
    });
  }
  volume(volume: number) {
    if (!Number.isFinite(volume)) return;
    this.master = Math.max(0, Math.min(1, volume));
    this.send({ type: "volume", volume: this.master });
  }
  dispose() {
    this.stop();
    this.generation++;
    this.opening?.abort();
    this.opening = undefined;
    this.releaseResources();
    this.state = "off";
  }
  private fail(message: string) {
    this.stop();
    this.generation++;
    this.state = "error";
    this.message = message;
    this.releaseResources();
    this.onEnd();
    this.onChange();
  }
  private releaseResources() {
    if (this.heart) clearInterval(this.heart);
    this.heart = undefined;
    const context = this.context,
      node = this.node;
    this.node = undefined;
    this.context = undefined;
    if (node) {
      node.port.onmessage = null;
      node.onprocessorerror = null;
      node.disconnect();
    }
    if (context) {
      context.onstatechange = null;
      if (context.state !== "closed") void context.close().catch(() => {});
    }
  }
}
