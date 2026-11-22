import { Badge } from '../ui';

const statuses = {
  draft: { color: 'yellow', label: 'Черновик' },
  planned: { color: 'green', label: 'Запланировано' },
  missed: { color: 'gray', label: 'Пропущена' },
} as const;

export function WorkoutPlanStatusBadge({ status }: { status: keyof typeof statuses }) {
  const { color, label } = statuses[status];
  return <Badge color={color} textVariant="caption">{label}</Badge>;
}
