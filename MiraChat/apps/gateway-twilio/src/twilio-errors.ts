export const isTwilioRestLike = (
  err: unknown,
): err is { message: string; code?: number; status?: number; moreInfo?: string } =>
  typeof err === 'object' &&
  err !== null &&
  'status' in err &&
  typeof (err as { status: unknown }).status === 'number' &&
  'code' in err
