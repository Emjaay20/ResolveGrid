import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

test('strict postcode lookup requires upstream geometry, service authentication and a credential-specific cache', async (t) => {
  const upstream = createServer((request, response) => {
    const key = request.headers['x-api-key'];
    const url = new URL(request.url || '/', 'http://localhost');
    const code = url.searchParams.get('code');
    if (!['nipost_test_strict', 'nipost_live_strict', 'nipost_test_no_geometry', 'nipost_test_wrong_code'].includes(String(key))) {
      response.writeHead(403).end();
      return;
    }
    response.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/v1/search/reverse') {
      assert.equal(url.searchParams.get('max_distance_m'), '50');
      response.end(JSON.stringify({ data: {
        found: true,
        unit: {
          postcode: url.searchParams.get('lat') === '9.07874' ? 'FC-02-A09-DB-09' : 'FC-02-A09-DB-14',
          distance_m: 8,
        },
      } }));
      return;
    }
    response.end(JSON.stringify({
      data: {
        postcode: key === 'nipost_test_wrong_code' ? 'FC-02-A09-DB-14' : code,
        valid: true,
        ...(key !== 'nipost_test_no_geometry' && { geometry: { coordinates: [7.47018, 9.07874] } }),
      },
    }));
  }).listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  t.after(() => upstream.close());

  process.env.NIPOST_BASE_URL = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  process.env.NIPOST_API_KEY = 'nipost_test_strict';
  process.env.RESOLVEGRID_SERVICE_TOKEN = 'local-strict-test-token';

  const { app } = await import('./index');
  const service = app.listen(0, '127.0.0.1');
  await once(service, 'listening');
  t.after(() => service.close());
  const url = `http://127.0.0.1:${(service.address() as AddressInfo).port}/v1/nipost/lookup?code=FC02A09DB09&strict=1`;
  const trusted = { 'X-ResolveGrid-Service-Token': 'local-strict-test-token' };

  assert.equal((await fetch(url)).status, 401);
  const staging = await fetch(url, { headers: trusted });
  assert.equal(staging.status, 200);
  const result = await staging.json();
  assert.equal(result.upstream_geometry_verified, true);
  assert.equal(result.data.source, 'NIPOST_API_SANDBOX');
  assert.equal(result.data.coordinates.latitude, 9.07874);

  const live = await fetch(url, { headers: { ...trusted, 'X-Nipost-Key': 'nipost_live_strict' } });
  assert.equal((await live.json()).data.source, 'NIPOST_API_LIVE');
  const matching = await fetch(url + '&lat=9.07874&lng=7.47018', { headers: trusted });
  const matched = await matching.json();
  assert.equal(matching.status, 200);
  assert.equal(matched.upstream_postcode_verified, true);
  assert.equal(matched.upstream_geometry_verified, false);
  assert.equal(matched.coordinate_origin, 'RESIDENT_DEVICE_REVERSE_MATCH');
  assert.equal((await fetch(url + '&lat=9.08&lng=7.47018', { headers: trusted })).status, 404);
  assert.equal((await fetch(url + '&lat=91&lng=7.47018', { headers: trusted })).status, 400);

  for (const key of ['nipost_test_no_geometry', 'nipost_test_wrong_code', 'nipost_test_invalid']) {
    const denied = await fetch(url, { headers: { ...trusted, 'X-Nipost-Key': key } });
    assert.equal(denied.status, 404, key);
  }
});
