import { useQuery } from "@tanstack/react-query";
import { useApi } from "../api/api-context.tsx";
import { callApi } from "../api/call-api.ts";
import { texts } from "./texts.ts";

/** Whether the UI reaches the API: GET /api/health. */
export function ApiStatus() {
  const api = useApi();
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => callApi(api.api.health.$get()),
  });

  if (health.isPending) {
    return <p role="status">{texts.checking}</p>;
  }
  if (health.isError) {
    return <p role="alert">{texts.unreachable}</p>;
  }
  return <p role="status">{texts.connected}</p>;
}
