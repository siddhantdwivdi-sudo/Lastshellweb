import type { KnownShell } from "@lastshell/shared";

interface Props {
  /** Shells already used this load. */
  fired: number;
  /** Shells still inside. */
  total: number;
  /** Only what the local player personally observed. */
  known: KnownShell[];
}

/** One slot per shell of this load: spent (faint), unknown (?), known LIVE / BLANK, or outdated. */
export function ShellRow({ fired, total, known }: Props) {
  const slots = fired + total;
  const hasStale = known.some((k) => k.stale);

  return (
    <div className="shells-wrap">
      <ol className="shells" aria-label="Shotgun magazine">
        {Array.from({ length: slots }, (_, i) => {
          const number = i + 1;
          if (i < fired) {
            return (
              <li key={i} className="shell shell--spent" aria-label={`Shell ${number}: used`}>
                <span className="shell__body" />
                <span className="shell__num">{number}</span>
              </li>
            );
          }
          const position = i - fired;
          const k = known.find((x) => x.position === position);
          const chamber = position === 0;
          let cls = "shell--unknown";
          let letter = "?";
          let label = "unknown";
          if (k && !k.stale) {
            cls = k.observedLive ? "shell--live" : "shell--blank";
            letter = k.observedLive ? "L" : "B";
            label = k.observedLive ? "known LIVE" : "known BLANK";
          } else if (k) {
            cls = "shell--stale";
            letter = k.observedLive ? "L?" : "B?";
            label = `outdated: you saw ${k.observedLive ? "LIVE" : "BLANK"} but an Inverter was used since`;
          }
          return (
            <li
              key={i}
              className={`shell ${cls}${chamber ? " shell--chamber" : ""}`}
              aria-label={`Shell ${number}${chamber ? " (chamber)" : ""}: ${label}`}
              title={k?.stale ? "Outdated: an Inverter was used after you looked." : undefined}
            >
              {chamber && <span className="shell__tag">CHAMBER</span>}
              <span className="shell__body">
                <span className="shell__mark">{letter}</span>
              </span>
              <span className="shell__num">{number}</span>
            </li>
          );
        })}
      </ol>
      {hasStale && <p className="shells__legend">Dashed = outdated information (an Inverter was used after you looked).</p>}
    </div>
  );
}
