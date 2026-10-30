import type { AudioAction, DesiredVoice } from "../performance/compiler";
export type EngineMessage =
  | { type: "load"; bank: ArrayBuffer }
  | {
      type: "snapshot";
      epoch: number;
      sequence: number;
      voices: DesiredVoice[];
      retrigger?: boolean;
    }
  | { type: "stop"; epoch: number }
  | {
      type: "sweep";
      epoch: number;
      sequence: number;
      frames: DesiredVoice[][];
      direction: number;
      retrigger?: boolean;
    }
  | { type: "heartbeat"; epoch: number }
  | {
      type: "play";
      epoch: number;
      actions: AudioAction[];
      duration: number;
      startAt: number;
      offset: number;
    }
  | { type: "volume"; volume: number };
export type EngineReply =
  | { type: "ready" }
  | { type: "error"; message: string }
  | {
      type: "stats";
      voices: number;
      active: number;
      rms: number;
      peak: number;
      time: number;
    }
  | { type: "ended" }
  | { type: "expired" };
