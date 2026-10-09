import { ITEM_DEFS, ITEM_IDS } from "@lastshell/shared";
import { Btn } from "./bits";
import { Dialog } from "./Dialog";

// Text follows the Godot prototype's "How to play" screen, with the online-specific bits updated.
export function RulesDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="HOW TO PLAY" onClose={onClose} wide accent="var(--amber)">
      <div className="rules">
        <section>
          <h3>Goal</h3>
          <p>Be the last player alive. Everyone starts with 3 HP.</p>
        </section>
        <section>
          <h3>The shotgun</h3>
          <p>
            It is loaded with 4-8 shells, at least one LIVE and one BLANK. You always see how many of each are inside,
            but never the order.
          </p>
        </section>
        <section>
          <h3>Your turn</h3>
          <p>Use any items you like, then shoot someone:</p>
          <ul>
            <li>Shoot an opponent: your turn ends, live or blank.</li>
            <li>Shoot yourself with a BLANK: you keep your turn.</li>
            <li>Shoot yourself with a LIVE: you take damage and your turn ends.</li>
          </ul>
        </section>
        <section>
          <h3>Items</h3>
          <ul className="rules__items">
            {ITEM_IDS.map((id) => (
              <li key={id}>
                <strong style={{ color: ITEM_DEFS[id].color }}>{ITEM_DEFS[id].name}</strong> {ITEM_DEFS[id].desc}
              </li>
            ))}
          </ul>
          <p>
            What you learn from a Magnifying Glass or Burner Phone is private to you. If someone uses an Inverter
            after you looked at a shell, your information turns OUTDATED (shown with a dashed outline).
          </p>
        </section>
        <section>
          <h3>Reloads</h3>
          <p>
            When the shotgun is empty it is reloaded and everyone gets new items. Saw and handcuff effects are cleared.
          </p>
        </section>
        <section>
          <h3>Controls</h3>
          <p>
            Tap or click buttons. Tap an item to read what it does, then USE it. On a keyboard: 1 / 2 / 3 shoot that
            player, 0 shoots yourself, Esc opens the menu.
          </p>
        </section>
      </div>
      <Btn onClick={onClose} accent="var(--amber)" className="dialog__close">
        BACK
      </Btn>
    </Dialog>
  );
}
