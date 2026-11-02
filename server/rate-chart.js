function parseNumeric(value) {
  const text = String(value ?? '').replace(/[,%₹\s]/g, '').replaceAll(',', '')
  return text ? Number(text) : Number.NaN
}

function isRateChartHeader(row) {
  const values = row.map((item) => parseNumeric(item.text)).filter(Number.isFinite)
  return values.length >= 3
    && values.every((value) => value >= 5 && value <= 12)
    && new Set(values).size >= 3
}

function intervalBounds(values) {
  const sorted = [...new Set(values)].sort((a, b) => a - b)
  const differences = sorted.slice(1).map((value, index) => value - sorted[index]).filter((value) => value > 0)
  const fallback = differences.length ? Math.min(...differences) : 0.01
  return new Map(sorted.map((value, index) => [
    value,
    sorted[index + 1] ?? Number((value + fallback).toFixed(2)),
  ]))
}

export function parsePdfRateChartPages(pages) {
  const rows = []

  for (const page of pages) {
    const grouped = new Map()
    for (const item of page) {
      if (!item.text?.trim()) continue
      const y = Math.round(item.y)
      grouped.set(y, [...(grouped.get(y) || []), item])
    }

    const lines = [...grouped]
      .map(([y, items]) => ({ y, items: items.sort((a, b) => a.x - b.x) }))
      .sort((a, b) => b.y - a.y)
    const header = lines.find(({ items }) => isRateChartHeader(items))
    if (!header) continue

    const snfColumns = header.items
      .map((item) => ({ x: item.x, value: parseNumeric(item.text) }))
      .filter(({ value }) => Number.isFinite(value) && value >= 5 && value <= 12)
      .sort((a, b) => a.x - b.x)
    const fatRows = []

    for (const line of lines) {
      if (line.y >= header.y - 2) continue
      const cells = line.items.map((item) => ({ x: item.x, value: parseNumeric(item.text) }))
      const fatCell = cells.find((cell) => cell.x < snfColumns[0].x - 12
        && Number.isFinite(cell.value) && cell.value > 0 && cell.value <= 15)
      if (!fatCell) continue

      const rates = cells.filter((cell) => cell.x > fatCell.x + 5
        && Number.isFinite(cell.value) && cell.value > 0)
        .sort((a, b) => a.x - b.x)
      if (rates.length !== snfColumns.length) continue
      fatRows.push({ fat: fatCell.value, rates: rates.map((cell) => cell.value) })
    }

    if (!fatRows.length) continue
    const fatBounds = intervalBounds(fatRows.map((row) => row.fat))
    const snfBounds = intervalBounds(snfColumns.map((column) => column.value))
    for (const row of fatRows) {
      row.rates.forEach((rate, index) => {
        const snf = snfColumns[index].value
        const fatMax = fatBounds.get(row.fat)
        const snfMax = snfBounds.get(snf)
        if (fatMax > row.fat && snfMax > snf) {
          rows.push({
            fatMin: row.fat,
            fatMax,
            snfMin: snf,
            snfMax,
            ratePerLitre: rate,
          })
        }
      })
    }
  }

  if (!rows.length) {
    throw new Error('Could not recognize a Fat-by-SNF rate grid in this PDF. The chart may be scanned or use a different layout.')
  }
  return rows
}

export function extractPdfEffectiveDate(text) {
  for (const match of text.matchAll(/\b(\d{2})[./-](\d{2})[./-](\d{4})\b/g)) {
    const [, dayText, monthText, yearText] = match
    const day = Number(dayText)
    const month = Number(monthText)
    const year = Number(yearText)
    const date = new Date(Date.UTC(year, month - 1, day))
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      return `${yearText}-${monthText}-${dayText}`
    }
  }
  return null
}
