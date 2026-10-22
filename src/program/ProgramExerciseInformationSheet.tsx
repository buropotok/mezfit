import { useEffect, useState } from 'react';
import type { NavigationContext } from '../NavigationShell';
import type { ProgramExerciseInformation, ProgramManagementRepository } from '../data/cloud/program-management';
import type { CloudProgramExerciseSnapshot } from '../../shared/program-exercise-snapshot';
import { ExerciseDetail } from '../exercises/ExerciseCatalogContent';
import { ExerciseMedia } from '../ExerciseMedia';
import { Button, MezfitBottomSheet, Text } from '../ui';

export function ProgramExerciseInformationSheet({ repository, programId, dayId, exerciseId, snapshot, realmId, onClose, onNavigationContextChange }: {
  repository: ProgramManagementRepository;
  exerciseId: string;
  programId?: string; dayId?: string;
  snapshot?: CloudProgramExerciseSnapshot; realmId?: string;
  onClose: () => void;
  onNavigationContextChange?: (context: NavigationContext | null) => void;
}) {
  const [open, setOpen] = useState(true);
  const [data, setData] = useState<ProgramExerciseInformation | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    const request = snapshot && realmId
      ? repository.snapshotExerciseInformation(snapshot, realmId)
      : programId && dayId
        ? repository.exerciseInformation(programId, dayId, exerciseId)
        : Promise.reject(new Error('Не указан источник информации об упражнении'));
    void request.then(value => {
      if (active) setData(value);
    }).catch(() => { if (active) setError('Не удалось открыть информацию об упражнении.'); });
    return () => { active = false; };
  }, [repository, programId, dayId, exerciseId, snapshot, realmId]);
  useEffect(() => {
    if (!open) return;
    onNavigationContextChange?.({ title: 'Информация об упражнении', scrollKey: `exercise-info:${exerciseId}`, onBack: () => setOpen(false) });
    return () => onNavigationContextChange?.(null);
  }, [open, exerciseId, onNavigationContextChange]);
  return <MezfitBottomSheet opened={open} label="Информация об упражнении" onClosed={onClose} lazyMount>
    <section className="program-exercise-information">
      <div className="program-exercise-information__header">
        <Text variant="headline">Информация</Text>
        <Button onClick={() => setOpen(false)}>Закрыть</Button>
      </div>
      {error ? <Text variant="footnote" role="alert">{error}</Text>
        : !data ? <Text variant="body">Загружаем информацию…</Text>
          : data.row ? <ExerciseDetail row={data.row} taxonomy={data.taxonomy} mediaLayout="square"
            media={<ExerciseMedia exercise={{ id: exerciseId, name: data.name, reference_source: null, reference_key: null }} sourceUrl={data.mediaUrl} variant="detail" layout="square" />} />
            : <><Text variant="headline">{data.name}</Text>
              <ExerciseMedia exercise={{ id: exerciseId, name: data.name, reference_source: null, reference_key: null }} sourceUrl={data.mediaUrl} variant="detail" layout="square" />
              <Text variant="body">Подробное описание пока недоступно на этом устройстве.</Text></>}
    </section>
  </MezfitBottomSheet>;
}
