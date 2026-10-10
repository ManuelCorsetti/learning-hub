import type { HomeData } from '../../shared/api'
import { useApi } from './api'
import { AreaPage } from './pages/AreaPage'
import { GoalsPage } from './pages/GoalsPage'
import { HomePage } from './pages/HomePage'
import { LessonPage } from './pages/LessonPage'
import { PracticePage } from './pages/PracticePage'
import { SettingsPage, modelLabel } from './pages/SettingsPage'
import { TopicPage } from './pages/TopicPage'
import { ReviewPage } from './pages/ReviewPage'
import { useRoute } from './router'

export function App() {
  const route = useRoute()
  const home = useApi<HomeData>('/home')
  const pending = home.data?.pendingProposals ?? 0
  const due = home.data?.reviewsDue ?? 0

  return (
    <div className="app">
      <header className="topbar">
        <a className="wordmark" href="#/">
          <span className="mark">L</span>
          <span>
            Learning
            <br />
            <b>Studio</b>
          </span>
        </a>
        <nav>
          <a href="#/" className={['home', 'area', 'topic', 'lesson'].includes(route.page) ? 'active' : ''}>
            Map
          </a>
          <a href="#/practice" className={route.page === 'practice' ? 'active' : ''}>
            Practice {due > 0 && <span className="count-badge" title="Reviews due">{due}</span>}
          </a>
          <a href="#/review" className={route.page === 'review' ? 'active' : ''}>
            Review {pending > 0 && <span className="count-badge">{pending}</span>}
          </a>
          <a href="#/goals" className={route.page === 'goals' ? 'active' : ''}>
            Goals
          </a>
          <a href="#/settings" className={route.page === 'settings' ? 'active' : ''}>
            Settings
          </a>
        </nav>
        {home.data && (
          <a href="#/settings" className={`ai-state ${home.data.aiAvailable ? 'on' : ''}`} title="Change the model in Settings">
            {home.data.aiAvailable ? modelLabel(home.data.model) : 'AI off · set ANTHROPIC_API_KEY'}
          </a>
        )}
      </header>
      <main className="page">
        {route.page === 'home' && <HomePage home={home.data} error={home.error} />}
        {route.page === 'area' && <AreaPage areaId={route.areaId} topicId={route.topicId} view={route.view} />}
        {route.page === 'review' && <ReviewPage aiAvailable={home.data?.aiAvailable ?? false} />}
        {route.page === 'goals' && <GoalsPage />}
        {route.page === 'lesson' && <LessonPage lessonId={route.lessonId} aiAvailable={home.data?.aiAvailable ?? false} />}
        {route.page === 'practice' && <PracticePage aiAvailable={home.data?.aiAvailable ?? false} />}
        {route.page === 'settings' && <SettingsPage />}
        {route.page === 'topic' && <TopicPage topicId={route.topicId} aiAvailable={home.data?.aiAvailable ?? false} />}
      </main>
      <footer>
        <span>Learning Studio</span>
        <span>Built for understanding, not collecting tabs.</span>
      </footer>
    </div>
  )
}
