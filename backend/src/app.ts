import { Hono, type Context } from 'hono'
import { z } from 'zod'
import {
  AcceptManyInput,
  AttemptInput,
  CaptureInput,
  CreateAreaInput,
  CreateGoalInput,
  CreateLinkInput,
  CreateResourceInput,
  CreateTopicInput,
  LessonMessageInput,
  LessonRequestReplyInput,
  LinkGoalInput,
  MergeTopicInput,
  SetStatusInput,
  StartLessonRequestInput,
  StartSessionInput,
  UpdateAreaInput,
  UpdateSettingsInput,
  UpdateGoalInput,
  UpdateTopicInput,
} from '../../shared/api'
import { aiConfigured } from './ai/client'
import { runCapture } from './ai/capture'
import { sendLessonMessage } from './ai/lessonEditor'
import { planLessonTurn } from './ai/lessonPlanner'
import { buildFromRequest, generateLesson, generateQuestions } from './ai/lessons'
import { explainNextUp } from './ai/nextUpWhy'
import { optimiseSignals, runOptimise } from './ai/optimise'
import { generatePlacement } from './ai/placement'
import { runOrganise } from './ai/organise'
import type { Db } from './db/connection'
import { AppError } from './lib'
import { archiveArea, createArea, updateArea } from './services/areas'
import { USER } from './services/events'
import { addResource, archiveResource, createGoal, linkGoal, listGoals, unlinkGoal, updateGoal } from './services/goals'
import { createLessonRequest, getLessonRequest } from './services/lessonRequests'
import { getLessonView, requireLesson, restoreVersion } from './services/lessons'
import { listMessages } from './services/coauthor'
import { createLink, removeLink } from './services/links'
import { getAreaDetail, getAreaGraph, getHome } from './services/map'
import { rankNextUp } from './services/nextUp'
import { completeSession, practiceQueue, recordAttempt, startSession } from './services/practice'
import { getAiRun, listAiRuns } from './services/aiRuns'
import { fitSchedulerParams, resetSchedulerParams, schedulerView } from './services/schedulerFit'
import { getSettings, updateSettings } from './services/settings'
import {
  acceptMany,
  acceptProposal,
  acceptRun,
  listPendingGroups,
  listRecentDecisions,
  rejectProposal,
} from './services/proposals'
import {
  archiveTopic,
  createTopic,
  getTopicDetail,
  listTopics,
  mergeTopics,
  restoreTopic,
  setStatus,
  updateTopic,
} from './services/topics'

async function body<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  let json: unknown
  try {
    json = await c.req.json()
  } catch {
    json = {}
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success) throw new AppError(z.prettifyError(parsed.error), 400)
  return parsed.data
}

