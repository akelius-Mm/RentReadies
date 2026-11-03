// The name of the person using this phone, so records show who inspected or updated what.
const KEY = "rr-my-name";

export function myName(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function setMyName(name: string) {
  try {
    localStorage.setItem(KEY, name.trim());
  } catch {
    /* private mode */
  }
}
