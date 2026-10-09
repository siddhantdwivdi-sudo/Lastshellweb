import { Btn } from "../components/bits";
import { Dialog } from "../components/Dialog";

export interface ChoiceOption<T> {
  label: string;
  sub?: string;
  value: T;
  disabled?: boolean;
  color?: string;
}

interface Props<T> {
  title: string;
  options: ChoiceOption<T>[];
  onPick(value: T): void;
  onCancel(): void;
}

/** Pick one of a few options (handcuff target, who to steal from, which item...). */
export function ChoiceDialog<T>({ title, options, onPick, onCancel }: Props<T>) {
  const usable = options.some((o) => !o.disabled);
  return (
    <Dialog title={title} onClose={onCancel} accent="var(--amber)">
      <div className="choices">
        {options.length === 0 && <p className="choices__empty">Nothing to choose from.</p>}
        {options.map((o, i) => (
          <Btn key={i} size="lg" accent={o.color} disabled={o.disabled} onClick={() => onPick(o.value)} className="choices__btn">
            {o.label}
            {o.sub && <small>{o.sub}</small>}
          </Btn>
        ))}
        {options.length > 0 && !usable && <p className="choices__empty">None of these can be chosen right now.</p>}
      </div>
      <Btn variant="ghost" accent="var(--dim)" onClick={onCancel} className="dialog__close">
        CANCEL
      </Btn>
    </Dialog>
  );
}
