import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Menu, Search, Mic, Video, Bell, Home, History, ThumbsUp, Clock, ListVideo, Loader2, CheckCircle2, X, Users, Compass, User } from "lucide-react";

import { CATEGORIES, type Video as VideoT } from "@/lib/faketube-data";
import { searchYouTube, suggestSearch } from "@/lib/youtube.functions";
import { ProfileMenu } from "@/components/faketube/ProfileMenu";
import { useSearchHistory } from "@/lib/user-data";
import { z } from "zod";


export function FakeTubeLayout({ children, activeCategory, onCategoryChange }: {
  children: ReactNode;
  activeCategory?: string;
  onCategoryChange?: (c: string) => void;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const toggle = () => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
      setMobileOpen((v) => !v);
    } else {
      setSidebarOpen((v) => !v);
    }
  };
  return (
    <div className="min-h-screen bg-white text-neutral-900 overflow-x-hidden font-[Roboto,'Helvetica_Neue',Arial,sans-serif]">
      <Header onToggleSidebar={toggle} />
      <div className="flex pt-14">
        <Sidebar open={sidebarOpen} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
        <main className={`flex-1 min-w-0 ${sidebarOpen ? "md:ml-60" : "md:ml-[72px]"} transition-all`}>
          {onCategoryChange && (
            <CategoryBar active={activeCategory ?? "All"} onChange={onCategoryChange} />
          )}
          <div className="mx-auto w-full max-w-[2200px] px-2 py-3 sm:px-4 sm:py-5 md:px-6 pb-28">{children}</div>
        </main>
      </div>
      <MobileTabBar />
    </div>
  );
}

/** YouTube's mobile bottom tab bar. */
function MobileTabBar() {
  const tabs = [
    { icon: Home, label: "Home", to: "/" as const },
    { icon: Compass, label: "Explore", to: "/discover" as const },
    { icon: Users, label: "Subscriptions", to: "/subscriptions" as const },
    { icon: User, label: "You", to: "/history" as const },
  ];
  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 md:hidden bg-white border-t border-neutral-200 flex items-stretch pb-[env(safe-area-inset-bottom)]">
      {tabs.map(({ icon: Icon, label, to }) => (
        <Link
          key={label}
          to={to}
          search={{ sp: "" }}
          className="flex-1 flex flex-col items-center justify-center gap-1 py-2 text-[10px] leading-none text-neutral-700"
        >
          <Icon className="h-[22px] w-[22px]" strokeWidth={1.8} />
          <span className="truncate max-w-full px-1">{label}</span>
        </Link>
      ))}
    </nav>
  );
}



function Header({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white h-14 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center px-1.5 gap-1 sm:flex sm:justify-between sm:px-4 sm:gap-2">
      <div className="flex min-w-0 items-center gap-1 sm:gap-3 shrink-0">
        <button onClick={onToggleSidebar} className="p-2 rounded-full hover:bg-neutral-100 active:bg-neutral-200" aria-label="Toggle sidebar">
          <Menu className="h-6 w-6" strokeWidth={1.6} />
        </button>
        <Link to="/" className="flex min-w-0 items-center gap-1" aria-label="YouTube home">
          <svg viewBox="0 0 90 20" className="h-5 sm:h-6 w-auto" aria-hidden="true">
            <path d="M27.9727 3.12324C27.6435 1.89323 26.6768 0.926623 25.4468 0.597366C23.2197 2.24288e-07 14.285 0 14.285 0C14.285 0 5.35042 2.24288e-07 3.12323 0.597366C1.89323 0.926623 0.926623 1.89323 0.597366 3.12324C2.24288e-07 5.35042 0 10 0 10C0 10 2.24288e-07 14.6496 0.597366 16.8768C0.926623 18.1068 1.89323 19.0734 3.12323 19.4026C5.35042 20 14.285 20 14.285 20C14.285 20 23.2197 20 25.4468 19.4026C26.6768 19.0734 27.6435 18.1068 27.9727 16.8768C28.5701 14.6496 28.5701 10 28.5701 10C28.5701 10 28.5677 5.35042 27.9727 3.12324Z" fill="#FF0000"/>
            <path d="M11.4253 14.2854L18.8477 10.0004L11.4253 5.71533V14.2854Z" fill="white"/>
            <text x="32" y="15.5" fontFamily="'Roboto','Arial',sans-serif" fontSize="15" fontWeight="700" letterSpacing="-0.9" fill="currentColor">YouTube</text>
          </svg>
          <sup className="hidden sm:inline text-[10px] font-medium text-neutral-500 -ml-0.5">IN</sup>
        </Link>

      </div>
      <SearchBox />
      <div className="flex items-center gap-1 sm:gap-2 shrink-0">
        <button className="hidden lg:inline-flex items-center gap-1.5 h-9 pl-3 pr-4 rounded-full bg-neutral-100 hover:bg-neutral-200 text-sm font-medium">
          <Video className="h-5 w-5" strokeWidth={1.6} /> Create
        </button>
        <button className="p-2 rounded-full hover:bg-neutral-100 hidden sm:inline-flex relative" aria-label="Notifications">
          <Bell className="h-6 w-6" strokeWidth={1.6} />
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-red-600" />
        </button>
        <ProfileMenu />
      </div>
    </header>
  );
}




