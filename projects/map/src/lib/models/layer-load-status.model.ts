/** Viewer fetch status; this does not describe the age of the source data. */
export interface LayerLoadStatusModel {
  state: 'waiting' | 'loading' | 'success' | 'error';
  lastSuccessfulLoad?: number;
  lastFailure?: number;
  pendingRequests?: number;
  monitoringStartedAt?: number;
}
