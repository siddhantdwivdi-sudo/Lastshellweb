import { ITEM_DEFS, type ItemId } from "@lastshell/shared";
import { Btn } from "../components/bits";
import { Dialog } from "../components/Dialog";
import { ItemIcon } from "./ItemIcon";

interface Props {
  item: ItemId;
  /** null = can use now; otherwise the reason it can't (shown under the button). */
  blockedReason: string | null;
  onUse(): void;
  onClose(): void;
}

/** Bottom sheet on phones, small card on desktop: what the item does, then USE or CANCEL. */
export function ItemSheet({ item, blockedReason, onUse, onClose }: Props) {
  const def = ITEM_DEFS[item];
  return (
    <Dialog title={def.name} onClose={onClose} variant="sheet" accent={def.color} hideTitle>
      <div className="sheet">
        <div className="sheet__icon" aria-hidden="true">
          <ItemIcon item={item} size={44} />
        </div>
        <h3 className="sheet__name" style={{ color: def.color }}>
          {def.name}
        </h3>
        <p className="sheet__desc">{def.desc}</p>
        <div className="sheet__actions">
          <Btn size="lg" accent={def.color} onClick={onUse} disabled={blockedReason !== null}>
            USE ITEM
          </Btn>
          <Btn variant="ghost" accent="var(--dim)" onClick={onClose}>
            CANCEL
          </Btn>
        </div>
        {blockedReason && (
          <p className="sheet__why" role="status">
            {blockedReason}
          </p>
        )}
      </div>
    </Dialog>
  );
}
