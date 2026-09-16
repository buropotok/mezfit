import '../api';

declare module '../api' {
  interface ProgramPhaseExerciseDetails {
    sets?: Array<{
      id: number;
      setNumber: number;
      reps: number | null;
      weightKg: number | null;
      durationSeconds: number | null;
      distanceMeters: number | null;
    }>;
  }
}
