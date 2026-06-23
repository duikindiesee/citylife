export const FIRST_PERSON_KEY_CODES = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ShiftLeft",
  "ShiftRight",
]);

export const RACE_KEY_CODES = FIRST_PERSON_KEY_CODES;

export function normalizeFirstPersonKeyCode(code: string): string {
  if (code.startsWith("Arrow")) return code.toLowerCase();
  if (code.startsWith("Key")) return code.slice(3).toLowerCase();
  return code;
}