export function createApp(db: Db, options: { aiAvailable?: () => boolean } = {}) {
  const aiAvailable = options.aiAvailable ?? aiConfigured
  const app = new Hono().basePath('/api')

  app.onError((err, c) => {
    if (err instanceof AppError) return c.json({ error: err.message }, err.status)
    console.error(err)
    return c.json({ error: 'Something went wrong. Check the server log.' }, 500)
  })

  app.get('/health', (c) => c.json({ ok: true }))
  app.get('/home', (c) => c.json(getHome(db, aiAvailable())))
  app.get('/settings', (c) => c.json(getSettings(db)))
  app.get('/ai-runs', (c) => c.json(listAiRuns(db)))
  app.get('/ai-runs/:id', (c) => c.json(getAiRun(db, c.req.param('id'))))
  app.get('/scheduler', (c) => c.json(schedulerView(db)))
  app.post('/scheduler/fit', (c) => c.json(fitSchedulerParams(db)))
  app.post('/scheduler/reset', (c) => c.json(resetSchedulerParams(db)))
  app.patch('/settings', async (c) => c.json(updateSettings(db, await body(c, UpdateSettingsInput))))

  // Next up
  app.get('/next-up', (c) => c.json(rankNextUp(db)))
  app.post('/next-up/explain', async (c) => {
    if (!aiAvailable()) return c.json({ explained: 0 })
    return c.json({ explained: await explainNextUp(db) })
  })

  // Areas
  app.post('/areas', async (c) => c.json(createArea(db, await body(c, CreateAreaInput)), 201))
  app.patch('/areas/:id', async (c) => c.json(updateArea(db, c.req.param('id'), await body(c, UpdateAreaInput))))
  app.post('/areas/:id/archive', (c) => {
    archiveArea(db, c.req.param('id'))
    return c.json({ ok: true })
  })
  app.get('/areas/:id', (c) => c.json(getAreaDetail(db, c.req.param('id'))))
  app.get('/areas/:id/graph', (c) => c.json(getAreaGraph(db, c.req.param('id'))))

  // Topics
  app.get('/topics', (c) => c.json(listTopics(db)))
  app.post('/topics', async (c) => {
    const topic = createTopic(db, USER, await body(c, CreateTopicInput))
    return c.json(getTopicDetail(db, topic.id), 201)
  })
  app.get('/topics/:id', (c) => c.json(getTopicDetail(db, c.req.param('id'))))
  app.patch('/topics/:id', async (c) => {
    const id = c.req.param('id')
    updateTopic(db, USER, id, await body(c, UpdateTopicInput))
    return c.json(getTopicDetail(db, id))
  })
  app.post('/topics/:id/status', async (c) => {
    const id = c.req.param('id')
    const input = await body(c, SetStatusInput)
    setStatus(db, USER, id, input.status, input.note)
    return c.json(getTopicDetail(db, id))
  })
  app.post('/topics/:id/archive', (c) => {
    archiveTopic(db, USER, c.req.param('id'))
    return c.json(getTopicDetail(db, c.req.param('id')))
  })
  app.post('/topics/:id/restore', (c) => {
    restoreTopic(db, USER, c.req.param('id'))
    return c.json(getTopicDetail(db, c.req.param('id')))
  })
  app.post('/topics/:id/merge', async (c) => {
    const kept = mergeTopics(db, USER, c.req.param('id'), (await body(c, MergeTopicInput)).merge_topic_id)
    return c.json(getTopicDetail(db, kept.id))
  })

  // Links
  app.post('/links', async (c) => c.json({ id: createLink(db, await body(c, CreateLinkInput)) }, 201))
  app.delete('/links/:id', (c) => {
    removeLink(db, c.req.param('id'))
    return c.json({ ok: true })
  })

  // Goals and resources
  app.get('/goals', (c) => c.json(listGoals(db)))
  app.post('/goals', async (c) => c.json({ id: createGoal(db, await body(c, CreateGoalInput)) }, 201))
  app.patch('/goals/:id', async (c) => {
    updateGoal(db, c.req.param('id'), await body(c, UpdateGoalInput))
    return c.json({ ok: true })
  })
  app.post('/topics/:id/goals', async (c) => {
    linkGoal(db, c.req.param('id'), (await body(c, LinkGoalInput)).goal_id)
    return c.json(getTopicDetail(db, c.req.param('id')))
  })
  app.delete('/topics/:id/goals/:goalId', (c) => {
    unlinkGoal(db, c.req.param('id'), c.req.param('goalId'))
    return c.json(getTopicDetail(db, c.req.param('id')))
  })
  app.post('/topics/:id/resources', async (c) => {
    addResource(db, c.req.param('id'), await body(c, CreateResourceInput))
    return c.json(getTopicDetail(db, c.req.param('id')), 201)
  })
  app.delete('/resources/:id', (c) => {
    archiveResource(db, c.req.param('id'))
    return c.json({ ok: true })
  })

  // AI flows and proposals
  const requireAi = () => {
    if (!aiAvailable()) throw new AppError('AI is not configured. Set ANTHROPIC_API_KEY and restart the server.', 503)
  }
  app.post('/capture', async (c) => {
    requireAi()
    return c.json(await runCapture(db, (await body(c, CaptureInput)).text))
  })
  app.get('/optimise/signals', (c) => c.json(optimiseSignals(db)))
  app.post('/optimise', async (c) => {
    requireAi()
    return c.json(await runOptimise(db))
  })
  app.post('/organise', async (c) => {
    requireAi()
    return c.json(await runOrganise(db))
  })
  app.get('/proposals', (c) => c.json({ pending: listPendingGroups(db), recent: listRecentDecisions(db) }))
  app.post('/proposals/accept', async (c) => c.json(acceptMany(db, (await body(c, AcceptManyInput)).ids)))
  app.post('/proposals/:id/accept', (c) => c.json(acceptProposal(db, c.req.param('id'))))
  app.post('/proposals/:id/reject', (c) => {
    rejectProposal(db, c.req.param('id'))
    return c.json({ ok: true })
  })
  app.post('/runs/:id/accept', (c) => c.json(acceptRun(db, c.req.param('id'))))

  // Lessons, attempts and Practice
  app.post('/topics/:id/lessons', async (c) => {
    requireAi()
    const { lessonId } = await generateLesson(db, c.req.param('id'))
    return c.json(getLessonView(db, lessonId), 201)
  })
  app.post('/topics/:id/lesson-requests', async (c) => {
    const input = await body(c, StartLessonRequestInput)
    const request = createLessonRequest(db, c.req.param('id'), input)
    // Without AI the dialog still opens; planning simply needs a key.
    if (!aiAvailable()) return c.json(request, 201)
    return c.json(await planLessonTurn(db, request.id), 201)
  })
  app.get('/lesson-requests/:id', (c) => c.json(getLessonRequest(db, c.req.param('id'))))
  app.post('/lesson-requests/:id/reply', async (c) => {
    requireAi()
    return c.json(await planLessonTurn(db, c.req.param('id'), (await body(c, LessonRequestReplyInput)).message))
  })
  app.post('/lesson-requests/:id/build', async (c) => {
    requireAi()
    const { lessonId } = await buildFromRequest(db, c.req.param('id'))
    return c.json(getLessonView(db, lessonId), 201)
  })
  app.post('/topics/:id/placement', async (c) => {
    requireAi()
    const { lessonId } = await generatePlacement(db, c.req.param('id'))
    return c.json(getLessonView(db, lessonId), 201)
  })
  app.get('/lessons/:id', (c) => c.json(getLessonView(db, c.req.param('id'))))
  app.post('/lessons/:id/versions/:versionId/restore', (c) => {
    restoreVersion(db, c.req.param('id'), c.req.param('versionId'))
    return c.json(getLessonView(db, c.req.param('id')))
  })
  app.get('/lessons/:id/thread', (c) => {
    requireLesson(db, c.req.param('id'))
    return c.json(listMessages(db, c.req.param('id')))
  })
  app.post('/lessons/:id/thread', async (c) => {
    requireAi()
    return c.json(await sendLessonMessage(db, c.req.param('id'), await body(c, LessonMessageInput)))
  })
  app.post('/lessons/:id/questions', async (c) => {
    requireAi()
    await generateQuestions(db, c.req.param('id'))
    return c.json(getLessonView(db, c.req.param('id')))
  })
  app.post('/sessions', async (c) => {
    const input = await body(c, StartSessionInput)
    return c.json({ id: startSession(db, input.kind, input.lesson_version_id ?? null) }, 201)
  })
  app.post('/sessions/:id/complete', (c) => {
    completeSession(db, c.req.param('id'))
    return c.json({ ok: true })
  })
  app.post('/attempts', async (c) => c.json(recordAttempt(db, await body(c, AttemptInput)), 201))
  app.get('/practice', (c) => c.json(practiceQueue(db)))

  return app
}
