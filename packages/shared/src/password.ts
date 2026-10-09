/**
 * Password policy. FR-AUTH-02 requires at least 10 characters; mockup v0.4 shows
 * "12+ characters, a number, a symbol". We apply the stricter mockup rule, which
 * also satisfies FR-AUTH-02.
 */
export const PASSWORD_MIN_LENGTH = 12;
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
