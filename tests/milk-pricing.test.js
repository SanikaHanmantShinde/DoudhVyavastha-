import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateMilkAmounts } from '../server/milk-pricing.js'

test('milk amount uses three-decimal litres and half-up two-decimal currency rounding', () => {
  const result = calculateMilkAmounts('1.000', '6.217', '31.25')
  assert.equal(result.quantity.toFixed(3), '5.217')
  assert.equal(result.rate.toFixed(4), '31.2500')
  assert.equal(result.amount.toFixed(2), '163.03')
})

test('milk amount rejects quantities below one millilitre after rounding', () => {
  assert.throws(
    () => calculateMilkAmounts('2.000', '2.0004', '40'),
    { name: 'RangeError', message: 'The calculated quantity must be at least 0.001 litres.' },
  )
})

test('milk amount rejects values outside the supported numeric range', () => {
  assert.throws(
    () => calculateMilkAmounts(0, 999999999, 100000),
    { name: 'RangeError', message: 'The calculated amount is outside the supported money range.' },
  )
})
