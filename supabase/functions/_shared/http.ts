// These endpoints authenticate bearer tokens, not browser cookies. Every
// response (including errors) must be readable from the static gallery origin.
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
};

export function preflight(request: Request) {
  return request.method === 'OPTIONS' ? new Response(null, { status: 204, headers: cors }) : null;
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
