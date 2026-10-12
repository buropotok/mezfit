/** Build-time rollout gate. Enable only after cloud permissions are installed and verified. */
export const CLOUD_ASSIGNED_PROGRAMS_ENABLED = import.meta.env.VITE_CLOUD_ASSIGNED_PROGRAMS_ENABLED === 'true';
