/** Russian duration label shared by phase headings and the duration editor. */
export function weekLabel(weeks: number): string {
  const lastTwo = weeks % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return 'недель';
  if (weeks % 10 === 1) return 'неделя';
  if (weeks % 10 >= 2 && weeks % 10 <= 4) return 'недели';
  return 'недель';
}

export function programMutationMessage(reason: unknown): string {
  if (reason instanceof Error && reason.name === 'PermissionDeniedError') {
    return 'Изменение не сохранено: Mezfit облако отказало в доступе к данным программы.';
  }
  return reason instanceof Error ? reason.message : 'Изменение не сохранено';
}
