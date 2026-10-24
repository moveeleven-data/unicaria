// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { App } from "../src/ui/App";
import type { DesiredVoice } from "../src/performance/compiler";

const audio = vi.hoisted(() => ({ instances: [] as any[] }));
vi.mock("../src/audio/controller", () => ({
  AudioController: class {
    state = "off";
    playing = false;
    message = "";
    active = 0;
    rms = 0;
    peak = 0;
    onChange = () => {};
    onEnd = () => {};
    context = { currentTime: 0, sampleRate: 48000 };
    enable = vi.fn(async () => {
      this.state = "ready";
    });
    audition = vi.fn();
    stop = vi.fn();
    play = vi.fn();
    volume = vi.fn();
    dispose = vi.fn();
    constructor() {
      audio.instances.push(this);
    }
  },
}));
vi.mock("../src/files/documents", () => ({
  recoveryRead: async () => undefined,
  recoveryWrite: async () => {},
  openDocument: vi.fn(),
  saveDocument: vi.fn(),
  saveMidi: vi.fn(),
}));
vi.mock("../src/engraving/render", () => ({
  renderScore: (_host: unknown, score: any) => ({
    width: 1120,
    height: 800,
    notes: [],
    measures: [
      {
        measureId: score.measures[0].id,
        measureIndex: 0,
        start: 0,
        length: 4,
        x: 0,
        endX: 1000,
        top: 0,
        bottom: 400,
        anchors: [
          { x: 0, time: 0 },
          { x: 1000, time: 4 },
        ],
        staves: score.staves.map((s: any, i: number) => ({
          id: s.id,
          top: i * 100,
          bottom: (i + 1) * 100,
          lineBottom: i * 100 + 80,
          clef: s.clef,
        })),
      },
    ],
  }),
}));

