import assert from 'node:assert/strict'
import test from 'node:test'
import { extractPdfEffectiveDate, parsePdfRateChartPages } from '../server/rate-chart.js'

test('parses a positioned PDF matrix even when its Fat label is garbled', () => {
  const page = [
    { x: 10, y: 780, text: 'f^TÀ' },
    { x: 45, y: 780, text: 'SNF' },
    { x: 100, y: 779, text: '8.5' },
    { x: 140, y: 779, text: '8.6' },
    { x: 180, y: 779, text: '8.7' },
    { x: 60, y: 760, text: '5.5' },
    { x: 95, y: 760, text: '45.40' },
    { x: 135, y: 760, text: '46.20' },
    { x: 175, y: 760, text: '47.00' },
    { x: 60, y: 750, text: '5.6' },
    { x: 95, y: 750, text: '45.50' },
    { x: 135, y: 750, text: '46.30' },
    { x: 175, y: 750, text: '47.10' },
  ]

  const rows = parsePdfRateChartPages([page, [{ x: 20, y: 700, text: 'quality notes' }]])
  assert.equal(rows.length, 6)
  assert.deepEqual(rows[0], {
    fatMin: 5.5,
    fatMax: 5.6,
    snfMin: 8.5,
    snfMax: 8.6,
    ratePerLitre: 45.4,
  })
  assert.deepEqual(rows.at(-1), {
    fatMin: 5.6,
    fatMax: 5.7,
    snfMin: 8.7,
    snfMax: 8.8,
    ratePerLitre: 47.1,
  })
})

test('parses the first rate when its PDF column starts left of the SNF header', () => {
  const page = [
    { x: 73, y: 699, text: '7.9' },
    { x: 123, y: 699, text: '8' },
    { x: 157, y: 699, text: '8.1' },
    { x: 41, y: 684, text: '3' },
    { x: 53, y: 684, text: '28.50' },
    { x: 95, y: 684, text: '29.50' },
    { x: 137, y: 684, text: '30.50' },
    { x: 41, y: 674, text: '3.1' },
    { x: 53, y: 674, text: '29.00' },
    { x: 95, y: 674, text: '30.00' },
    { x: 137, y: 674, text: '31.00' },
  ]

  const rows = parsePdfRateChartPages([page])
  assert.equal(rows.length, 6)
  assert.deepEqual(rows[0], {
    fatMin: 3,
    fatMax: 3.1,
    snfMin: 7.9,
    snfMax: 8,
    ratePerLitre: 28.5,
  })
})

test('extracts a valid effective date from PDF text', () => {
  assert.equal(extractPdfEffectiveDate('Rate chart id.01.03.2026 applies from'), '2026-03-01')
  assert.equal(extractPdfEffectiveDate('No date here'), null)
  assert.equal(extractPdfEffectiveDate('31.02.2026'), null)
})
