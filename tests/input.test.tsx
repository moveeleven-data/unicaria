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

const audio = vi.hoisted(() => ({
  instances: [] as any[],
  score: undefined as any,
}));
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
    sweep = vi.fn();
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
  renderScore: (_host: unknown, score: any) => (
    (audio.score = score),
    {
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
    }
  ),
}));

describe("familiar score editing gestures", () => {
  const down = (x = 200, y = 10, extra = {}) =>
    fireEvent.pointerDown(document.querySelector(".paper")!, {
      clientX: x,
      clientY: y,
      button: 0,
      ...extra,
    });
  const up = (x = 200, y = 10, extra = {}) =>
    fireEvent.pointerUp(document.querySelector(".paper")!, {
      clientX: x,
      clientY: y,
      button: 0,
      ...extra,
    });
  const click = (x = 200, y = 10, extra = {}) => {
    down(x, y, extra);
    up(x, y, extra);
  };
  const menu = (label: string) => {
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: new RegExp("^" + label) }),
    );
  };
  it("starts with a score-first workspace and no prominent audition prompt", () => {
    expect(screen.queryByRole("button", { name: "Audition" })).toBeNull();
    expect(screen.queryByText("Selected note")).toBeNull();
    expect(document.querySelector(".instruments")).toBeNull();
    expect(document.querySelector(".inspector")).toBeNull();
  });
  it("click selects a full measure in one staff", () => {
    click();
    expect(document.querySelectorAll(".region-highlight")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: /Measure 1 · 1 staff · 4 beats/ }),
    ).toBeTruthy();
  });
  it("shift-click extends a selection vertically", () => {
    click();
    click(300, 180, { shiftKey: true });
    expect(
      screen.getByRole("button", { name: /Measure 1 · 3 staves · 4 beats/ }),
    ).toBeTruthy();
  });
  it("double-click selects the full measure stack", () => {
    click();
    fireEvent.doubleClick(document.querySelector(".paper")!, {
      clientX: 200,
      clientY: 10,
    });
    expect(screen.getByRole("button", { name: /3 staves/ })).toBeTruthy();
  });
  it("Backspace clears music but retains measures and undo restores it", () => {
    const count = audio.score.notes.length;
    click();
    keyDown("Backspace");
    expect(audio.score.measures).toHaveLength(8);
    expect(audio.score.notes.length).toBeLessThan(count);
    keyDown("KeyZ", { ctrlKey: true });
    expect(audio.score.notes).toHaveLength(count);
  });
  it("Delete removes a stack and undo restores the measure and music", () => {
    const count = audio.score.notes.length;
    click();
    fireEvent.doubleClick(document.querySelector(".paper")!, {
      clientX: 200,
      clientY: 10,
    });
    keyDown("Delete");
    expect(audio.score.measures).toHaveLength(7);
    keyDown("KeyZ", { ctrlKey: true });
    expect(audio.score.measures).toHaveLength(8);
    expect(audio.score.notes).toHaveLength(count);
  });
  it("Select All covers the entire document", () => {
    keyDown("KeyA", { ctrlKey: true });
    expect(screen.getByRole("button", { name: /Measures 1–8/ })).toBeTruthy();
  });
  it("adds multiple measures through a focused dialog", () => {
    menu("Add measures");
    fireEvent.change(screen.getByLabelText("Number to add at the end"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(audio.score.measures).toHaveLength(11);
  });
  it("does not enter music when a command dialog is open", () => {
    const count = audio.score.notes.length;
    menu("Add measures");
    keyDown("KeyC", { key: "c" });
    keyDown("Delete");
    expect(audio.score.notes).toHaveLength(count);
  });
  it("uses 5 for quarter notes and 4 for eighth notes in Simple Entry", () => {
    keyDown("Digit5");
    expect(
      screen.getByRole("button", { name: "Duration 4" }).className,
    ).toContain("selected");
    keyDown("Digit4");
    expect(
      screen.getByRole("button", { name: "Duration 8" }).className,
    ).toContain("selected");
  });
  it("Speedy Entry chooses pitch before entering a duration", () => {
    fireEvent.click(screen.getByRole("button", { name: "♬ Speedy" }));
    click();
    const before = audio.score.notes.length;
    keyDown("ArrowUp");
    expect(audio.score.notes).toHaveLength(before);
    keyDown("Digit5");
    expect(document.querySelector(".speedy-frame")).toBeTruthy();
    expect(screen.getByText(/Entered/)).toBeTruthy();
  });
  it("Ctrl+E changes view without exporting MIDI", () => {
    keyDown("KeyE", { ctrlKey: true });
    expect(
      (
        screen.getByRole("combobox", {
          name: "Score view",
        }) as HTMLSelectElement
      ).value,
    ).toBe("scroll");
    keyDown("KeyE", { ctrlKey: true });
    expect(
      (
        screen.getByRole("combobox", {
          name: "Score view",
        }) as HTMLSelectElement
      ).value,
    ).toBe("page");
  });
  it("a fast pointer sweep forwards every crossed slice to the audio queue", async () => {
    await hold();
    point(800, 10);
    expect(engine().sweep).toHaveBeenCalled();
    const frames = engine().sweep.mock.calls.at(-1)[0];
    expect(frames.length).toBeGreaterThan(1);
    keyUp("Space");
    expect(engine().stop).toHaveBeenCalled();
  });
  it("can audition the same position again after Space is released", async () => {
    await hold();
    keyUp("Space");
    engine().audition.mockClear();
    await hold();
    expect(lastVoices()).toHaveLength(5);
  });
});

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
    point(1000, 10);
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
    fireEvent.click(screen.getByRole("button", { name: "Inspector" }));
    fireEvent.click(screen.getByRole("button", { name: "Latch audition" }));
    await waitFor(() => expect(engine().audition).toHaveBeenCalled());
    keyDown("Escape");
    expect(
      screen
        .getByRole("button", { name: "Latch audition" })
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
