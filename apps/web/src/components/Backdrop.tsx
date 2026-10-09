/** Dark room, lamp glow, wooden table and vignette (drawn with CSS only). */
export function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <div className="backdrop__lamp" />
      <div className="backdrop__table" />
      <div className="backdrop__steel" />
      <div className="backdrop__red" />
      <div className="backdrop__vignette" />
    </div>
  );
}
