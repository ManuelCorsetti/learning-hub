import { createHash } from 'node:crypto'
import { v7 as uuidv7 } from 'uuid'

export const newId = (): string => uuidv7()

export const nowIso = (): string => new Date().toISOString()

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

/** An error that is safe to show to the user, with the HTTP status to use. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 502 | 503 = 400,
  ) {
    super(message)
  }
}

export const notFound = (what: string): AppError => new AppError(`${what} not found`, 404)
export const conflict = (message: string): AppError => new AppError(message, 409)

/** Turns empty strings into null so optional text fields are stored consistently. */
export const clean = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}
