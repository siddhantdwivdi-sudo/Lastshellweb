import { ITEM_DEFS, MAX_SLOTS, type PublicPlayer } from "@lastshell/shared";
import type { CSSProperties } from "react";
import { ItemIcon } from "./ItemIcon";

interface Props {
  player: PublicPlayer;
  onSelect(slot: number): void;
  onHover(slot: number | null): void;
  selectedSlot: number | null;
  /** The local player is out of the game: nothing to show. */
  spectating: boolean;
}

/** The local player's 8 slots. Tapping an item opens its description (and the USE button). */
export function Inventory({ player, onSelect, onHover, selectedSlot, spectating }: Props) {
  return (
    <section className="inventory" aria-label="Your inventory">
      <h3 className="inventory__title">
        YOUR INVENTORY{" "}
        <span className="inventory__count">
          ({player.items.length}/{player.slots})
        </span>
      </h3>
      <ul className="slots">
        {Array.from({ length: MAX_SLOTS }, (_, i) => {
          const locked = i >= player.slots;
          const item = player.items[i];
          if (locked) {
            return (
              <li key={i}>
                <button type="button" className="slot slot--locked" disabled title="Unlocks on a later reload.">
                  <span className="slot__text">LOCKED</span>
                </button>
              </li>
            );
          }
          if (!item) {
            return (
              <li key={i}>
                <button type="button" className="slot slot--empty" disabled>
                  <span className="slot__text">{spectating ? "—" : "EMPTY"}</span>
                </button>
              </li>
            );
          }
          const def = ITEM_DEFS[item];
          return (
            <li key={i}>
              <button
                type="button"
                className={`slot slot--item${selectedSlot === i ? " is-selected" : ""}`}
                style={{ "--item": def.color } as CSSProperties}
                onClick={() => onSelect(i)}
                onMouseEnter={() => onHover(i)}
                onMouseLeave={() => onHover(null)}
                onFocus={() => onHover(i)}
                onBlur={() => onHover(null)}
                aria-label={`${def.name}. ${def.desc} Tap for details.`}
              >
                <ItemIcon item={item} />
                <span className="slot__text">{def.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
