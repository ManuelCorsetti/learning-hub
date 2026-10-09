import { useCallback, useEffect, useRef } from 'react'
import type { AttemptResult } from '../../../../shared/api'
import type { Confidence, StudySessionKind } from '../../../../shared/domain'
import { api } from '../../api'

/**
 * A study session started on the first answer and completed when the page closes.
 * Returns a function that records an attempt for one review item.
 */
export function useStudySession(kind: StudySessionKind, lessonVersionId: string | null) {
  const session = useRef<Promise<string> | null>(null)

  useEffect(() => {
    session.current = null
    return () => {
      const started = session.current
      session.current = null
      started?.then((id) => api.post(`/sessions/${id}/complete`)).catch(() => {})
    }
  }, [kind, lessonVersionId])

  return useCallback(
    async (reviewItemId: string, answer: unknown, confidence: Confidence | null): Promise<AttemptResult> => {
      session.current ??= api
        .post<{ id: string }>('/sessions', { kind, lesson_version_id: lessonVersionId })
        .then((s) => s.id)
      let id: string
      try {
        id = await session.current
      } catch (err) {
        session.current = null
        throw err
      }
      return api.post<AttemptResult>('/attempts', { session_id: id, review_item_id: reviewItemId, answer, confidence })
    },
    [kind, lessonVersionId],
  )
}
