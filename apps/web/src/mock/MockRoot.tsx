import { AppView } from "../app/AppView";
import "../styles/mock.css";
import { MockToolbar } from "./MockToolbar";
import { useMockApp } from "./useMockApp";

/** Development-only: the whole UI driven by canned data, plus the MOCK tab. Never part of a production build. */
export default function MockRoot() {
  const app = useMockApp();
  return (
    <>
      <AppView c={app} />
      <MockToolbar app={app} />
    </>
  );
}
