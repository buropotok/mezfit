export function beginMultiDraft(value: readonly string[]) {
  return [...value];
}

export function toggleMultiDraft(current: readonly string[], value: string) {
  return current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value];
}

export function commitMultiDraft(draft: readonly string[]) {
  return [...draft];
}
