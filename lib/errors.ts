export const DASHBOARD_ERROR_MESSAGE = "No se pudo cargar el resumen financiero.";

export function dashboardErrorMessage(_error: unknown): string {
  return DASHBOARD_ERROR_MESSAGE;
}
