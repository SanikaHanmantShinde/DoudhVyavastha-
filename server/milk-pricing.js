import Decimal from 'decimal.js'

export function calculateMilkAmounts(startReading, endReading, ratePerLitre) {
  const quantity = new Decimal(endReading)
    .minus(startReading)
    .toDecimalPlaces(3, Decimal.ROUND_HALF_UP)
  if (!quantity.greaterThan(0)) {
    throw new RangeError('The calculated quantity must be at least 0.001 litres.')
  }
  const rate = new Decimal(ratePerLitre)
  const amount = quantity.mul(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
  if (amount.greaterThan('999999999999.99')) {
    throw new RangeError('The calculated amount is outside the supported money range.')
  }
  return { quantity, rate, amount }
}
