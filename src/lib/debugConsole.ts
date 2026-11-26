/** Use optional chaining so production builds also skip diagnostic arguments. */
export const debugConsole = import.meta.env?.DEV && import.meta.env.VITE_DEBUG_LOGS !== '0'
  ? console
  : undefined;
