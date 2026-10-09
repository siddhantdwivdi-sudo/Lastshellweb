// Drives the whole UI from mock data: title -> lobby -> scripted match. No sockets, no rules.
// In the networking phase this hook is replaced by one that talks to the server and returns
// the same shapes (RoomState + GameUiModel + action callbacks).

import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, type RoomState } from "@lastshell/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppController } from "../app/controller";
import type { ConnectionState, GameActions, GameUiModel } from "../ui/model";
import { mkRoom } from "./builders";
import { SCENARIOS, type Scenario } from "./gallery";
import { buildPlayScript } from "./playScript";

export type Screen = "title" | "lobby" | "game";

const noop = () => {};

const MOCK_DELAY = 650;

function randomCode(): string {
  let out = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) out += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  return out;
}

export interface MockApp extends AppController {
  screen: Screen;
  connection: ConnectionState;
  creating: boolean;
  joining: boolean;
  starting: boolean;
  lobby: RoomState;
  game: GameUiModel | null;
  gameActions: GameActions;
  notice: null;
  toast: null;
  lobbyOffline: false;
  /** Title screen */
  createRoom(): void;
  joinRoom(code: string): Promise<string | null>;
  retryConnection(): void;
  /** Lobby */
  startMatch(): void;
  leaveRoom(): void;
  /** Mock-only controls (the floating toolbar). */
  mock: {
    scenarios: Scenario[];
    activeScenario: string | null;
    setConnection(c: ConnectionState): void;
    setScreen(s: Screen): void;
    setPlayers(count: number): void;
    toggleAdmin(): void;
    disconnectSeat(): void;
    jumpTo(id: string): void;
    resumeScript(): void;
    frameLabel: string | null;
  };
}

/** Mock-only deep links, e.g. ?screen=game&scenario=your-turn&you=1  or  ?screen=lobby&players=2 */
function readParams() {
  const q = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const screen = q.get("screen");
  const you = Number(q.get("you") ?? 0);
  return {
    screen: (screen === "lobby" || screen === "game" ? screen : "title") as Screen,
    scenario: q.get("scenario"),
    you: you === 1 || you === 2 ? you : 0,
    players: Math.min(3, Math.max(1, Number(q.get("players") ?? 1))),
  };
}

