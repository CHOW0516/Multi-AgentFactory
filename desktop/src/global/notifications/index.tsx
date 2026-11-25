// Bell with unread count and list, toasts for live notifications, and a native desktop notification.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, useLiveEvents } from "../../api/client";
import type { LiveEvent, NotificationOut } from "../../api/types";
import { itemsOf } from "../../components/api-helpers";
import "../../components/components.css";
import { timeSince } from "../../components/format";
import { useAuthStore } from "../../shell/auth-store";
import { desktop } from "../../shell/desktop-bridge";
import { Icon } from "../../shell/icons";

interface Toast { id: number; title: string; body: string | null; link: string | null }
const TOAST_MILLISECONDS = 6000;

/** A live notification is for this user when it names them, or names nobody (everyone). */
export function isForUser(event: LiveEvent<"notification">, userId: string | undefined): boolean {
  return event.data.user_ids.length === 0 || (userId !== undefined && event.data.user_ids.includes(userId));
}

export default function NotificationsGlobal() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const userId = useAuthStore((state) => state.user?.id);
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const popoverRef = useRef<HTMLDivElement>(null);
  const notificationsQuery = useQuery({
    queryKey: ["notifications"], queryFn: () => apiFetch<NotificationOut[] | { items: NotificationOut[] }>("/notifications"),
    refetchInterval: 60_000,
  });
  const notifications = itemsOf(notificationsQuery.data);
  const unread = notifications.filter((notification) => !notification.read_at).length;
  const markRead = useMutation({
    mutationFn: (notificationId: string) => apiFetch(`/notifications/${notificationId}/read`, { method: "POST" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  useLiveEvents(["notification"], (event) => {
    if (!isForUser(event, userId)) return;
    const toast: Toast = { id: Date.now() + Math.random(), title: event.data.title, body: event.data.body, link: event.data.link };
    setToasts((current) => [...current.slice(-2), toast]);
    setTimeout(() => setToasts((current) => current.filter((item) => item.id !== toast.id)), TOAST_MILLISECONDS);
    void desktop.notify(event.data.title, event.data.body ?? "");
    void queryClient.invalidateQueries({ queryKey: ["notifications"] });
  });

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !popoverRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);

  function openNotification(notification: NotificationOut) {
    if (!notification.read_at) markRead.mutate(notification.id);
    setOpen(false);
    if (notification.link) navigate(notification.link);
  }

  return (
    <>
      <button type="button" className="icon-button bell" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-expanded={open}
        onClick={() => setOpen(!open)}>
        <Icon name="bell" />
        {unread > 0 ? <span className="count-badge" aria-hidden="true">{unread > 9 ? "9+" : unread}</span> : null}
      </button>
      {open ? (
        <div className="card notification-popover" ref={popoverRef} role="dialog" aria-label="Notifications">
          <header><strong>Notifications</strong><span className="small muted">{unread} unread</span></header>
          {notifications.length === 0 ? <p className="empty-state">Nothing yet.</p> : (
            <ul>{notifications.map((notification) => (
              <li key={notification.id} className={notification.read_at ? undefined : "unread"}>
                <button type="button" onClick={() => openNotification(notification)}>
                  <div><strong>{notification.title}</strong></div>
                  {notification.body ? <div className="small muted">{notification.body}</div> : null}
                  <div className="small muted">{timeSince(notification.created_at)} ago</div>
                </button>
              </li>
            ))}</ul>
          )}
        </div>
      ) : null}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className="card toast" role="status">
            <strong>{toast.title}</strong>
            {toast.body ? <span className="small muted">{toast.body}</span> : null}
            {toast.link ? (
              <div><button type="button" className="link-button small" onClick={() => { navigate(toast.link as string); setToasts((current) => current.filter((item) => item.id !== toast.id)); }}>Open</button></div>
            ) : null}
          </div>
        ))}
      </div>
    </>
  );
}
