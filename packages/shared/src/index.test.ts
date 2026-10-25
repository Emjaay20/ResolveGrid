import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assemblePostcode,
  disassemblePostcode,
  haversineMeters,
  latLngToHexCell,
} from './index';

test('assemblePostcode creates canonical NIPOST 5-segment postcode', () => {
  const res = assemblePostcode({
    state: 'ek',
    lga: '1',
    district: 'a03',
    area: 'fk',
    unit: '1',
  });
  assert.equal(res.valid, true);
  assert.equal(res.postcode, 'EK-01-A03-FK-01');
  assert.equal(res.display, 'EK 01 A03 FK 01');
  assert.equal(res.compact, 'EK01A03FK01');
  assert.equal(res.legacyPostalCode, '360101');
  assert.equal(res.stateName, 'EKITI');
});

test('disassemblePostcode parses compact, spaced, and hyphenated formats', () => {
  const p1 = disassemblePostcode('FC02A09DB09');
  const p2 = disassemblePostcode('FC 02 A09 DB 09');
  const p3 = disassemblePostcode('fc-02-a09-db-09');

  assert.equal(p1.valid, true);
  assert.equal(p1.postcode, 'FC-02-A09-DB-09');
  assert.equal(p2.postcode, 'FC-02-A09-DB-09');
  assert.equal(p3.postcode, 'FC-02-A09-DB-09');
  assert.equal(p1.legacyPostalCode, '900288');
});

test('haversineMeters and latLngToHexCell compute accurate spatial metrics', () => {
  const dist = haversineMeters(9.07874, 7.47018, 9.07421, 7.48462);
  assert.ok(dist > 1500 && dist < 1800);
  const hex = latLngToHexCell(9.07874, 7.47018, 8);
  assert.equal(hex.length, 15);
  assert.ok(hex.startsWith('8858'));
});
