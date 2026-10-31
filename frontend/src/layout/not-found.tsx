import { Link } from "react-router";
import { texts } from "./texts.ts";

export function NotFound() {
  return (
    <>
      <h1>{texts.notFound}</h1>
      <Link to="/contas">{texts.backHome}</Link>
    </>
  );
}
