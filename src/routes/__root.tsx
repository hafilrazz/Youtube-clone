import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { VideoPlayerProvider } from "@/lib/video-player-context";
import { GlobalVideoPlayer } from "@/components/faketube/GlobalVideoPlayer";
import { useTvNavigation } from "@/lib/tv-navigation";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "YouTube — Trending videos right now" },
      { name: "description", content: "Watch what's trending today on YouTube — music, gaming, news, sports and more, streamed straight from the source." },
      { name: "theme-color", content: "#FF0000" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "YouTube" },
      { property: "og:title", content: "YouTube — Trending videos right now" },
      { property: "og:description", content: "Watch what's trending today on YouTube — music, gaming, news, sports and more, streamed straight from the source." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },

      { name: "twitter:title", content: "YouTube — Trending videos right now" },
      { name: "twitter:description", content: "Watch what's trending today on YouTube — music, gaming, news, sports and more, streamed straight from the source." },
      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/4dd3fa93-b404-42e9-ba66-ea4ba850f8da" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/4dd3fa93-b404-42e9-ba66-ea4ba850f8da" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/app-icon.png", type: "image/png" },
      { rel: "apple-touch-icon", href: "/app-icon.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      // Speed up first video load: warm TLS/DNS to YouTube endpoints.
      { rel: "preconnect", href: "https://www.youtube.com", crossOrigin: "" },
      { rel: "preconnect", href: "https://www.youtube-nocookie.com", crossOrigin: "" },
      { rel: "preconnect", href: "https://i.ytimg.com", crossOrigin: "" },
      { rel: "preconnect", href: "https://s.ytimg.com", crossOrigin: "" },
      { rel: "dns-prefetch", href: "https://googlevideo.com" },
    ],


  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  // Global effect to prevent auto-PiP when page visibility changes (going home on mobile)
  useEffect(() => {
    const handleVisibility = () => {
      // If we are moving to background, we usually trigger PiP in watch.$id.tsx
      // But we should ensure we don't do it if it's a short.
      // The individual route visibility handlers should handle this.
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <VideoPlayerProvider>
        <TvNavigationBridge />
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
        <GlobalVideoPlayer />
      </VideoPlayerProvider>
    </QueryClientProvider>
  );
}

function TvNavigationBridge() {
  useTvNavigation();
  return null;
}
