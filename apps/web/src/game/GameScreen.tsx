import { ITEM_DEFS, PLAYER_COLORS, type ItemId, type KnownShell } from "@lastshell/shared";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Btn } from "../components/bits";
import { opponentsOf, seatName } from "../lib/layout";
import { useLayoutKind } from "../lib/hooks";
import type { GameActions, GameUiModel, ItemArgs } from "../ui/model";
import { ActionBar } from "./ActionBar";
import { ChoiceDialog, type ChoiceOption } from "./ChoiceDialog";
import { Inventory } from "./Inventory";
import { ItemSheet } from "./ItemSheet";
import { MenuOverlay, ReconnectOverlay, ReloadOverlay, WinnerOverlay } from "./Overlays";
import { PlayerPanel } from "./PlayerPanel";
import { ShellRow } from "./ShellRow";
import { SceneStage } from "../scene/SceneStage";

interface Props {
  model: GameUiModel;
  actions: GameActions;
  onRules(): void;
}

interface ChoiceSpec {
  title: string;
  options: ChoiceOption<number>[];
  onPick(value: number): void;
}

const DEFAULT_HINT = "Tap an item to read it · 1 / 2 / 3 shoot that player · 0 shoot yourself · Esc menu";

function describeKnown(k: KnownShell): string {
  const kind = k.observedLive ? "LIVE" : "BLANK";
  const where = k.position === 0 ? "CHAMBER" : `SHELL #${k.shellNumber}`;
  return k.stale ? `${where}: ${kind}? (OUTDATED)` : `${where}: ${kind}`;
}

