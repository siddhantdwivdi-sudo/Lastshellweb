import { ITEM_DEFS, type ItemId } from "@lastshell/shared";

/** Small original line icons (24x24), tinted with the item's colour. */
export function ItemIcon({ item, size = 28 }: { item: ItemId; size?: number }) {
  const color = ITEM_DEFS[item].color;
  const common = { fill: "none", stroke: color, strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  let body;
  switch (item) {
    case "magnifier":
      body = (
        <>
          <circle cx="10" cy="10" r="6" {...common} />
          <path d="M14.5 14.5 L20 20" {...common} strokeWidth={2.6} />
          <path d="M7.5 8.5 Q9 6.8 11 7" {...common} strokeWidth={1.2} />
        </>
      );
      break;
    case "beer":
      body = (
        <>
          <path d="M6 8 H16 V19 a1 1 0 0 1 -1 1 H7 a1 1 0 0 1 -1 -1 Z" {...common} />
          <path d="M16 10 H19 a1.5 1.5 0 0 1 1.5 1.5 V14 a1.5 1.5 0 0 1 -1.5 1.5 H16" {...common} />
          <path d="M6 8 q1 -3 3 -2 q1.5 -2.5 4 -1 q2.5 -.5 3 3" {...common} />
        </>
      );
      break;
    case "saw":
      body = (
        <>
          <path d="M3 9 L5 6 L7 9 L9 6 L11 9 L13 6 L15 9 L17 6 L19 9" {...common} />
          <path d="M3 9 H19 V12 H3 Z" {...common} />
          <path d="M19 10.5 H22 M22 8 V13" {...common} />
        </>
      );
      break;
    case "cigarettes":
      body = (
        <>
          <rect x="3" y="12" width="14" height="4" rx="1" {...common} />
          <path d="M13 12 V16" {...common} />
          <path d="M17 12.5 Q19 11 18.5 9 Q18 7.5 19.5 6 M20 14 Q22 12.5 21.5 11" {...common} strokeWidth={1.2} />
        </>
      );
      break;
    case "handcuffs":
      body = (
        <>
          <circle cx="7" cy="14" r="4.5" {...common} />
          <circle cx="17" cy="14" r="4.5" {...common} />
          <path d="M10 8 Q12 5.5 14 8" {...common} />
          <path d="M11.5 14 H12.5" {...common} />
        </>
      );
      break;
    case "phone":
      body = (
        <>
          <rect x="7" y="3" width="10" height="18" rx="2" {...common} />
          <path d="M10.5 18 H13.5" {...common} />
          <path d="M9.5 6.5 H14.5 V14 H9.5 Z" {...common} strokeWidth={1.2} />
        </>
      );
      break;
    case "medicine":
      body = (
        <g transform="rotate(-40 12 12)">
          <rect x="3" y="8" width="18" height="8" rx="4" {...common} />
          <path d="M12 8 V16" {...common} />
          <path d="M6 11 H8" {...common} strokeWidth={1.2} />
        </g>
      );
      break;
    case "inverter":
      body = (
        <>
          <path d="M8 20 V5 M4.5 8.5 L8 5 L11.5 8.5" {...common} />
          <path d="M16 4 V19 M12.5 15.5 L16 19 L19.5 15.5" {...common} />
        </>
      );
      break;
    case "adrenaline":
      body = (
        <>
          <path d="M5 19 L10 14" {...common} strokeWidth={2.4} />
          <rect x="9" y="6" width="9" height="6" rx="1" transform="rotate(45 13.5 9)" {...common} />
          <path d="M17 4 L21 8 M15.5 5.5 L19.5 9.5" {...common} />
          <path d="M3 21 L5.5 18.5" {...common} />
        </>
      );
      break;
  }
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      {body}
    </svg>
  );
}
