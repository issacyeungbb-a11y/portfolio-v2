import { buildHealthResponse } from '../src/lib/api/mockFunctionResponses';

export default async function handler() {
  return Response.json(buildHealthResponse());
}