export function useMockApp(): MockApp {
  const [initial] = useState(readParams);
  const [screen, setScreen] = useState<Screen>(initial.screen);
  const [connection, setConnection] = useState<ConnectionState>("ready");
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [starting, setStarting] = useState(false);

  const [code, setCode] = useState("K7M2Q");
  const [you, setYou] = useState(initial.you);
  const [admin, setAdmin] = useState(0);
  const [occupied, setOccupied] = useState<number[]>(() => Array.from(new Set([...[0, 1, 2].slice(0, initial.players), initial.you])).sort());
  const [disconnected, setDisconnected] = useState<number[]>([]);
  const [autoFill, setAutoFill] = useState(false);

  const [frameIndex, setFrameIndex] = useState(0);
  const [pending, setPending] = useState(false);
  const [scenarioId, setScenarioId] = useState<string | null>(initial.scenario);

  const timers = useRef<number[]>([]);
  const later = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timers.current.push(id);
    return id;
  }, []);
  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const lobby = useMemo(
    () =>
      mkRoom({
        code,
        you,
        admin,
        status: "LOBBY",
        occupied,
        disconnected: disconnected.filter((s) => occupied.includes(s)).map((seat) => ({ seat })),
      }),
    [code, you, admin, occupied, disconnected],
  );

  const gameRoom = useMemo(() => mkRoom({ code, you, admin, status: "IN_MATCH" }), [code, you, admin]);
  const script = useMemo(() => buildPlayScript(you, gameRoom), [you, gameRoom]);

  // --- lobby: other mock players trickle in so the lobby can be explored on its own
  useEffect(() => {
    if (screen !== "lobby" || !autoFill) return;
    const missing = [0, 1, 2].filter((s) => !occupied.includes(s));
    if (missing.length === 0) return;
    const id = window.setTimeout(() => setOccupied((o) => [...o, missing[0]].sort()), 1800);
    return () => window.clearTimeout(id);
  }, [screen, autoFill, occupied]);

  const startGame = useCallback(() => {
    clearTimers();
    setFrameIndex(0);
    setScenarioId(null);
    setPending(false);
    setStarting(false);
    setScreen("game");
  }, [clearTimers]);

  // --- lobby: when you are not the admin, the (mock) admin starts once the room is full
  useEffect(() => {
    if (screen !== "lobby" || you === admin || occupied.length < 3 || disconnected.length > 0) return;
    const id = window.setTimeout(startGame, 3500);
    return () => window.clearTimeout(id);
  }, [screen, you, admin, occupied, disconnected, startGame]);

  // --- game: the script advances by itself on "auto" frames
  const frame = script[Math.min(frameIndex, script.length - 1)];
  useEffect(() => {
    if (screen !== "game" || scenarioId || !frame.auto) return;
    const id = window.setTimeout(() => setFrameIndex((i) => Math.min(i + 1, script.length - 1)), frame.auto);
    return () => window.clearTimeout(id);
  }, [screen, scenarioId, frame, script.length]);

  const scenarioModel = useMemo<GameUiModel | null>(() => {
    const sc = SCENARIOS.find((s) => s.id === scenarioId);
    return sc ? sc.build(script, you) : null;
  }, [scenarioId, script, you]);

  const game: GameUiModel | null =
    screen !== "game" ? null : (scenarioModel ?? { ...frame.model, pending });

  // --- actions
  const advance = useCallback(() => {
    if (scenarioId || !frame.waits || pending) return;
    setPending(true);
    later(() => {
      setPending(false);
      setFrameIndex((i) => Math.min(i + 1, script.length - 1));
    }, 450);
  }, [scenarioId, frame.waits, pending, later, script.length]);

  const leaveRoom = useCallback(() => {
    clearTimers();
    setAutoFill(false);
    setScenarioId(null);
    setScreen("title");
  }, [clearTimers]);

  const gameActions = useMemo<GameActions>(
    () => ({
      shoot: () => advance(),
      useItem: () => advance(),
      playAgain: () => {
        setFrameIndex(0);
        setScenarioId(null);
      },
      leave: leaveRoom,
    }),
    [advance, leaveRoom],
  );

  // --- title screen
  const createRoom = useCallback(() => {
    if (connection !== "ready" || creating) return;
    setCreating(true);
    later(() => {
      setCreating(false);
      setCode(randomCode());
      setYou(0);
      setAdmin(0);
      setOccupied([0]);
      setDisconnected([]);
      setAutoFill(true);
      setScreen("lobby");
    }, MOCK_DELAY);
  }, [connection, creating, later]);

  const joinRoom = useCallback(
    (raw: string): Promise<string | null> => {
      const wanted = raw.trim().toUpperCase();
      setJoining(true);
      return new Promise((resolve) => {
        later(() => {
          setJoining(false);
          if (connection !== "ready") return resolve("Can't reach the server. Check your connection and try again.");
          if (wanted === "22222") return resolve("No room with that code.");
          if (wanted === "33333") return resolve("That room is full.");
          if (wanted === "44444") return resolve("That match has already started.");
          setCode(wanted);
          setYou(1);
          setAdmin(0);
          setOccupied([0, 1]);
          setDisconnected([]);
          setAutoFill(true);
          setScreen("lobby");
          resolve(null);
        }, MOCK_DELAY);
      });
    },
    [connection, later],
  );

  const retryConnection = useCallback(() => {
    setConnection("connecting");
    later(() => setConnection("ready"), 900);
  }, [later]);

  const startMatch = useCallback(() => {
    if (starting) return;
    setStarting(true);
    later(startGame, MOCK_DELAY);
  }, [starting, later, startGame]);

  // --- toolbar controls
  const mock: MockApp["mock"] = {
    scenarios: SCENARIOS,
    activeScenario: scenarioId,
    frameLabel: screen === "game" && !scenarioId ? frame.label : null,
    setConnection,
    setScreen: (s) => {
      clearTimers();
      setStarting(false);
      setCreating(false);
      if (s === "lobby") {
        setAutoFill(false);
        setOccupied((o) => (o.length ? o : [0]));
      }
      if (s === "game") {
        setFrameIndex(0);
        setScenarioId(null);
      }
      setScreen(s);
    },
    setPlayers: (count) => {
      setAutoFill(false);
      const seats = [0, 1, 2].slice(0, Math.max(1, Math.min(3, count)));
      const mine = seats.includes(you) ? seats : [...seats.slice(0, -1), you].sort();
      setOccupied(mine);
      if (!mine.includes(admin)) setAdmin(mine[0]);
    },
    toggleAdmin: () => {
      setAutoFill(false);
      if (you === admin) {
        setAdmin(you === 0 ? 1 : 0);
        setOccupied((o) => Array.from(new Set([...o, you === 0 ? 1 : 0])).sort());
      } else {
        setAdmin(you);
      }
    },
    disconnectSeat: () => {
      setAutoFill(false);
      const other = occupied.find((s) => s !== you);
      if (other === undefined) return;
      setDisconnected((d) => (d.includes(other) ? d.filter((s) => s !== other) : [...d, other]));
    },
    jumpTo: (id) => {
      clearTimers();
      setScreen("game");
      setScenarioId(id);
    },
    resumeScript: () => {
      setScenarioId(null);
      setFrameIndex(1);
    },
  };

  return {
    screen,
    notice: null,
    dismissNotice: noop,
    toast: null,
    dismissToast: noop,
    lobbyOffline: false,
    connection,
    creating,
    joining,
    starting,
    lobby,
    game,
    gameActions,
    createRoom,
    joinRoom,
    retryConnection,
    startMatch,
    leaveRoom,
    mock,
  };
}
