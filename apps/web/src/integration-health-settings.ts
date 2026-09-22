export const DEFAULT_HEALTH_REFRESH_MINUTES = 10;
const STORAGE_KEY = "flowpilot.integrationHealthRefreshMinutes";
export const HEALTH_SETTINGS_CHANGED = "flowpilot:integration-health-settings";

export function getHealthRefreshMinutes() {
  if (typeof window === "undefined") return DEFAULT_HEALTH_REFRESH_MINUTES;
  const value = Number(window.localStorage.getItem(STORAGE_KEY));
  return Number.isInteger(value) && value >= 1 && value <= 60
    ? value
    : DEFAULT_HEALTH_REFRESH_MINUTES;
}

export function setHealthRefreshMinutes(minutes: number) {
  window.localStorage.setItem(STORAGE_KEY, String(minutes));
  window.dispatchEvent(new Event(HEALTH_SETTINGS_CHANGED));
}
