import { handleProtox } from '../../../server/protox-handler.mjs';

export function onRequest(context) {
  return handleProtox(context.request, context.params.action);
}
