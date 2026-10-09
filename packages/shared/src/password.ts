/**
 * Password policy: at least 8 characters, including a number and a symbol.
 * Minimum length of 8 per Jomerson Nazaire's decision (2026-10-09); the number and
 * symbol rules follow mockup v0.4.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export interface PasswordCheck {
  id: 'length' | 'number' | 'symbol';
  label: string;
  ok: boolean;
}

export function checkPassword(password: string): PasswordCheck[] {
  return [
    {
      id: 'length',
      label: `${PASSWORD_MIN_LENGTH}+ characters`,
      ok: password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH,
    },
    { id: 'number', label: 'A number', ok: /\d/.test(password) },
    { id: 'symbol', label: 'A symbol', ok: /[^A-Za-z0-9\s]/.test(password) },
  ];
}

export function isPasswordValid(password: string): boolean {
  return checkPassword(password).every((c) => c.ok);
}

export const PASSWORD_POLICY_MESSAGE = `Use at least ${PASSWORD_MIN_LENGTH} characters, including a number and a symbol.`;
