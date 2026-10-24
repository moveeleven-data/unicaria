// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioController } from "../src/audio/controller";

const contexts: FakeContext[] = [],
  nodes: FakeNode[] = [];
let autoReady = true;
class FakeContext {
  state = "suspended";
  currentTime = 0;
  destination = {};
  onstatechange: (() => void) | null = null;
  audioWorklet = { addModule: vi.fn(async () => {}) };
  resume = vi.fn(async () => {
    this.state = "running";
  });
  close = vi.fn(async () => {
    this.state = "closed";
  });
  constructor() {
    contexts.push(this);
  }
}
class FakeNode {
  onprocessorerror: (() => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
  port = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    postMessage: vi.fn((m: { type: string }) => {
      if (m.type === "load" && autoReady)
        Promise.resolve().then(() =>
          this.port.onmessage?.({ data: { type: "ready" } }),
        );
    }),
  };
  constructor() {
    nodes.push(this);
  }
}
let audio: AudioController;
const response = () => ({
  ok: true,
  arrayBuffer: async () => new ArrayBuffer(4),
});
beforeEach(() => {
  vi.useFakeTimers();
  contexts.length = 0;
  nodes.length = 0;
  autoReady = true;
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("AudioWorkletNode", FakeNode);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response()),
  );
  audio = new AudioController();
});
afterEach(() => {
  audio.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("audio startup and recovery", () => {
  it("shares concurrent startup and maintains just one heartbeat", async () => {
    await Promise.all([audio.enable(), audio.enable(), audio.enable()]);
    expect(contexts).toHaveLength(1);
    expect(nodes).toHaveLength(1);
    expect(audio.state).toBe("ready");
    expect(vi.getTimerCount()).toBe(1);
  });
  it("cleans up a missing bank without leaving a delayed rejection", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
    await expect(audio.enable()).rejects.toThrow("soundbank");
    expect(contexts[0].state).toBe("closed");
    expect(nodes[0].disconnect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(31000);
    expect(audio.state).toBe("error");
  });
  it("cancels startup during a bank fetch and never becomes ready afterward", async () => {
    let resolveFetch!: (r: Response) => void;
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const startup = audio.enable();
    const rejected = expect(startup).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    audio.dispose();
    resolveFetch(response() as Response);
    await rejected;
    expect(audio.state).toBe("off");
    expect(contexts[0].state).toBe("closed");
    expect(vi.getTimerCount()).toBe(0);
    expect(
      nodes[0].port.postMessage.mock.calls.some((c) => c[0].type === "load"),
    ).toBe(false);
  });
  it("times out an unresponsive processor, aborts loading, and retries", async () => {
    autoReady = false;
    const startup = audio.enable();
    const rejected = expect(startup).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(30001);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    expect(contexts[0].state).toBe("closed");
    autoReady = true;
    await audio.enable();
    expect(audio.state).toBe("ready");
    expect(contexts).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(1);
  });
  it("times out and aborts a stalled bank fetch", async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(fetch).mockImplementation((_url, options) => {
      signal = options?.signal as AbortSignal;
      return new Promise((_resolve, reject) =>
        signal!.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        ),
      );
    });
    const startup = audio.enable();
    const rejected = expect(startup).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(30001);
    await rejected;
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("retires a failed worklet and ignores its late messages after retry", async () => {
    await audio.enable();
    const late = nodes[0].port.onmessage!;
    late({ data: { type: "error", message: "Processor failed" } });
    expect(audio.state).toBe("error");
    expect(contexts[0].state).toBe("closed");
    expect(vi.getTimerCount()).toBe(0);
    await audio.enable();
    late({ data: { type: "error", message: "Old error" } });
    expect(audio.state).toBe("ready");
    expect(vi.getTimerCount()).toBe(1);
  });
  it("handles a processorerror event as a recoverable failure", async () => {
    await audio.enable();
    nodes[0].onprocessorerror!();
    expect(audio.state).toBe("error");
    expect(contexts[0].state).toBe("closed");
    await audio.enable();
    expect(audio.state).toBe("ready");
  });
  it("stops on suspension and resumes the same healthy context", async () => {
    await audio.enable();
    audio.playing = true;
    contexts[0].state = "suspended";
    contexts[0].onstatechange!();
    expect(audio.playing).toBe(false);
    await audio.enable();
    expect(contexts).toHaveLength(1);
    expect(contexts[0].state).toBe("running");
  });
  it("cleans up a context that rejects resume", async () => {
    await audio.enable();
    contexts[0].resume.mockRejectedValueOnce(new Error("Device unavailable"));
    await expect(audio.enable()).rejects.toThrow("Device unavailable");
    expect(audio.state).toBe("error");
    expect(contexts[0].state).toBe("closed");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("ignores NaN volume and clamps finite out-of-range values", async () => {
    await audio.enable();
    nodes[0].port.postMessage.mockClear();
    audio.volume(NaN);
    expect(nodes[0].port.postMessage).not.toHaveBeenCalled();
    audio.volume(2);
    expect(nodes[0].port.postMessage).toHaveBeenLastCalledWith(
      { type: "volume", volume: 1 },
      [],
    );
    audio.volume(-1);
    expect(nodes[0].port.postMessage).toHaveBeenLastCalledWith(
      { type: "volume", volume: 0 },
      [],
    );
  });
});