function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function SearchBox() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const debounced = useDebounced(q, 250);
  const searchFn = useServerFn(searchYouTube);
  const suggestFn = useServerFn(suggestSearch);
  const { queries: history, remove: removeHistory, clear: clearHistory } = useSearchHistory();

  const { data: suggestions = [] } = useQuery<string[]>({
    queryKey: ["yt-suggest", debounced],
    queryFn: () => suggestFn({ data: { q: debounced } }),
    enabled: debounced.trim().length > 0,
    staleTime: 5 * 60_000,
  });

  const { data, isFetching } = useQuery<{ items: VideoT[]; nextPageToken?: string }>({
    queryKey: ["yt-search", debounced],
    queryFn: () => searchFn({ data: { q: debounced, limit: 6 } }),
    enabled: debounced.trim().length > 0,
    staleTime: 60_000,
  });
  const results = data?.items ?? [];
  const showHistory = open && !q.trim() && history.length > 0;
  const showResults = open && !!q.trim();
  const suggestCount = suggestions.length;

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => setActive(0), [debounced]);

  const currentSearch = useSearch({ from: "__root__" }) as any;
  const go = (id: string) => {
    setOpen(false);
    setQ("");
    navigate({ to: "/watch/$id", params: { id }, search: { sp: "" } });
  };
  const runSearch = (term: string) => {
    const t = term.trim();
    if (!t) return;
    setOpen(false);
    navigate({ to: "/search", search: { q: t, sp: "" } });
  };
  const submitSearch = () => runSearch(q);

  return (
    <div ref={wrapRef} className="min-w-0 w-full flex-1 max-w-2xl mx-1 sm:mx-4 flex items-center relative">
      <div className="flex min-w-0 flex-1 group">
        <div className="absolute left-3 hidden group-focus-within:block pointer-events-none">
          <Search className="h-4 w-4 text-neutral-500" />
        </div>
        <input

          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            const total = suggestCount + results.length;
            if (e.key === "Enter") {
              e.preventDefault();
              if (open && active > 0 && active <= suggestCount) {
                runSearch(suggestions[active - 1]);
              } else if (open && active > suggestCount && results.length > 0) {
                go(results[active - suggestCount - 1].id);
              } else {
                submitSearch();
              }
              return;
            }
            if (!open || total === 0) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % (total + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + total + 1) % (total + 1)); }
            else if (e.key === "Escape") setOpen(false);
          }}
          className="flex-1 min-w-0 border border-neutral-300 dark:border-neutral-700 rounded-l-full px-2.5 sm:px-4 py-2 text-sm outline-none focus:border-blue-500 bg-white dark:bg-black group-focus-within:border-blue-500 group-focus-within:pl-10 relative transition-all"
          placeholder="Search"
        />
        <button
          onClick={submitSearch}
          className="shrink-0 px-3 sm:px-5 border border-l-0 border-neutral-300 dark:border-neutral-700 rounded-r-full bg-neutral-50 dark:bg-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-700"
          aria-label="Search"
        >
          <Search className="h-4 w-4" />
        </button>
      </div>
      <button className="ml-2 p-2 rounded-full bg-neutral-100 hover:bg-neutral-200 hidden sm:inline-flex" aria-label="Voice search">
        <Mic className="h-4 w-4" />
      </button>

      {showHistory && (
        <div className="absolute top-full left-0 right-0 sm:right-14 mt-1 bg-white border border-neutral-200 rounded-xl shadow-lg overflow-hidden z-50 max-h-[70vh] overflow-y-auto">
          <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-100">
            <span className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Recent searches</span>
            <button
              onClick={() => clearHistory()}
              className="text-xs text-blue-600 hover:underline"
            >
              Clear all
            </button>
          </div>
          {history.map((term) => (
            <div
              key={term}
              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-neutral-50 group"
            >
              <History className="h-4 w-4 text-neutral-500 shrink-0" />
              <button
                onClick={() => runSearch(term)}
                className="flex-1 min-w-0 text-left text-sm truncate"
              >
                {term}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); removeHistory(term); }}
                className="p-1 rounded-full hover:bg-neutral-200 shrink-0"
                aria-label={`Remove ${term} from history`}
              >
                <X className="h-4 w-4 text-neutral-500" />
              </button>
            </div>
          ))}
        </div>
      )}

      {showResults && (
        <div className="absolute top-full left-0 right-0 sm:right-14 mt-1 bg-white border border-neutral-200 rounded-xl shadow-lg overflow-hidden z-50 max-h-[70vh] overflow-y-auto">
          {suggestions.map((s, i) => {
            const idx = i + 1;
            return (
              <button
                key={`sg-${s}`}
                onMouseEnter={() => setActive(idx)}
                onClick={() => runSearch(s)}
                className={`w-full flex items-center gap-3 px-3 py-2 text-left ${
                  idx === active ? "bg-neutral-100" : "hover:bg-neutral-50"
                }`}
              >
                <Search className="h-4 w-4 text-neutral-500 shrink-0" />
                <span className="text-sm truncate flex-1">{s}</span>
              </button>
            );
          })}
          {suggestCount > 0 && results.length > 0 && (
            <div className="border-t border-neutral-100" />
          )}
          {isFetching && results.length === 0 && suggestCount === 0 ? (
            <div className="p-4 text-sm text-neutral-500 flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching…
            </div>
          ) : results.length === 0 && suggestCount === 0 ? (
            <div className="p-4 text-sm text-neutral-500">No matches for “{q}”.</div>
          ) : (
            results.map((v, i) => {
              const idx = suggestCount + 1 + i;
              return (
                <button
                  key={v.id}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => go(v.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-left ${
                    idx === active ? "bg-neutral-100" : "hover:bg-neutral-50"
                  }`}
                >
                  <img src={v.thumbnail} alt="" className="h-12 w-20 object-cover rounded-md shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium line-clamp-1">{v.title}</p>
                    <p className="text-xs text-neutral-600 line-clamp-1">
                      {v.channel} · {v.views} views
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}


function Sidebar({ open, mobileOpen, onCloseMobile }: { open: boolean; mobileOpen: boolean; onCloseMobile: () => void }) {
  const sections = [
    {
      items: [
        { icon: Home, label: "Home", to: "/" as const },
        { icon: Compass, label: "Discover", to: "/discover" as const },
        { icon: Users, label: "Subscriptions", to: "/subscriptions" as const },
      ]

    },
    {
      title: "You",
      items: [
        { icon: History, label: "History", to: "/history" as const },
        { icon: ListVideo, label: "Playlist", to: "/playlist" as const },
        { icon: CheckCircle2, label: "Completed", to: "/completed" as const },
        { icon: Clock, label: "Watch later", to: "/playlist" as const },
        { icon: ThumbsUp, label: "Liked videos", to: "/liked" as const },
      ]
    },
    {
      title: "Explore",
      items: []
    }
  ];
  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 top-14 z-40 bg-black/40 md:hidden"
          onClick={onCloseMobile}
          aria-hidden
        />
      )}
      <aside
        className={`fixed left-0 top-14 bottom-0 z-50 bg-white overflow-y-auto transition-transform
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0
          w-60 ${open ? "md:w-60" : "md:w-20"}`}
      >
        <nav className="py-2">
          {sections.map((section, sIdx) => (
            <div key={sIdx} className="border-b border-neutral-200 dark:border-neutral-800 pb-2 mb-2 last:border-0">
              {section.title && open && (
                <div className="px-6 py-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {section.title}
                </div>
              )}
              {section.items.map(({ icon: Icon, label, to }) => {
                const desktopLayout = open
                  ? "md:flex-row md:items-center md:gap-6 md:px-6 md:py-2"
                  : "md:flex-col md:items-center md:gap-1 md:py-4 md:px-0";
                const desktopText = open ? "md:text-sm" : "md:text-[10px]";
                return (
                  <Link
                    key={label}
                    to={to}
                    search={{ sp: "" }}
                    onClick={onCloseMobile}
                    className={`flex flex-row items-center gap-6 px-6 py-2 ${desktopLayout} hover:bg-neutral-100 dark:hover:bg-neutral-800 mx-2 rounded-lg`}
                  >
                    <Icon className="h-5 w-5 shrink-0" />
                    <span className={`text-sm ${desktopText} truncate`}>{label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

      </aside>
    </>
  );
}


function CategoryBar({ active, onChange }: { active: string; onChange: (c: string) => void }) {
  return (
    <div className="sticky top-14 z-30 bg-white dark:bg-[#0f0f0f] border-b border-neutral-200 dark:border-neutral-800 px-4 py-3 flex gap-3 overflow-x-auto no-scrollbar">
      {CATEGORIES.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
            active === c 
              ? "bg-neutral-900 text-white dark:bg-white dark:text-black" 
              : "bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-900 dark:text-white"
          }`}
        >
          {c}
        </button>
      ))}
    </div>
  );
}