export function GameScreen({ model, actions, onRules }: Props) {
  const layout = useLayoutKind();
  const { you, view, room } = model;
  const me = view.players[you];
  const { left, right } = opponentsOf(you);
  const over = view.phase === "GAME_OVER";
  const isAdmin = room.adminSeat === you;

  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [choice, setChoice] = useState<ChoiceSpec | null>(null);
  const [hoverSlot, setHoverSlot] = useState<number | null>(null);
  const [note, setNote] = useState<{ id: number; text: string } | null>(null);

  // What blocks the player from acting right now (shown as a hint instead of failing silently).
  let blocked: string | null = null;
  if (model.reconnecting) blocked = "Reconnecting…";
  else if (over) blocked = "The match is over.";
  else if (!me.alive) blocked = "You are eliminated. You can keep watching.";
  else if (model.pending) blocked = "Sending your move…";
  else if (model.busy) blocked = "Playing out the last action…";
  else if (view.current !== you) blocked = `Waiting for ${seatName(view.current)}…`;
  const canAct = blocked === null;

  const showNote = useCallback((text: string) => setNote({ id: Date.now(), text }), []);
  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => setNote(null), 2600);
    return () => window.clearTimeout(t);
  }, [note]);

  const anyDialog = menuOpen || selectedSlot !== null || choice !== null;
  const shoot = useCallback(
    (target: number) => {
      if (canAct) actions.shoot(target);
    },
    [canAct, actions],
  );

  // Keyboard: 1/2/3 shoot that player, 0 yourself, Esc opens the menu (same as the Godot game).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape") {
        if (!anyDialog && !over) setMenuOpen(true);
        return;
      }
      if (anyDialog || over || !canAct) return;
      if (e.key === "0") shoot(you);
      else if (e.key === "1" || e.key === "2" || e.key === "3") {
        const seat = Number(e.key) - 1;
        if (seat === you) showNote("Press 0 to shoot yourself.");
        else if (view.players[seat].alive) shoot(seat);
        else showNote(`${seatName(seat)} is already eliminated.`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [anyDialog, over, canAct, shoot, you, view.players, showNote]);

  // --- item use (with the extra choices some items need). The server decides what is legal.
  const opponentSeats = [left, right];
  const aliveOpponents = opponentSeats.filter((s) => view.players[s].alive);
  // Hints from the server about what is currently legal (null in mock mode). They only grey
  // things out; the server validates every action no matter what is sent.
  const legal = model.private.legal;
  const cuffDisabled = (s: number): Partial<ChoiceOption<number>> =>
    view.players[s].cuffed || (legal !== null && !legal.cuffTargets.includes(s))
      ? { disabled: true, sub: "can't be handcuffed" }
      : {};

  const pickPlayer = (title: string, seats: number[], onPick: (seat: number) => void, extra?: (seat: number) => Partial<ChoiceOption<number>>) =>
    setChoice({
      title,
      onPick,
      options: seats.map((s) => ({
        label: seatName(s),
        sub: `HP ${view.players[s].hp}`,
        value: s,
        color: PLAYER_COLORS[s],
        ...extra?.(s),
      })),
    });

  function useSelected(slot: number) {
    const item = me.items[slot];
    setSelectedSlot(null);
    if (!item) return;
    const send = (args?: ItemArgs) => actions.useItem(slot, args);

    if (item === "handcuffs") {
      pickPlayer(
        "CUFF WHICH OPPONENT?",
        aliveOpponents,
        (target) => {
          setChoice(null);
          send({ target });
        },
        cuffDisabled,
      );
    } else if (item === "adrenaline") {
      pickPlayer(
        "STEAL FROM WHOM?",
        aliveOpponents,
        (victim) => {
          const stealable = view.players[victim].items;
          setChoice({
            title: `STEAL WHICH ITEM FROM ${seatName(victim)}?`,
            onPick: (stealSlot) => {
              const stolen: ItemId = stealable[stealSlot];
              if (stolen === "handcuffs") {
                pickPlayer(
                  "CUFF WHICH OPPONENT?",
                  aliveOpponents,
                  (subTarget) => {
                    setChoice(null);
                    send({ target: victim, stealSlot, subTarget });
                  },
                  cuffDisabled,
                );
              } else {
                setChoice(null);
                send({ target: victim, stealSlot });
              }
            },
            options: stealable.map((it, i) => {
              const ok = legal ? legal.steal[victim]?.[i] === true : it !== "adrenaline";
              return {
                label: ITEM_DEFS[it].name,
                sub: ok ? undefined : "can't be stolen right now",
                value: i,
                color: ITEM_DEFS[it].color,
                disabled: !ok,
              };
            }),
          });
        },
        (s) => {
          const anyStealable = legal ? (legal.steal[s]?.some(Boolean) ?? false) : view.players[s].items.length > 0;
          return anyStealable
            ? { sub: `${view.players[s].items.length} items` }
            : { disabled: true, sub: view.players[s].items.length === 0 ? "no items" : "nothing stealable" };
        },
      );
    } else {
      send();
    }
  }

  // The scene is drawn behind the HUD; tell it how tall the HUD is so the table starts right above it.
  const gameRef = useRef<HTMLElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const hud = hudRef.current;
    const game = gameRef.current;
    if (!hud || !game) return;
    const apply = () => game.style.setProperty("--hud-h", `${hud.offsetHeight}px`);
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(apply);
    ro.observe(hud);
    return () => ro.disconnect();
  }, []);

  // --- derived presentation
  const known = model.private.knownShells;
  const intel = useMemo(() => known.map(describeKnown), [known]);
  const turnColor = PLAYER_COLORS[view.current];
  const shownMessage = note ? { id: note.id, text: note.text, bad: true } : model.message;
  const selectedItem = selectedSlot !== null ? me.items[selectedSlot] : undefined;
  const hoverItem = hoverSlot !== null ? me.items[hoverSlot] : undefined;

  return (
    <main className={`screen game game--scene game--${layout}`} ref={gameRef}>
      <SceneStage
        model={model}
        renderPlate={(seat) => (
          <PlayerPanel
            player={view.players[seat]}
            seatInfo={room.seats[seat]}
            isTurn={view.current === seat}
            isYou={false}
            showItems
            gameOver={over}
            compact
          />
        )}
      />
      {model.fx && (
        <div
          key={model.fx.id}
          className={`flash flash--${model.fx.kind}`}
          style={model.fx.color ? ({ "--flash": model.fx.color } as CSSProperties) : undefined}
          aria-hidden="true"
        />
      )}

      <header className="game__bar">
        <span className="chip-info">
          ROOM <strong>{room.code}</strong>
        </span>
        <span className="chip-info">LOAD {view.loadNumber}</span>
        <Btn variant="ghost" accent="var(--amber)" onClick={() => setMenuOpen(true)} className="game__menu" aria-keyshortcuts="Escape">
          MENU
        </Btn>
      </header>

      <section className="game__mid" aria-label="Table">
        <p className="turn" style={{ color: turnColor }} aria-live="polite">
          {over ? " " : view.current === you ? "YOUR TURN" : `${seatName(view.current)}'S TURN`}
        </p>
        {model.banner && (
          <div key={model.banner.id} className="banner" style={{ color: model.banner.color }} aria-hidden="true">
            {model.banner.text}
          </div>
        )}
      </section>

      <div className="game__hud" ref={hudRef}>
      <section className="game__tray" aria-label="Shotgun shells">
        <div className="counters" role="group" aria-label="Shells left">
          <span className="counter counter--live">LIVE: {view.magazine.live}</span>
          <span className="counter counter--blank">BLANK: {view.magazine.blank}</span>
          <span className="counter counter--total">SHELLS: {view.magazine.total}</span>
        </div>
        <ShellRow fired={view.fired} total={view.magazine.total} known={over ? [] : known} />
        <p className="intel" aria-live="polite">
          {intel.length > 0 && !over ? <>YOUR INTEL ONLY &gt; {intel.join("   |   ")}</> : " "}
        </p>
        <p key={shownMessage?.id} className={`message${shownMessage?.bad ? " is-bad" : ""}${shownMessage ? " has-text" : ""}`} aria-live="polite" role="status">
          {shownMessage?.text ?? " "}
        </p>
      </section>

      <section className="game__dock">
        <div className="dock__me">
          <PlayerPanel
            player={me}
            seatInfo={room.seats[you]}
            isTurn={view.current === you}
            isYou
            showItems={false}
            gameOver={over}
            compact
          />
          {me.sawed && <p className="effect">HAND SAW ACTIVE: next LIVE shot = 2 dmg</p>}
        </div>
        <div className="dock__controls">
          <Inventory player={me} onSelect={setSelectedSlot} onHover={setHoverSlot} selectedSlot={selectedSlot} spectating={!me.alive} />
          <ActionBar you={you} opponents={opponentSeats} players={view.players} canAct={canAct} pending={model.pending} onShoot={shoot} />
          <p className={`hint${blocked ? " is-blocked" : ""}`} aria-live="polite">
            {hoverItem ? `${ITEM_DEFS[hoverItem].name}: ${ITEM_DEFS[hoverItem].desc}` : (blocked ?? DEFAULT_HINT)}
          </p>
        </div>
      </section>

      </div>

      {model.reload && <ReloadOverlay reload={model.reload} />}
      {model.reconnecting && <ReconnectOverlay />}

      {selectedItem && selectedSlot !== null && (
        <ItemSheet
          item={selectedItem}
          blockedReason={canAct ? (legal?.itemBlocked[selectedSlot] ?? null) : blocked}
          onUse={() => useSelected(selectedSlot)}
          onClose={() => setSelectedSlot(null)}
        />
      )}
      {choice && <ChoiceDialog title={choice.title} options={choice.options} onPick={choice.onPick} onCancel={() => setChoice(null)} />}
      {menuOpen && (
        <MenuOverlay
          onResume={() => setMenuOpen(false)}
          onRules={() => {
            setMenuOpen(false);
            onRules();
          }}
          onLeave={() => {
            setMenuOpen(false);
            actions.leave();
          }}
        />
      )}
      {over && !model.busy && view.winner !== null && (
        <WinnerOverlay
          winner={view.winner}
          you={you}
          isAdmin={isAdmin}
          pending={model.pending}
          onPlayAgain={actions.playAgain}
          onMenu={actions.leave}
        />
      )}
    </main>
  );
}
