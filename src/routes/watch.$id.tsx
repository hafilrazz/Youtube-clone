import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Capacitor } from "@capacitor/core";
import { ScreenOrientation } from "@capacitor/screen-orientation";
import { StatusBar } from "@capacitor/status-bar";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ThumbsUp, ThumbsDown, Share2, Download, Scissors, Bell, BookmarkPlus, BookmarkCheck, Check, Loader2, Heart, Pin, BadgeCheck, ChevronDown, ChevronUp } from "lucide-react";
import { FakeTubeLayout } from "@/components/faketube/Layout";
import { getYouTubeVideo, getComments, getCommentReplies } from "@/lib/youtube.functions";
import { useLikes, usePlaylist, useRecent } from "@/lib/user-data";
import { useSubscriptions } from "@/lib/subscriptions";
import { useVideoPlayer } from "@/lib/video-player-context";
import { z } from "zod";
import type { Video } from "@/lib/faketube-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/watch/$id")({
  validateSearch: (search: Record<string, unknown>): { sp?: string } => ({
    sp: typeof search.sp === 'string' ? search.sp : "",
  }),
  // No loader: navigation is instant and the player mounts immediately from the id.
  // Metadata + related are streamed in via useQuery inside the component.
  head: ({ params }) => ({
    meta: [
      { title: "Watching — Premium" },
      { property: "og:image", content: `https://i.ytimg.com/vi/${params.id}/hqdefault.jpg` },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: `https://i.ytimg.com/vi/${params.id}/hqdefault.jpg` },
    ],
  }),
  component: Watch,
  errorComponent: ({ error }) => (
    <FakeTubeLayout>
      <div className="text-center py-20">
        <h1 className="text-2xl font-bold">Couldn't load this video</h1>
        <p className="text-sm text-neutral-600 mt-2">{error.message}</p>
        <Link to="/" className="text-blue-600 mt-4 inline-block">Back home</Link>
      </div>
    </FakeTubeLayout>
  ),
});


function VideoSlot() {
  const { setSlot } = useVideoPlayer();
  return (
    <div
      ref={setSlot}
      className="relative w-full aspect-video rounded-xl bg-black"
      aria-label="Video player"
    />
  );
}


