import { ApiError, registerMock } from "../../api/client";
import { notifications } from "../../components/mock-data";

registerMock("GET", "/notifications", () => notifications);
registerMock("POST", "/notifications/:notificationId/read", ({ params }) => {
  const notification = notifications.find((candidate) => candidate.id === params.notificationId);
  if (!notification) throw new ApiError(404, "Notification not found");
  notification.read_at = new Date().toISOString();
  return notification;
});
