// Role labels now live in the i18n translation files (`roles.*`) — this
// helper just maps a role string to the right key, falling back to the raw
// role for any value that isn't one of the three known roles.
export function roleLabel(t: (key: string) => string, role: string): string {
  if (role === 'admin' || role === 'marketing' || role === 'manager') return t(`roles.${role}`);
  return role;
}
