import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "@lastshell/shared";
import { useState, type FormEvent } from "react";
import { Btn, Notice, Spinner } from "../components/bits";
import { Backdrop } from "../components/Backdrop";
import type { NoticeModel } from "../app/controller";
import type { ConnectionState } from "../ui/model";

interface Props {
  connection: ConnectionState;
  creating: boolean;
  joining: boolean;
  onCreate(): void;
  onJoin(code: string): Promise<string | null>;
  onRetry(): void;
  onHowTo(): void;
  /** Why you are back here (room expired, could not create a room...). */
  notice: NoticeModel | null;
  onDismissNotice(): void;
}

function sanitizeCode(raw: string): string {
  return [...raw.toUpperCase()].filter((c) => ROOM_CODE_ALPHABET.includes(c)).slice(0, ROOM_CODE_LENGTH).join("");
}

export function TitleScreen({ connection, creating, joining, onCreate, onJoin, onRetry, onHowTo, notice, onDismissNotice }: Props) {
  const [showJoin, setShowJoin] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const offline = connection !== "ready";
  const codeComplete = code.length === ROOM_CODE_LENGTH;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!codeComplete || joining) return;
    setError(null);
    const problem = await onJoin(code);
    if (problem) setError(problem);
  }

  return (
    <main className="screen title">
      <Backdrop />
      <div className="title__content">
        <h1 className="title__logo">LAST SHELL</h1>
        <p className="title__subtitle">A game of probability, nerve and bad decisions.</p>

        {notice && (
          <div className="title__notice">
            <Notice kind={notice.kind}>{notice.text}</Notice>
            <Btn variant="ghost" onClick={onDismissNotice} aria-label="Dismiss message">
              OK
            </Btn>
          </div>
        )}

        {connection === "connecting" && (
          <p className="title__status" role="status">
            <Spinner label="Connecting" /> Connecting to the server…
          </p>
        )}
        {connection === "error" && (
          <div className="title__status">
            <Notice kind="error">Can't reach the server.</Notice>
            <Btn variant="ghost" onClick={onRetry}>
              TRY AGAIN
            </Btn>
          </div>
        )}

        <div className="title__menu">
          <Btn size="lg" accent="var(--amber)" onClick={onCreate} loading={creating} disabled={offline || joining}>
            CREATE ROOM
          </Btn>

          {!showJoin ? (
            <Btn
              size="lg"
              accent="var(--amber)"
              onClick={() => setShowJoin(true)}
              disabled={offline || creating}
              aria-expanded={false}
            >
              JOIN ROOM
            </Btn>
          ) : (
            <form className="join" onSubmit={submit} noValidate>
              <label htmlFor="room-code" className="join__label">
                ROOM CODE
              </label>
              <div className="join__row">
                <input
                  id="room-code"
                  className="join__input"
                  value={code}
                  onChange={(e) => {
                    setCode(sanitizeCode(e.target.value));
                    setError(null);
                  }}
                  placeholder="•••••"
                  inputMode="text"
                  autoCapitalize="characters"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={ROOM_CODE_LENGTH}
                  aria-invalid={error ? true : undefined}
                  aria-describedby="join-help"
                  autoFocus
                />
                <Btn type="submit" accent="var(--amber)" loading={joining} disabled={!codeComplete || offline}>
                  JOIN
                </Btn>
              </div>
              <p id="join-help" className="join__help">
                {codeComplete ? "Ready to join." : `Enter the ${ROOM_CODE_LENGTH}-character code from your host.`}
              </p>
              {error && <Notice kind="error">{error}</Notice>}
              <Btn
                variant="ghost"
                onClick={() => {
                  setShowJoin(false);
                  setError(null);
                }}
              >
                CANCEL
              </Btn>
            </form>
          )}

          <Btn size="lg" variant="ghost" accent="var(--dim)" onClick={onHowTo}>
            HOW TO PLAY
          </Btn>
        </div>
      </div>
    </main>
  );
}
