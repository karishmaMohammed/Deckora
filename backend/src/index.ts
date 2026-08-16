import { assertApiKeyPresent } from "./config.ts";

assertApiKeyPresent();

await import("./http.ts");
