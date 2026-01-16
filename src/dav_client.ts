import { DAVClient } from "tsdav";

export const ical_client = new DAVClient(
  {
    serverUrl: new URL("/api/ical", window.location.origin).toString(),
    authMethod: "Basic",
    credentials: {
      username: import.meta.env.VITE_CALDAV_USERNAME,
      password: import.meta.env.VITE_CALDAV_PASSWORD
    }
  }
);