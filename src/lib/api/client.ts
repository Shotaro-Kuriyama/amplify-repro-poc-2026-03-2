import type { AmplifyAPI } from "./types";
import { mockApi } from "./mock";

/**
 * API client.
 *
 * Currently dispatches to mock implementations.
 * To connect a real backend, replace `mockApi` with an implementation
 * that calls actual endpoints defined in `./endpoints.ts`.
 */
export const api: AmplifyAPI = mockApi;