function Watch() {
  const { id } = Route.useParams();
  const videoFn = useServerFn(getYouTubeVideo);
  const { data } = useQuery({
    queryKey: ["yt-watch", id],
    queryFn: () => videoFn({ data: { id } }),
    staleTime: 10 * 60_000,
  });
  const video = data?.video ?? {
    id,
    title: "",
    channel: "",
    channelAvatar: `https://i.ytimg.com/vi/${id}/default.jpg`,
    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    views: "",
    posted: "",
    duration: "",
    description: "",
  } as Video;
  const related: Video[] = data?.related ?? [];

  const subscriptions = useSubscriptions();
  const { openVideo } = useVideoPlayer();
  const [descExpanded, setDescExpanded] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const likes = useLikes();
  const playlist = usePlaylist();
  const { record } = useRecent();

  useEffect(() => { record(id); }, [id, record]);

  const searchParams = Route.useSearch();
  const sp = searchParams.sp || "";

  // Auto-landscape when entering watch page on mobile native platform
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      const isMobile = window.matchMedia("(max-width: 767px)").matches;
      if (isMobile) {
        ScreenOrientation.lock({ orientation: "landscape" }).catch(console.error);
        StatusBar.hide().catch(console.error);
      }
    }
    return () => {
      if (Capacitor.isNativePlatform()) {
        ScreenOrientation.lock({ orientation: "portrait" }).catch(console.error);
        StatusBar.show().catch(console.error);
      }
    };
  }, []);

  useEffect(() => {
    // Regular watch page video - ensure isShort is false to enable PiP
    openVideo({
      id: video.id,
      title: video.title,
      channel: video.channel,
      thumbnail: video.thumbnail,
      isShort: false,
    });
  }, [video.id, video.title, video.channel, video.thumbnail, openVideo]);


  const liked = likes.isLiked(id);
  const saved = playlist.isSaved(id);
  const youtubeUrl = `https://www.youtube.com/watch?v=${id}`;
  const encodedYoutubeUrl = encodeURIComponent(youtubeUrl);
  const downloaderLinks = [
    { label: "SaveFrom", href: `https://en.savefrom.net/1-youtube-video-downloader-4/?url=${encodedYoutubeUrl}` },
    { label: "9xbuddy", href: `https://9xbuddy.in/process?url=${encodedYoutubeUrl}` },
    { label: "Loader.to", href: `https://loader.to/?link=${encodedYoutubeUrl}` },
    { label: "SSYouTube", href: `https://ssyoutube.com/watch?v=${id}` },
  ];




  return (
    <FakeTubeLayout>
      <div className="flex flex-col xl:flex-row gap-6 w-full min-w-0">
        <div className="flex-1 min-w-0">
          <VideoSlot />


          <h1 className="mt-4 text-xl sm:text-2xl font-bold break-words leading-tight">{video.title}</h1>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Link to="/channel/$id" params={{ id: video.channelId || "" }} search={{ sp: "" }} className="flex items-center gap-3 group">
                <img src={video.channelAvatar} className="h-10 w-10 rounded-full object-cover" alt="" />
                <div className="min-w-0">
                  <p className="font-bold text-base line-clamp-1 group-hover:text-neutral-700 dark:group-hover:text-neutral-300 transition-colors">{video.channel}</p>
                  <p className="text-xs text-neutral-600 dark:text-neutral-400">YouTube channel</p>
                </div>
              </Link>
              <button
                onClick={() =>
                  subscriptions.toggle({
                    channelId: video.channelId ?? "",
                    name: video.channel,
                    avatar: video.channelAvatar,
                  })
                }
                disabled={!video.channelId}
                className={cn(
                  "ml-2 px-4 py-2 rounded-full text-sm font-bold transition-colors disabled:opacity-50",
                  subscriptions.isSubscribed(video.channelId ?? "")
                    ? "bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700"
                    : "bg-neutral-900 dark:bg-white text-white dark:text-black hover:bg-neutral-800 dark:hover:bg-neutral-200"
                )}
              >
                {subscriptions.isSubscribed(video.channelId ?? "") ? "Subscribed" : "Subscribe"}
              </button>
            </div>
            
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center bg-neutral-100 dark:bg-neutral-800 rounded-full p-0.5">
                <button
                  onClick={() => likes.toggle(video.id)}
                  className="px-4 py-1.5 flex items-center gap-2 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-l-full text-sm font-medium border-r border-neutral-300 dark:border-neutral-700"
                >
                  <ThumbsUp className={cn("h-5 w-5", liked && "fill-current")} />
                  <span>{liked ? "Liked" : "Like"}</span>
                </button>
                <button className="px-4 py-1.5 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-r-full">
                  <ThumbsDown className="h-5 w-5" />
                </button>
              </div>

              <button className="bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-full px-4 py-2 text-sm font-medium flex items-center gap-2">
                <Share2 className="h-5 w-5" />
                <span>Share</span>
              </button>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setDownloadOpen((v) => !v)}
                  className="bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-full px-4 py-2 text-sm font-medium flex items-center gap-2"
                >
                  <Download className="h-5 w-5" />
                  <span>Download</span>
                </button>
                {downloadOpen && (
                  <div className="absolute right-0 top-full z-30 mt-2 w-48 overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-xl">
                    {downloaderLinks.map((link) => (
                      <a
                        key={link.label}
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setDownloadOpen(false)}
                        className="block px-4 py-3 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                      >
                        Open {link.label}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="mt-4 p-3 rounded-xl bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors cursor-pointer group" onClick={() => !descExpanded && setDescExpanded(true)}>
            <div className="flex items-center gap-2 text-sm font-bold">
              <span>{video.views} views</span>
              <span>·</span>
              <span>{video.posted}</span>
            </div>
            <div className={`mt-1 text-sm whitespace-pre-wrap break-words ${descExpanded ? "" : "line-clamp-2"}`}>
              {video.description}
            </div>
            {video.description && video.description.length > 120 && (
              <button
                onClick={(e) => { e.stopPropagation(); setDescExpanded((v) => !v); }}
                className="mt-1 text-sm font-bold block"
              >
                {descExpanded ? "Show less" : "...more"}
              </button>
            )}
          </div>
          <CommentsSection videoId={video.id} />
        </div>
        <aside className="xl:w-96 flex flex-col gap-3 min-w-0">
          <h2 className="font-semibold text-sm text-neutral-700">Up next</h2>
          {related.map((v: Video) => (
            <Link to="/watch/$id" params={{ id: v.id }} search={{ sp }} key={v.id} className="flex gap-2 group">
              <div className="relative w-36 sm:w-40 aspect-video rounded-lg overflow-hidden shrink-0 bg-neutral-200">
                <img src={v.thumbnail} alt={v.title} className="h-full w-full object-cover" />
                {v.duration ? (
                  <span className={`absolute bottom-1 right-1 px-1 text-[10px] rounded ${v.duration === "LIVE" ? "bg-red-600 text-white" : "bg-black/80 text-white"}`}>{v.duration}</span>
                ) : null}

              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold line-clamp-2 leading-snug break-words">{v.title}</h3>
                <p className="text-xs text-neutral-600 mt-1 truncate">{v.channel}</p>
                <p className="text-xs text-neutral-600 truncate">{v.views} views · {v.posted}</p>
              </div>
            </Link>
          ))}
        </aside>


      </div>
    </FakeTubeLayout>
  );
}

function CommentsSection({ videoId }: { videoId: string }) {
  const commentsFn = useServerFn(getComments);
  const { data, isLoading, error } = useQuery({
    queryKey: ["yt-comments", videoId],
    queryFn: () => commentsFn({ data: { id: videoId } }),
    staleTime: 5 * 60_000,
  });

  const comments = data?.comments ?? [];

  return (
    <section className="mt-6">
      <h2 className="text-lg font-bold mb-4">
        Comments {comments.length > 0 && <span className="text-sm font-normal text-neutral-500">· {comments.length}</span>}
      </h2>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-neutral-500 py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading comments…
        </div>
      ) : error ? (
        <p className="text-sm text-neutral-500">Couldn't load comments.</p>
      ) : data?.disabled ? (
        <p className="text-sm text-neutral-500">Comments are disabled for this video.</p>
      ) : comments.length === 0 ? (
        <p className="text-sm text-neutral-500">No comments yet.</p>
      ) : (
        <ul className="flex flex-col gap-5">
          {comments.map((c) => (
            <CommentItem key={c.id} comment={c} videoId={videoId} />
          ))}
        </ul>
      )}
    </section>
  );
}

