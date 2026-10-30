// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { PlaybackControls } from "../src/ui/PlaybackControls";
import { MenuBar } from "../src/ui/MenuBar";
afterEach(cleanup);
const props = () => ({
  playing: false,
  paused: false,
  counter: "1 | 1 | 0000",
  elapsed: 0,
  tempo: 120,
  command: vi.fn(),
  seek: vi.fn(() => true),
  setTempo: vi.fn(),
  audioState: "off",
  master: 0.6,
  setMaster: vi.fn(),
  instruments: false,
  inspector: false,
});
describe("desktop chrome interactions", () => {
  it("Escape discards a counter edit without seeking or stopping the score", () => {
    const p = props();
    render(<PlaybackControls {...p} />);
    const input = screen.getByRole("textbox", { name: "Playback position" });
    input.focus();
    fireEvent.change(input, { target: { value: "7" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(p.seek).not.toHaveBeenCalled();
    expect(p.command).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe(p.counter);
  });
  it("Enter commits once, and merely focusing a counter does not seek", () => {
    const p = props();
    render(<PlaybackControls {...p} />);
    const input = screen.getByRole("textbox", { name: "Playback position" });
    input.focus();
    input.blur();
    expect(p.seek).not.toHaveBeenCalled();
    input.focus();
    fireEvent.change(input, { target: { value: "4 | 2 | 256" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(p.seek).toHaveBeenCalledExactlyOnceWith("4 | 2 | 256");
  });
  it("menu arrows skip disabled commands and Escape restores menu-button focus", async () => {
    render(<MenuBar command={vi.fn()} disabled={{ undo: true, redo: true }} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Edit" }), {
      key: "ArrowDown",
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("menuitem", { name: /^Cut/ }),
      ),
    );
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: /^Copy/ }),
    );
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Edit" }),
    );
  });
});
