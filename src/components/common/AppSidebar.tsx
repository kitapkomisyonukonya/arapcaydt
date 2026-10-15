import React, { useEffect, useState } from 'react';
import { SquaresFour, ListDashes, PlusCircle, Gear, SignOut, IdentificationBadge, Stack, ShieldCheck, Question, Megaphone, Toolbox, PresentationChart } from '@phosphor-icons/react';
import { useAuth } from '../../features/auth/AuthContext';
import { useProjects } from '../../features/projects/ProjectContext';
import { BrandMark } from './BrandMark';
import { Credit } from './Credit';
import { APP_NAME } from '../../config/brand';
import { PAGE_LABELS } from '../../config/pages';
import { ReportProblem } from '../../features/feedback/ReportProblem';
import { Inbox } from '../../features/messages/Inbox';
import { readSeen, unseenNews } from '../../features/help/changelog';

export type AppPage = 'dashboard' | 'questions' | 'editor' | 'batch' | 'lessons' | 'settings' | 'admin' | 'help' | 'news' | 'tools';

interface AppSidebarProps {
  currentPage: AppPage;
  onNavigate: (page: AppPage) => void;
  onNewQuestion: () => void;
}

export const AppSidebar: React.FC<AppSidebarProps> = ({
  currentPage,
  onNavigate,
  onNewQuestion,
}) => {
  const { user, logout } = useAuth();
  const { projects } = useProjects();
  // "Yeni" next to Yenilikler until the newest entry has been opened on this device.
  const [seen, setSeen] = useState(readSeen);
  useEffect(() => {
    const update = () => setSeen(readSeen());
    window.addEventListener('studio-news-seen', update);
    return () => window.removeEventListener('studio-news-seen', update);
  }, []);
  const newCount = unseenNews(seen).length;

  const items: Array<{ page: AppPage; label: string; icon: React.ElementType; badge?: string }> = [
    ...(user?.role === 'admin' ? [{ page: 'admin' as const, label: PAGE_LABELS.admin, icon: ShieldCheck }] : []),
    { page: 'dashboard', label: PAGE_LABELS.dashboard, icon: SquaresFour },
    { page: 'tools', label: PAGE_LABELS.tools, icon: Toolbox },
    { page: 'questions', label: PAGE_LABELS.questions, icon: ListDashes, badge: projects.length ? String(projects.length) : undefined },
    { page: 'batch', label: PAGE_LABELS.batch, icon: Stack },
    { page: 'lessons', label: PAGE_LABELS.lessons, icon: PresentationChart },
  ];
  const link = (item: { page: AppPage; label: string; icon: React.ElementType; badge?: string }) => {
    const active = currentPage === item.page;
    return (
      <button
        key={item.page}
        onClick={() => onNavigate(item.page)}
        aria-current={active ? 'page' : undefined}
        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
          active ? 'bg-[#EFECE6] text-[#8B1E2D] font-semibold' : 'text-[#44423D] font-medium hover:bg-[#F2EFE9] hover:text-[#1C1917]'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <item.icon size={18} weight={active ? 'fill' : 'regular'} />
          <span>{item.label}</span>
        </div>
        {item.badge === 'Yeni'
          ? <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-[#8B1E2D] text-white">Yeni</span>
          : item.badge && <span className="text-xs tabular-nums text-[#787670]">{item.badge}</span>}
      </button>
    );
  };

  return (
    <aside className="studio-sidebar w-64 h-screen flex flex-col bg-[#FAF9F5] border-r select-none shrink-0">
      <div className="h-16 px-5 flex items-center gap-3 border-b">
        <BrandMark size={32} />
        <div className="flex flex-col">
          <span className="font-bold text-sm tracking-tight text-[#1C1917] leading-tight">{APP_NAME}</span>
          <span className="text-xs text-[#787670] leading-tight">{user?.role === 'admin' ? 'Yönetici paneli' : 'Öğretmen paneli'}</span>
        </div>
      </div>

      <div className="p-4 pb-2">
        <button
          onClick={onNewQuestion}
          className="w-full flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-lg bg-[#8B1E2D] hover:bg-[#721824] text-white text-sm font-semibold transition-colors shadow-xs"
        >
          <PlusCircle size={18} weight="bold" />
          <span>Yeni soru</span>
        </button>
      </div>

      <nav aria-label="Ana menü" className="flex-1 px-3 py-2 space-y-1 overflow-y-auto">
        {items.map(link)}
        <div className="pt-4 pb-1 px-3">
          <div className="text-xs uppercase font-semibold text-[#8C8A82] tracking-wider">Sistem</div>
        </div>
        {link({ page: 'settings', label: PAGE_LABELS.settings, icon: Gear })}
        {link({ page: 'news', label: PAGE_LABELS.news, icon: Megaphone, badge: newCount ? 'Yeni' : undefined })}
        {link({ page: 'help', label: PAGE_LABELS.help, icon: Question })}
        <ReportProblem sender={user?.name} />
        {user && user.role !== 'admin' && <Inbox userId={user.id} />}
        <button className="mobile-signout" onClick={logout}><SignOut size={18}/>Çıkış</button>
      </nav>

      {/* Academic Teacher Profile Info Footer */}
      <div className="p-3 border-t bg-[#FAF9F5]">
        <div className="p-2 rounded-lg border bg-white flex items-center justify-between">
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="w-7 h-7 rounded bg-[#F2ECEC] border border-[#DFC8CB] flex items-center justify-center text-[#8B1E2D] text-xs font-bold shrink-0">
              <IdentificationBadge size={16} />
            </div>
            <div className="truncate">
              <div className="text-xs font-semibold text-[#1C1917] truncate leading-tight">
                {user?.name || 'Öğretmen'}
              </div>
              <div className="text-xs text-[#787670] truncate leading-tight">
                {user?.title || 'Öğretmen'}
              </div>
            </div>
          </div>
          <button
            onClick={logout}
            title="Oturumu Kapat"
            className="p-1.5 text-[#787670] hover:text-[#8B1E2D] hover:bg-[#F7EEEE] rounded transition-colors cursor-pointer"
          >
            <SignOut size={16} />
          </button>
        </div>
        <Credit className="mt-2 text-center text-xs text-[#8C8A82]" />
      </div>
    </aside>
  );
};
