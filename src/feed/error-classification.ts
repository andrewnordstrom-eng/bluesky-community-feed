export function isPayloadTooLargeError(error: Error): boolean {
  const fastifyError = error as Error & { statusCode?: number; code?: string | number };
  return fastifyError.statusCode === 413 || fastifyError.code === 'FST_ERR_CTP_BODY_TOO_LARGE';
}