beforeEach(async () => {
  audio.instances.length = 0;
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("PointerEvent", MouseEvent);
  await act(async () => {
    render(<App />);
  });
  audio.instances[0].stop.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const engine = () => audio.instances[0];
const point = (x = 35, y = 10) =>
  fireEvent.pointerMove(document.querySelector(".paper")!, {
    clientX: x,
    clientY: y,
  });
const keyDown = (code: string, extra = {}) =>
  fireEvent.keyDown(window, {
    code,
    key: code === "Space" ? " " : code,
    ...extra,
  });
const keyUp = (code: string, extra = {}) =>
  fireEvent.keyUp(window, { code, ...extra });
async function hold(extra = {}) {
  point();
  keyDown("Space", extra);
  await waitFor(() => expect(engine().audition).toHaveBeenCalled());
}
const lastVoices = (): DesiredVoice[] => engine().audition.mock.calls.at(-1)[0];

describe("Space audition input lifecycle", () => {
  it("cancels a pending Play request when Escape arrives during startup", async () => {
    let finish!: () => void;
    engine().enable.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Play score" }));
    keyDown("Escape");
    await act(async () => {
      finish();
    });
    expect(engine().play).not.toHaveBeenCalled();
  });
  it("keeps staff scope when one Shift is released while the other is held", async () => {
    await hold({ shiftKey: true });
    keyDown("ShiftRight");
    keyUp("ShiftLeft", { shiftKey: true });
    expect(lastVoices()).toHaveLength(1);
    keyUp("ShiftRight");
    expect(lastVoices()).toHaveLength(5);
  });
  it("does not stop Ctrl+Space while the other Control key remains held", async () => {
    await hold({ ctrlKey: true });
    engine().stop.mockClear();
    keyUp("ControlLeft", { ctrlKey: true });
    expect(engine().stop).not.toHaveBeenCalled();
    keyUp("ControlRight");
    expect(engine().stop).toHaveBeenCalled();
  });
  it("stops when the document becomes hidden", async () => {
    await hold();
    engine().stop.mockClear();
    const old = Object.getOwnPropertyDescriptor(document, "hidden");
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    fireEvent(document, new Event("visibilitychange"));
    if (old) Object.defineProperty(document, "hidden", old);
    else delete (document as any).hidden;
    expect(engine().stop).toHaveBeenCalled();
  });
  it("does not consume Space during IME composition", () => {
    point();
    keyDown("Space", { isComposing: true });
    expect(engine().enable).not.toHaveBeenCalled();
  });
  it("auditions the full vertical slice without starting the transport", async () => {
    await hold();
    expect(lastVoices()).toHaveLength(5);
    expect(engine().play).not.toHaveBeenCalled();
  });
  it("releases every owned voice when Space is released", async () => {
    await hold();
    engine().stop.mockClear();
    keyUp("Space");
    expect(engine().stop).toHaveBeenCalled();
  });
  it("ignores operating-system key repeat without reattacking", async () => {
    await hold();
    engine().audition.mockClear();
    engine().stop.mockClear();
    keyDown("Space", { repeat: true });
    expect(engine().audition).not.toHaveBeenCalled();
    expect(engine().stop).not.toHaveBeenCalled();
  });
  it("applies Shift immediately and restores all staves on release", async () => {
    await hold();
    keyDown("ShiftLeft");
    expect(lastVoices()).toHaveLength(1);
    keyUp("ShiftLeft");
    expect(lastVoices()).toHaveLength(5);
  });
  it("supports Ctrl+Space and stops when Ctrl is released first", async () => {
    await hold({ ctrlKey: true });
    engine().stop.mockClear();
    keyUp("ControlLeft");
    expect(engine().stop).toHaveBeenCalled();
  });
  it("clears sound outside the paper and restores it on reentry", async () => {
    await hold();
    fireEvent.pointerLeave(document.querySelector(".paper")!);
    expect(lastVoices()).toEqual([]);
    point();
    expect(lastVoices()).toHaveLength(5);
  });
  it("clears sound in page margins", async () => {
    await hold();
    point(600, 10);
    expect(lastVoices()).toEqual([]);
  });
  it("stops on lost window focus even when keyup never arrives", async () => {
    await hold();
    engine().stop.mockClear();
    fireEvent.blur(window);
    expect(engine().stop).toHaveBeenCalled();
    engine().audition.mockClear();
    point();
    expect(engine().audition).not.toHaveBeenCalled();
  });
  it("stops when focus moves to an editable field", async () => {
    await hold();
    engine().stop.mockClear();
    fireEvent.focusIn(screen.getByRole("spinbutton"));
    expect(engine().stop).toHaveBeenCalled();
  });
  it("does not consume Space typed into a text field", async () => {
    const input = screen.getByRole("spinbutton");
    fireEvent.keyDown(input, { key: " ", code: "Space" });
    expect(engine().enable).not.toHaveBeenCalled();
    expect(engine().audition).not.toHaveBeenCalled();
  });
  it("does not enter or delete music during an audition gesture", async () => {
    await hold();
    keyDown("KeyC", { key: "c" });
    keyDown("Delete");
    expect(screen.queryByText("Selected note")).toBeNull();
    expect(screen.queryByText(/Entered C/)).toBeNull();
  });
  it("Escape clears latched audition", async () => {
    point();
    fireEvent.click(screen.getByRole("button", { name: "Audition" }));
    await waitFor(() => expect(engine().audition).toHaveBeenCalled());
    keyDown("Escape");
    expect(
      screen
        .getByRole("button", { name: "Audition" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });
  it("R explicitly reattacks the current chord", async () => {
    await hold();
    keyDown("KeyR", { key: "r" });
    expect(engine().audition.mock.calls.at(-1)[1]).toBe(true);
  });
  it("an asynchronous audio startup cannot resurrect released notes", async () => {
    let finish!: () => void;
    engine().enable.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    point();
    keyDown("Space");
    keyUp("Space");
    await act(async () => {
      finish();
    });
    expect(engine().audition).not.toHaveBeenCalled();
  });
});
