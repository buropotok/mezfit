/** Enable for the whole account lifecycle only after cloud Apply and ordinary-account ACL checks.
 * Once enabled on an account DB, keep v16 registered in subsequent releases. */
export const CLOUD_DISCUSSIONS_ENABLED = import.meta.env.VITE_CLOUD_DISCUSSIONS_ENABLED === 'true';