function CommentItem({ comment, videoId }: { comment: any; videoId: string }) {
  const [showReplies, setShowReplies] = useState(false);
  const repliesFn = useServerFn(getCommentReplies);
  
  const { data: replies, isLoading } = useQuery({
    queryKey: ["yt-comment-replies", videoId, comment.id],
    queryFn: () => repliesFn({ data: { videoId, commentId: comment.id } }),
    enabled: showReplies,
    staleTime: 5 * 60_000,
  });

  return (
    <li className="flex gap-3">
      <img src={comment.avatar} alt="" className="h-9 w-9 rounded-full shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {comment.pinned && (
            <span className="inline-flex items-center gap-1 text-neutral-500">
              <Pin className="h-3 w-3" /> Pinned
            </span>
          )}
          <span className="font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-1">
            {comment.author}
            {comment.verified && <BadgeCheck className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-300" />}
          </span>
          <span className="text-neutral-500 dark:text-neutral-300">{comment.time}</span>
        </div>
        <p className="text-sm mt-1 whitespace-pre-wrap break-words">{comment.text}</p>
        <div className="flex items-center gap-4 mt-2 text-xs text-neutral-600 dark:text-neutral-300">
          <span className="flex items-center gap-1">
            <ThumbsUp className="h-3.5 w-3.5" /> {comment.likes > 0 ? comment.likes.toLocaleString() : ""}
          </span>
          <ThumbsDown className="h-3.5 w-3.5" />
          {comment.hearted && <Heart className="h-3.5 w-3.5 fill-red-500 text-red-500" />}
          <span className="font-semibold cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800 px-2 py-1 rounded-full">Reply</span>
        </div>

        {comment.replies > 0 && (
          <div className="mt-2">
            <button 
              onClick={() => setShowReplies(!showReplies)}
              className="flex items-center gap-2 text-blue-600 dark:text-blue-400 text-sm font-bold hover:bg-blue-50 dark:hover:bg-blue-900/20 px-3 py-1.5 rounded-full transition-colors"
            >
              {showReplies ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {comment.replies} {comment.replies === 1 ? "reply" : "replies"}
            </button>

            {showReplies && (
              <div className="mt-3 ml-2 pl-4 border-l-2 border-neutral-100 dark:border-neutral-800 flex flex-col gap-4">
                {isLoading ? (
                  <div className="flex items-center gap-2 text-xs text-neutral-500">
                    <Loader2 className="h-3 w-3 animate-spin" /> Loading replies…
                  </div>
                ) : (
                  replies?.map((r: any) => (
                    <div key={r.id} className="flex gap-3">
                      <img src={r.avatar} alt="" className="h-6 w-6 rounded-full shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-xs">
                          <span className="font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-1">
                            {r.author}
                            {r.verified && <BadgeCheck className="h-3 w-3 text-neutral-500 dark:text-neutral-300" />}
                          </span>
                          <span className="text-neutral-500 dark:text-neutral-300">{r.time}</span>
                        </div>
                        <p className="text-sm mt-0.5 whitespace-pre-wrap break-words">{r.text}</p>
                        <div className="flex items-center gap-4 mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                          <span className="flex items-center gap-1">
                            <ThumbsUp className="h-3 w-3" /> {r.likes > 0 ? r.likes.toLocaleString() : ""}
                          </span>
                          <ThumbsDown className="h-3 w-3" />
                          {r.hearted && <Heart className="h-3 w-3 fill-red-500 text-red-500" />}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
