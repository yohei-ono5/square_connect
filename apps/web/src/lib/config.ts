const configuredWorkerBaseUrl = import.meta.env.VITE_WORKER_BASE_URL?.trim();

const defaultWorkerBaseUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:8787";

export const WORKER_BASE_URL = (configuredWorkerBaseUrl || defaultWorkerBaseUrl).replace(/\/$/, "");
