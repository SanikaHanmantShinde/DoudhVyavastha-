import { z } from 'zod'

export const idSchema = z.string().uuid()
export const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).default(''),
})

export function parseBody(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Please check the entered information.',
        details: parsed.error.issues.map(({ path, message }) => ({
          field: path.join('.'),
          message,
        })),
      })
    }
    req.validated = parsed.data
    next()
  }
}
