import {useAuth} from '../features/auth/AuthContext';
import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { AppSidebar, AppPage } from '../components/common/AppSidebar';
import { AppHeader } from '../components/common/AppHeader';
import { AnnouncementBanner } from '../features/settings/AnnouncementBanner';
import { UpdateBanner } from '../features/settings/UpdateBanner';
import { BrowserSupportBanner } from '../features/video/BrowserSupportBanner';
import { setReportContext } from '../features/feedback/feedback';
import { PAGE_LABELS } from '../config/pages';
import { DashboardPage } from '../pages/DashboardPage';
import { QuestionsPage } from '../pages/QuestionsPage';
import { FirstRunGuide, guideSeen } from '../features/help/FirstRunGuide';
import { useProjects } from '../features/projects/ProjectContext';
import { NewProjectCategoryModal } from '../features/projects/NewProjectCategoryModal';
import { pageHash, parseHash } from './route';
import { toast } from 'sonner';

// Pages a teacher opens now and then load when first opened, so the studio starts faster.
// The editor is fetched in the background right after start, so opening a question stays instant.
const loadEditor = () => import('../pages/QuestionEditorPage');
const QuestionEditorPage = lazy(() => loadEditor().then(m => ({ default: m.QuestionEditorPage })));
const AdminPage = lazy(() => import('../pages/AdminPage').then(m => ({ default: m.AdminPage })));
const SettingsPage = lazy(() => import('../pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const BatchPage = lazy(() => import('../pages/BatchPage').then(m => ({ default: m.BatchPage })));
const HelpPage = lazy(() => import('../pages/HelpPage').then(m => ({ default: m.HelpPage })));
const NewsPage = lazy(() => import('../pages/NewsPage').then(m => ({ default: m.NewsPage })));
const LessonsPage = lazy(() => import('../pages/LessonsPage').then(m => ({ default: m.LessonsPage })));
const ToolsPage = lazy(() => import('../pages/ToolsPage').then(m => ({ default: m.ToolsPage })));

const PageLoading = () => (
  <p className="p-8 text-sm text-[#787670]" role="status">Sayfa açılıyor…</p>
);

/** A page that must not be left silently (MP4 export, batch run): returns true when leaving is fine. */
export type LeaveGuard = () => boolean;

export const AppLayout: React.FC = () => {
  const {user}=useAuth();
  // The address decides where the studio opens: a reload stays on the same page and question.
  const opening = useRef(parseHash(window.location.hash));
  const [currentPage, setCurrentPage] = useState<AppPage>(() => {
    const { page } = opening.current;
    if (page === 'admin' && user?.role !== 'admin') return 'dashboard';
    // No studio address (a fresh visit or a sign-in callback): admins start on their panel.
    if (page === 'dashboard' && !window.location.hash.startsWith('#/') && user?.role === 'admin') return 'admin';
    return page;
  });
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  useEffect(() => {
    const start = () => { void loadEditor().catch(() => undefined); };
    // Safari has no idle callback.
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(start); else setTimeout(start, 1500);
  }, []);
  // A short picture tour the first time a teacher signs in on this device.
  const [showGuide, setShowGuide] = useState(() => !!user && !guideSeen(user.id));
  const { selectProject, createNewProject, currentProject, projects, error, loadProjects, isLoading } = useProjects();
  const currentProjectId = useRef(currentProject?.id);
  currentProjectId.current = currentProject?.id;
  // The editor reports its own question and step.
  useEffect(() => { if (currentPage !== 'editor') setReportContext({ page: PAGE_LABELS[currentPage] }); }, [currentPage]);
  const pageRef = useRef(currentPage);
  pageRef.current = currentPage;
  const leaveGuard = useRef<LeaveGuard | null>(null);
  const registerLeaveGuard = useCallback((guard: LeaveGuard | null) => { leaveGuard.current = guard; }, []);

  // The address of where the teacher is now (the editor names its open question).
  const hereHash = () => pageHash(pageRef.current, pageRef.current === 'editor' ? currentProjectId.current : undefined);
  /** A running job blocks leaving; after a Back/Forward the address is put back to where the teacher still is. */
  const mayLeave = (fromHistory: boolean) => {
    if (leaveGuard.current && !leaveGuard.current()) {
      if (fromHistory) window.history.pushState({ studioPage: pageRef.current }, '', hereHash());
      return false;
    }
    leaveGuard.current = null;
    return true;
  };

  // Every page change goes through here, so the browser's Back button moves between
  // studio pages (instead of leaving the site) and a running job is never dropped silently.
  const navigate = useCallback((page: AppPage, fromHistory = false) => {
    if (page === pageRef.current || !mayLeave(fromHistory)) return;
    setCurrentPage(page);
    if (!fromHistory) window.history.pushState({ studioPage: page }, '', pageHash(page));
  }, []);

  // A question named in the address: open it, or fall back to the list when it is gone or not this teacher's.
  const addressOpening = useRef(false);
  const openFromAddress = useCallback(async (id: string, fromHistory = false) => {
    if (!mayLeave(fromHistory)) return;
    addressOpening.current = true;
    try {
      const found = await selectProject(id);
      if (found) { navigate('editor', fromHistory); return; }
      navigate('questions', true);
      window.history.replaceState({ studioPage: 'questions' }, '', pageHash('questions'));
      toast.error('Bu soru bulunamadı. Soru listesi açıldı.');
    } finally { addressOpening.current = false; }
  }, [selectProject, navigate]);

  useEffect(() => {
    // The address keeps what it names (the editor's question, the help topic) when it already points here.
    window.history.replaceState({ ...(window.history.state || {}), studioPage: pageRef.current }, '',
      parseHash(window.location.hash).page === pageRef.current && window.location.hash.startsWith('#/') ? window.location.hash : pageHash(pageRef.current));
    const onPop = (event: PopStateEvent) => {
      // A typed or pasted address has no saved state: read the page from the address itself.
      const target = parseHash(window.location.hash);
      const page = (event.state?.studioPage as AppPage | undefined) ?? target.page;
      if (page === 'editor' && target.projectId && target.projectId !== currentProjectId.current) {
        void openFromAddress(target.projectId, true);
        return;
      }
      navigate(page === 'admin' && user?.role !== 'admin' ? 'dashboard' : page, true);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [navigate, openFromAddress, user?.role]);

  const handleSelectProject = async (id: string) => {
    if (leaveGuard.current && !leaveGuard.current()) return;
    const selected=await selectProject(id);
    if(!selected)return;
    navigate('editor');
  };

  const handleNewQuestion = () => {
    setIsNewModalOpen(true);
  };

  const handleConfirmCreate = async (categoryId: string) => {
    if (leaveGuard.current && !leaveGuard.current()) return;
    await createNewProject({ category: categoryId });
    navigate('editor');
  };

  // On the editor without an open question: the one in the address, else the latest one.
  React.useEffect(() => {
    if (currentPage !== 'editor' || currentProject || isLoading || addressOpening.current) return;
    const wanted = opening.current.projectId;
    opening.current = { page: 'editor' };
    if (wanted) void openFromAddress(wanted, true);
    else if (projects.length > 0) void selectProject(projects[0].id);
  }, [currentPage, currentProject, projects, selectProject, isLoading, openFromAddress]);
  // The editor's address names the open question, so a reload or a shared bookmark opens it again.
  useEffect(() => {
    if (currentPage === 'editor' && currentProject?.id && window.location.hash !== pageHash('editor', currentProject.id))
      window.history.replaceState({ ...(window.history.state || {}), studioPage: 'editor' }, '', pageHash('editor', currentProject.id));
  }, [currentPage, currentProject?.id]);

  if (currentPage === 'editor') {
    return (
      <div className="h-screen w-screen overflow-hidden bg-[#FAF9F5]">
        <BrowserSupportBanner />
        <Suspense fallback={<PageLoading />}>
        <QuestionEditorPage key={currentProject?.id}
          onBack={() => navigate('questions')}
          onNewQuestion={handleNewQuestion}
          registerLeaveGuard={registerLeaveGuard}
          waitingForProject={isLoading || (!currentProject && projects.length > 0 && !error)}
          loadError={error}
        />
        </Suspense>
        <NewProjectCategoryModal
          isOpen={isNewModalOpen}
          onClose={() => setIsNewModalOpen(false)}
          onCreate={handleConfirmCreate}
        />
      </div>
    );
  }

  return (
    <div className="studio-shell flex h-screen w-screen overflow-hidden bg-[#FAF9F5]">
      {/* Left Sidebar */}
      <AppSidebar
        currentPage={currentPage}
        onNavigate={navigate}
        onNewQuestion={handleNewQuestion}
      />

      {/* Main App Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        <AppHeader
          currentPage={currentPage}
          onNavigate={navigate}
        />

        <UpdateBanner />
        <BrowserSupportBanner />
        <AnnouncementBanner />
        <main className="flex-1 overflow-y-auto">
          <Suspense fallback={<PageLoading />}>
          {error&&<div role="alert" className="p-4 bg-red-50 text-red-800">{error} <button onClick={()=>void loadProjects()}>Yeniden dene</button></div>}
          {currentPage==='admin'&&user?.role==='admin'&&<AdminPage/>}
          {currentPage === 'dashboard' && (
            <DashboardPage
              onNavigate={navigate}
              onSelectProject={handleSelectProject}
              onNewQuestion={handleNewQuestion}
            />
          )}

          {currentPage === 'questions' && (
            <QuestionsPage
              onNavigate={navigate}
              onSelectProject={handleSelectProject}
              onNewQuestion={handleNewQuestion}
            />
          )}

          {currentPage === 'batch' && <BatchPage onOpenProject={id => void handleSelectProject(id)} registerLeaveGuard={registerLeaveGuard} />}
          {currentPage === 'lessons' && <LessonsPage registerLeaveGuard={registerLeaveGuard} />}
          {currentPage === 'settings' && <SettingsPage />}
          {currentPage === 'help' && <HelpPage onShowGuide={() => setShowGuide(true)} />}
          {currentPage === 'news' && <NewsPage />}
          {currentPage === 'tools' && <ToolsPage />}
          </Suspense>
        </main>
      </div>

      <NewProjectCategoryModal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        onCreate={handleConfirmCreate}
      />
      {showGuide && user && <FirstRunGuide userId={user.id} onClose={() => setShowGuide(false)} />}
    </div>
  );
};
